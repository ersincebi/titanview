package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/ersincebi/titanview/backend/internal/domain"
)

// SymbolSearcher is implemented by providers that can look up symbols by free text.
type SymbolSearcher interface {
	SearchSymbols(ctx context.Context, query string, limit int) ([]domain.SymbolInfo, error)
}

// SearchSymbols queries Yahoo's search endpoint and maps hits to routable SymbolInfo.
// Only equities, ETFs, indices, currencies and futures are kept; crypto is served by Binance.
func (y *YahooProvider) SearchSymbols(ctx context.Context, query string, limit int) ([]domain.SymbolInfo, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, nil
	}
	if limit <= 0 || limit > 20 {
		limit = 10
	}
	params := url.Values{}
	params.Set("q", query)
	params.Set("quotesCount", fmt.Sprint(limit))
	params.Set("newsCount", "0")

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
			lastErr = fmt.Errorf("yahoo search status %d from %s", resp.StatusCode, base)
			continue
		}
		var parsed struct {
			Quotes []struct {
				Symbol    string `json:"symbol"`
				ShortName string `json:"shortname"`
				LongName  string `json:"longname"`
				QuoteType string `json:"quoteType"`
			} `json:"quotes"`
		}
		if err := json.Unmarshal(body, &parsed); err != nil {
			lastErr = err
			continue
		}
		out := make([]domain.SymbolInfo, 0, len(parsed.Quotes))
		for _, q := range parsed.Quotes {
			switch q.QuoteType {
			case "EQUITY", "ETF", "INDEX", "CURRENCY", "FUTURE", "MUTUALFUND":
			default:
				continue
			}
			info := domain.ResolveSymbolInfo(q.Symbol)
			if info.Provider != domain.ProviderYahoo {
				continue
			}
			if name := firstNonEmpty(q.LongName, q.ShortName); name != "" {
				info.DisplayName = name
			}
			out = append(out, info)
		}
		return out, nil
	}
	return nil, lastErr
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
