package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
)

// WhaleTrade is one large aggregated trade from the exchange tape.
type WhaleTrade struct {
	Time     int64   `json:"time"` // unix seconds
	Price    float64 `json:"price"`
	Qty      float64 `json:"qty"`
	Notional float64 `json:"notional"` // quote currency (USDT)
	Side     string  `json:"side"`     // "BUY" | "SELL" (taker side)
}

// WhaleReport summarises the recent tape and lists its largest prints.
type WhaleReport struct {
	Symbol     string       `json:"symbol"`
	Sampled    int          `json:"sampled"` // trades analysed
	FromTime   int64        `json:"fromTime"`
	ToTime     int64        `json:"toTime"`
	BuyVolume  float64      `json:"buyVolume"` // taker-buy notional over the sample
	SellVolume float64      `json:"sellVolume"`
	Trades     []WhaleTrade `json:"trades"` // largest first
}

// WhaleFetcher is implemented by providers exposing a public trade tape (crypto only).
type WhaleFetcher interface {
	FetchWhales(ctx context.Context, symbol string, top int) (*WhaleReport, error)
}

// FetchWhales reads the last ~1000 aggregated trades (Binance public tape) and returns the
// biggest prints plus taker buy/sell pressure. Real exchange data only.
func (b *BinanceProvider) FetchWhales(ctx context.Context, symbol string, top int) (*WhaleReport, error) {
	sym := strings.ToUpper(strings.TrimSpace(symbol))
	if sym == "" {
		return nil, fmt.Errorf("symbol required")
	}
	if top <= 0 || top > 100 {
		top = 25
	}
	var lastErr error
	for _, base := range b.BaseURLs {
		endpoint := fmt.Sprintf("%s/api/v3/aggTrades?symbol=%s&limit=1000", strings.TrimRight(base, "/"), sym)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			lastErr = err
			continue
		}
		resp, err := b.HTTPClient.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK || readErr != nil {
			lastErr = fmt.Errorf("binance aggTrades status %d from %s", resp.StatusCode, base)
			continue
		}
		return buildWhaleReport(sym, body, top)
	}
	return nil, lastErr
}

func buildWhaleReport(symbol string, body []byte, top int) (*WhaleReport, error) {
	var raw []struct {
		P string `json:"p"`
		Q string `json:"q"`
		T int64  `json:"T"`
		M bool   `json:"m"` // buyer is the maker => taker sold
		// Binance also sends "M" (best price match). encoding/json matches keys case-insensitively,
		// so without this exact-tag field "M" would overwrite "m" and every trade would look like a sell.
		BestMatch bool `json:"M"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}
	rep := &WhaleReport{Symbol: symbol, Trades: []WhaleTrade{}}
	all := make([]WhaleTrade, 0, len(raw))
	for _, r := range raw {
		p, e1 := strconv.ParseFloat(r.P, 64)
		q, e2 := strconv.ParseFloat(r.Q, 64)
		if e1 != nil || e2 != nil || p <= 0 || q <= 0 || r.T <= 0 {
			continue
		}
		side := "BUY"
		if r.M {
			side = "SELL"
		}
		t := WhaleTrade{Time: r.T / 1000, Price: p, Qty: q, Notional: p * q, Side: side}
		all = append(all, t)
		if side == "BUY" {
			rep.BuyVolume += t.Notional
		} else {
			rep.SellVolume += t.Notional
		}
		if rep.FromTime == 0 || t.Time < rep.FromTime {
			rep.FromTime = t.Time
		}
		if t.Time > rep.ToTime {
			rep.ToTime = t.Time
		}
	}
	rep.Sampled = len(all)
	sort.SliceStable(all, func(i, j int) bool { return all[i].Notional > all[j].Notional })
	if len(all) > top {
		all = all[:top]
	}
	rep.Trades = append(rep.Trades, all...)
	return rep, nil
}
