package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// AggTrade is one Binance aggregated trade. Sell is true when the taker sold (buyer was maker).
type AggTrade struct {
	ID     int64
	Price  float64
	Qty    float64
	TimeMs int64
	Sell   bool
}

// AggTradeFetcher pages the public aggregated trade tape. Either fromID>0 (continue after a
// known trade) or a [startMs, endMs] window shorter than one hour must be given.
type AggTradeFetcher interface {
	FetchAggTrades(ctx context.Context, symbol string, fromID, startMs, endMs int64, limit int) ([]AggTrade, error)
}

// FetchAggTrades calls /api/v3/aggTrades on the first mirror that answers.
func (b *BinanceProvider) FetchAggTrades(ctx context.Context, symbol string, fromID, startMs, endMs int64, limit int) ([]AggTrade, error) {
	if limit <= 0 || limit > 1000 {
		limit = 1000
	}
	q := url.Values{}
	q.Set("symbol", strings.ToUpper(strings.TrimSpace(symbol)))
	q.Set("limit", strconv.Itoa(limit))
	if fromID > 0 {
		q.Set("fromId", strconv.FormatInt(fromID, 10))
	} else {
		q.Set("startTime", strconv.FormatInt(startMs, 10))
		q.Set("endTime", strconv.FormatInt(endMs, 10))
	}
	var lastErr error
	for _, base := range b.BaseURLs {
		endpoint := fmt.Sprintf("%s/api/v3/aggTrades?%s", strings.TrimRight(base, "/"), q.Encode())
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			lastErr = err
			continue
		}
		req.Header.Set("User-Agent", "TitanView/1.0")
		resp, err := b.HTTPClient.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK || readErr != nil {
			lastErr = fmt.Errorf("binance aggTrades status %d from %s", resp.StatusCode, base)
			continue
		}
		return ParseAggTrades(body)
	}
	return nil, lastErr
}

// ParseAggTrades decodes the Binance aggTrades JSON array.
func ParseAggTrades(body []byte) ([]AggTrade, error) {
	var raw []struct {
		A int64  `json:"a"`
		P string `json:"p"`
		Q string `json:"q"`
		T int64  `json:"T"`
		M bool   `json:"m"`
		// Binance also sends "M" (best price match). encoding/json matches keys case-insensitively,
		// so without this exact-tag field "M" would overwrite "m" and every trade would look like a sell.
		BestMatch bool `json:"M"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}
	out := make([]AggTrade, 0, len(raw))
	for _, r := range raw {
		p, e1 := strconv.ParseFloat(r.P, 64)
		qty, e2 := strconv.ParseFloat(r.Q, 64)
		if e1 != nil || e2 != nil || p <= 0 || qty <= 0 {
			continue
		}
		out = append(out, AggTrade{ID: r.A, Price: p, Qty: qty, TimeMs: r.T, Sell: r.M})
	}
	return out, nil
}
