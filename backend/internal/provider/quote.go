package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strings"

	"github.com/ersincebi/titanview/backend/internal/domain"
)

// Quote is the live last price and the day change against the previous close (standard daily change).
type Quote struct {
	Symbol       string   `json:"symbol"`
	Last         float64  `json:"last"`
	PrevClose    float64  `json:"prevClose"`
	Change       float64  `json:"change"`
	ChangePct    float64  `json:"changePct"`
	Volume       *float64 `json:"volume,omitempty"`
	DayHigh      *float64 `json:"dayHigh,omitempty"`
	DayLow       *float64 `json:"dayLow,omitempty"`
	ExtPrice     *float64 `json:"extPrice,omitempty"`
	ExtChangePct *float64 `json:"extChangePct,omitempty"`
	ExtSession   string   `json:"extSession,omitempty"` // "pre" | "post" | ""
}

func newQuote(sym string, last, prev float64) (Quote, error) {
	if last <= 0 {
		return Quote{}, fmt.Errorf("no price for %s", sym)
	}
	q := Quote{Symbol: sym, Last: last, PrevClose: prev}
	if prev > 0 {
		q.Change = last - prev
		q.ChangePct = (last - prev) / prev * 100
	}
	return q, nil
}

// QuoteFetcher is implemented by providers that can return a live quote cheaply.
type QuoteFetcher interface {
	FetchQuote(ctx context.Context, symbol string) (Quote, error)
}

