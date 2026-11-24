package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// NewsItem is one headline from the upstream news feed.
type NewsItem struct {
	Title     string `json:"title"`
	Publisher string `json:"publisher"`
	Link      string `json:"link"`
	Time      int64  `json:"time"` // unix seconds
}

// NewsFetcher is implemented by providers that can return headlines for a query/symbol.
type NewsFetcher interface {
	FetchNews(ctx context.Context, query string, limit int) ([]NewsItem, error)
}

// NewsQuery maps a TitanView symbol to the query Yahoo understands (BTCUSDT -> BTC-USD).
func NewsQuery(symbol string) string {
	s := strings.ToUpper(strings.TrimSpace(symbol))
	if strings.HasSuffix(s, "USDT") && len(s) > 4 {
		return strings.TrimSuffix(s, "USDT") + "-USD"
	}
	return s
}

// NewsQueries lists queries to try in order: the mapped symbol, then its bare ticker
// (Yahoo often has no news under "BTC-USD" or "XXXX.IS" but does under "BTC").
func NewsQueries(symbol string) []string {
	q := NewsQuery(symbol)
	base := strings.TrimSuffix(strings.TrimSuffix(q, ".IS"), "-USD")
	if base == q || base == "" {
		return []string{q}
	}
	return []string{q, base}
}

// FetchNews queries Yahoo's search endpoint for news headlines.
func (y *YahooProvider) FetchNews(ctx context.Context, query string, limit int) ([]NewsItem, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, nil
	}
	if limit <= 0 || limit > 30 {
		limit = 10
	}
	params := url.Values{}
	params.Set("q", query)
	params.Set("quotesCount", "0")
	params.Set("newsCount", fmt.Sprint(limit))

	var lastErr error
	for _, base := range y.BaseURLs {
		endpoint := fmt.Sprintf("%s/v1/finance/search?%s", strings.TrimRight(base, "/"), params.Encode())
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			lastErr = err
			continue
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
		resp, err := y.HTTPClient.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		body, readErr := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK || readErr != nil {
			lastErr = fmt.Errorf("yahoo news status %d from %s", resp.StatusCode, base)
			continue
		}
		return parseYahooNews(body, limit)
	}
	return nil, lastErr
}

func parseYahooNews(body []byte, limit int) ([]NewsItem, error) {
	var parsed struct {
		News []struct {
			Title     string `json:"title"`
			Publisher string `json:"publisher"`
			Link      string `json:"link"`
			Time      int64  `json:"providerPublishTime"`
		} `json:"news"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, err
	}
	out := make([]NewsItem, 0, len(parsed.News))
	for _, n := range parsed.News {
		if n.Title == "" || !strings.HasPrefix(n.Link, "http") {
			continue
		}
		out = append(out, NewsItem{Title: n.Title, Publisher: n.Publisher, Link: n.Link, Time: n.Time})
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}
