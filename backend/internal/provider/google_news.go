package provider

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// GoogleNewsProvider reads Google News RSS (keyless). It backs symbols Yahoo has no
// headlines for, notably BIST (.IS) tickers; results are real, never synthesised.
type GoogleNewsProvider struct {
	BaseURL    string
	HTTPClient *http.Client
}

func NewGoogleNewsProvider(client *http.Client) *GoogleNewsProvider {
	if client == nil {
		client = &http.Client{Timeout: 6 * time.Second}
	}
	return &GoogleNewsProvider{BaseURL: "https://news.google.com", HTTPClient: client}
}

// GoogleNewsQuery maps a symbol to a search phrase and locale.
// BIST: "THYAO.IS" -> "THYAO hisse" in Turkish; everything else English.
func GoogleNewsQuery(symbol string) (q, hl, gl, ceid string) {
	s := strings.ToUpper(strings.TrimSpace(symbol))
	switch {
	case strings.HasSuffix(s, ".IS"):
		return strings.TrimSuffix(s, ".IS") + " hisse", "tr", "TR", "TR:tr"
	case strings.HasSuffix(s, "USDT") && len(s) > 4:
		return strings.TrimSuffix(s, "USDT") + " crypto", "en-US", "US", "US:en"
	default:
		return s + " stock", "en-US", "US", "US:en"
	}
}

// FetchNews takes a TitanView symbol (not a Yahoo query).
func (g *GoogleNewsProvider) FetchNews(ctx context.Context, symbol string, limit int) ([]NewsItem, error) {
	if strings.TrimSpace(symbol) == "" {
		return nil, nil
	}
	if limit <= 0 || limit > 30 {
		limit = 10
	}
	q, hl, gl, ceid := GoogleNewsQuery(symbol)
	params := url.Values{}
	params.Set("q", q)
	params.Set("hl", hl)
	params.Set("gl", gl)
	params.Set("ceid", ceid)
	endpoint := fmt.Sprintf("%s/rss/search?%s", strings.TrimRight(g.BaseURL, "/"), params.Encode())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
	resp, err := g.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("google news status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	return parseGoogleNewsRSS(body, limit)
}

func parseGoogleNewsRSS(body []byte, limit int) ([]NewsItem, error) {
	var feed struct {
		Items []struct {
			Title   string `xml:"title"`
			Link    string `xml:"link"`
			PubDate string `xml:"pubDate"`
			Source  string `xml:"source"`
		} `xml:"channel>item"`
	}
	if err := xml.Unmarshal(body, &feed); err != nil {
		return nil, err
	}
	out := make([]NewsItem, 0, len(feed.Items))
	for _, it := range feed.Items {
		title, pub := strings.TrimSpace(it.Title), strings.TrimSpace(it.Source)
		// Google appends " - Publisher" to the title; split it off when the source tag is absent.
		if i := strings.LastIndex(title, " - "); i > 0 {
			if pub == "" {
				pub = title[i+3:]
			}
			if strings.TrimSpace(title[i+3:]) == pub {
				title = strings.TrimSpace(title[:i])
			}
		}
		if title == "" || !strings.HasPrefix(it.Link, "http") {
			continue
		}
		var ts int64
		if t, err := time.Parse(time.RFC1123, strings.TrimSpace(it.PubDate)); err == nil {
			ts = t.Unix()
		}
		out = append(out, NewsItem{Title: title, Publisher: pub, Link: strings.TrimSpace(it.Link), Time: ts})
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}
