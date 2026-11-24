package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/ersincebi/titanview/backend/internal/domain"
)

// DepthReport summarises the public order book around the mid price.
type DepthReport struct {
	Symbol     string  `json:"symbol"`
	Mid        float64 `json:"mid"`
	Bid1Pct    float64 `json:"bid1Pct"` // USD notional of bids within 1% of mid
	Ask1Pct    float64 `json:"ask1Pct"`
	Bid5Pct    float64 `json:"bid5Pct"`
	Ask5Pct    float64 `json:"ask5Pct"`
	Imbalance1 float64 `json:"imbalance1Pct"` // (bid-ask)/(bid+ask)*100, within 1%
	Imbalance5 float64 `json:"imbalance5Pct"`
	SpreadPct  float64 `json:"spreadPct"`
	LargestBid float64 `json:"largestBid"` // price of the biggest single bid level ("buy wall")
	LargestAsk float64 `json:"largestAsk"`
}

// DepthFetcher is implemented by providers that expose an order book.
type DepthFetcher interface {
	FetchDepth(ctx context.Context, symbol string) (*DepthReport, error)
}

func parseLevels(raw [][]string) (px, qty []float64) {
	for _, l := range raw {
		if len(l) < 2 {
			continue
		}
		p, e1 := strconv.ParseFloat(l[0], 64)
		q, e2 := strconv.ParseFloat(l[1], 64)
		if e1 != nil || e2 != nil || p <= 0 {
			continue
		}
		px, qty = append(px, p), append(qty, q)
	}
	return
}

func buildDepthReport(symbol string, body []byte) (*DepthReport, error) {
	var d struct {
		Bids [][]string `json:"bids"`
		Asks [][]string `json:"asks"`
	}
	if err := json.Unmarshal(body, &d); err != nil {
		return nil, err
	}
	bp, bq := parseLevels(d.Bids)
	ap, aq := parseLevels(d.Asks)
	if len(bp) == 0 || len(ap) == 0 {
		return nil, fmt.Errorf("empty order book for %s", symbol)
	}
	mid := (bp[0] + ap[0]) / 2
	r := &DepthReport{Symbol: symbol, Mid: mid, SpreadPct: (ap[0] - bp[0]) / mid * 100}
	var bigB, bigA float64
	for i, p := range bp {
		n := p * bq[i]
		if p >= mid*0.99 {
			r.Bid1Pct += n
		}
		if p >= mid*0.95 {
			r.Bid5Pct += n
		}
		if n > bigB {
			bigB, r.LargestBid = n, p
		}
	}
	for i, p := range ap {
		n := p * aq[i]
		if p <= mid*1.01 {
			r.Ask1Pct += n
		}
		if p <= mid*1.05 {
			r.Ask5Pct += n
		}
		if n > bigA {
			bigA, r.LargestAsk = n, p
		}
	}
	imb := func(b, a float64) float64 {
		if b+a == 0 {
			return 0
		}
		return math.Round((b-a)/(b+a)*10000) / 100
	}
	r.Imbalance1, r.Imbalance5 = imb(r.Bid1Pct, r.Ask1Pct), imb(r.Bid5Pct, r.Ask5Pct)
	return r, nil
}

// FetchDepth reads /api/v3/depth (500 levels) from the first mirror that answers.
func (b *BinanceProvider) FetchDepth(ctx context.Context, symbol string) (*DepthReport, error) {
	sym := domain.NormalizeSymbol(symbol)
	var lastErr error
	for _, base := range b.BaseURLs {
		ep := fmt.Sprintf("%s/api/v3/depth?symbol=%s&limit=500", strings.TrimRight(base, "/"), url.QueryEscape(sym))
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, ep, nil)
		if err != nil {
			lastErr = err
			continue
		}
		resp, err := b.HTTPClient.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		body, rerr := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode == http.StatusOK && rerr == nil {
			rep, perr := buildDepthReport(sym, body)
			if perr == nil {
				return rep, nil
			}
			lastErr = perr
			continue
		}
		lastErr = fmt.Errorf("binance depth status %d", resp.StatusCode)
	}
	return nil, lastErr
}