// parseYahooQuote reads regularMarketPrice and the previous close from a v8 chart "meta" block.
func parseYahooQuote(sym string, body []byte) (Quote, error) {
	var env struct {
		Chart struct {
			Result []struct {
				Meta struct {
					Price      float64  `json:"regularMarketPrice"`
					ChartPrev  float64  `json:"chartPreviousClose"`
					Prev       float64  `json:"previousClose"`
					Volume     *float64 `json:"regularMarketVolume"`
					DayHigh    *float64 `json:"regularMarketDayHigh"`
					DayLow     *float64 `json:"regularMarketDayLow"`
					PrePrice   *float64 `json:"preMarketPrice"`
					PreChgPct  *float64 `json:"preMarketChangePercent"`
					PostPrice  *float64 `json:"postMarketPrice"`
					PostChgPct *float64 `json:"postMarketChangePercent"`
				} `json:"meta"`
				Indicators struct {
					Quote []struct {
						Close  []*float64 `json:"close"`
						Volume []*float64 `json:"volume"`
						High   []*float64 `json:"high"`
						Low    []*float64 `json:"low"`
					} `json:"quote"`
				} `json:"indicators"`
			} `json:"result"`
		} `json:"chart"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return Quote{}, err
	}
	if len(env.Chart.Result) == 0 {
		return Quote{}, fmt.Errorf("empty yahoo quote for %s", sym)
	}
	res := env.Chart.Result[0]
	m := res.Meta
	prev := m.Prev
	if prev <= 0 && len(res.Indicators.Quote) > 0 {
		// On range=5d&interval=1d, Yahoo sets chartPreviousClose to 5 trading days ago.
		// The true previous trading session's close is the penultimate non-null daily close.
		var validCloses []float64
		for _, c := range res.Indicators.Quote[0].Close {
			if c != nil && *c > 0 {
				validCloses = append(validCloses, *c)
			}
		}
		if len(validCloses) >= 2 {
			prev = validCloses[len(validCloses)-2]
		}
	}
	if prev <= 0 {
		prev = m.ChartPrev
	}
	q, err := newQuote(sym, m.Price, prev)
	if err != nil {
		return Quote{}, err
	}
	if m.Volume != nil && *m.Volume > 0 {
		v := *m.Volume
		q.Volume = &v
	} else if len(res.Indicators.Quote) > 0 {
		vols := res.Indicators.Quote[0].Volume
		for i := len(vols) - 1; i >= 0; i-- {
			if vols[i] != nil && *vols[i] > 0 {
				v := *vols[i]
				q.Volume = &v
				break
			}
		}
	}
	if m.DayHigh != nil && *m.DayHigh > 0 {
		h := *m.DayHigh
		q.DayHigh = &h
	} else if len(res.Indicators.Quote) > 0 {
		highs := res.Indicators.Quote[0].High
		for i := len(highs) - 1; i >= 0; i-- {
			if highs[i] != nil && *highs[i] > 0 {
				h := *highs[i]
				q.DayHigh = &h
				break
			}
		}
	}
	if m.DayLow != nil && *m.DayLow > 0 {
		l := *m.DayLow
		q.DayLow = &l
	} else if len(res.Indicators.Quote) > 0 {
		lows := res.Indicators.Quote[0].Low
		for i := len(lows) - 1; i >= 0; i-- {
			if lows[i] != nil && *lows[i] > 0 {
				l := *lows[i]
				q.DayLow = &l
				break
			}
		}
	}
	if m.PostPrice != nil && *m.PostPrice > 0 {
		p := *m.PostPrice
		q.ExtPrice = &p
		q.ExtSession = "post"
		if m.PostChgPct != nil {
			pct := math.Round(*m.PostChgPct*100) / 100
			q.ExtChangePct = &pct
		} else if m.Price > 0 {
			pct := math.Round(((p-m.Price)/m.Price)*10000) / 100
			q.ExtChangePct = &pct
		}
	} else if m.PrePrice != nil && *m.PrePrice > 0 {
		p := *m.PrePrice
		q.ExtPrice = &p
		q.ExtSession = "pre"
		if m.PreChgPct != nil {
			pct := math.Round(*m.PreChgPct*100) / 100
			q.ExtChangePct = &pct
		} else if m.Price > 0 {
			pct := math.Round(((p-m.Price)/m.Price)*10000) / 100
			q.ExtChangePct = &pct
		}
	}
	return q, nil
}

// FetchQuote: range=5d&interval=1d keeps chartPreviousClose = the close before the latest session.
func (y *YahooProvider) FetchQuote(ctx context.Context, symbol string) (Quote, error) {
	sym := domain.NormalizeSymbol(symbol)
	params := url.Values{"range": {"5d"}, "interval": {"1d"}, "includePrePost": {"true"}}
	var lastErr error
	for _, base := range y.BaseURLs {
		ep := fmt.Sprintf("%s/v8/finance/chart/%s?%s", strings.TrimRight(base, "/"), url.PathEscape(sym), params.Encode())
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, ep, nil)
		if err != nil {
			lastErr = err
			continue
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
		resp, err := y.HTTPClient.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		body, rerr := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode == http.StatusOK && rerr == nil {
			q, qerr := parseYahooQuote(sym, body)
			if qerr == nil {
				return q, nil
			}
			lastErr = qerr
			continue
		}
		lastErr = fmt.Errorf("yahoo quote status %d", resp.StatusCode)
	}
	return Quote{}, lastErr
}

func parseBinanceTicker(sym string, body []byte) (Quote, error) {
	var t struct {
		Last string `json:"lastPrice"`
		Prev string `json:"prevClosePrice"`
		Open string `json:"openPrice"`
		High string `json:"highPrice"`
		Low  string `json:"lowPrice"`
		Vol  string `json:"volume"`
	}
	if err := json.Unmarshal(body, &t); err != nil {
		return Quote{}, err
	}
	var last, open, high, low, vol float64
	if _, err := fmt.Sscan(t.Last, &last); err != nil {
		return Quote{}, err
	}
	// 24h rolling window 24h rolling crypto window: change vs the price 24h ago.
	_, _ = fmt.Sscan(t.Open, &open)
	q, err := newQuote(sym, last, open)
	if err != nil {
		return Quote{}, err
	}
	if _, err := fmt.Sscan(t.Vol, &vol); err == nil && vol > 0 {
		q.Volume = &vol
	}
	if _, err := fmt.Sscan(t.High, &high); err == nil && high > 0 {
		q.DayHigh = &high
	}
	if _, err := fmt.Sscan(t.Low, &low); err == nil && low > 0 {
		q.DayLow = &low
	}
	return q, nil
}

// FetchQuote uses the 24h ticker.
func (b *BinanceProvider) FetchQuote(ctx context.Context, symbol string) (Quote, error) {
	sym := domain.NormalizeSymbol(symbol)
	var lastErr error
	for _, base := range b.BaseURLs {
		ep := fmt.Sprintf("%s/api/v3/ticker/24hr?symbol=%s", strings.TrimRight(base, "/"), url.QueryEscape(sym))
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
			q, qerr := parseBinanceTicker(sym, body)
			if qerr == nil {
				return q, nil
			}
			lastErr = qerr
			continue
		}
		lastErr = fmt.Errorf("binance ticker status %d", resp.StatusCode)
	}
	return Quote{}, lastErr
}

// Quote returns a live quote through the provider that owns the symbol.
func (c *CacheCoordinator) Quote(ctx context.Context, symbol string) (Quote, error) {
	if expr, err := domain.ParseSymbolExpr(symbol); err == nil && expr != nil && expr.IsComplex {
		lastVars := make(map[string]float64, len(expr.Symbols()))
		prevVars := make(map[string]float64, len(expr.Symbols()))
		for _, leg := range expr.Symbols() {
			q, err := c.Quote(ctx, leg)
			if err != nil {
				return Quote{}, err
			}
			lastVars[leg] = q.Last
			if q.PrevClose > 0 {
				prevVars[leg] = q.PrevClose
			} else {
				prevVars[leg] = q.Last
			}
		}
		lastVal, okL := expr.Eval(lastVars)
		prevVal, okP := expr.Eval(prevVars)
		if !okL || !okP {
			return Quote{}, fmt.Errorf("failed to evaluate expression quote for %s", symbol)
		}
		chg := lastVal - prevVal
		var pct float64
		if prevVal != 0 {
			pct = (chg / math.Abs(prevVal)) * 100
		}
		return Quote{
			Symbol:    strings.ToUpper(strings.TrimSpace(symbol)),
			Last:      lastVal,
			PrevClose: prevVal,
			Change:    chg,
			ChangePct: pct,
		}, nil
	}
	if qf, ok := c.RouteProvider(symbol).(QuoteFetcher); ok {
		return qf.FetchQuote(ctx, symbol)
	}
	return Quote{}, fmt.Errorf("no quote source for %s", symbol)
}
