package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
)

// DividendEvent is a single cash dividend payment returned by Yahoo Finance.
type DividendEvent struct {
	Time   int64   `json:"time"` // unix seconds
	Amount float64 `json:"amount"`
}

// SplitEvent is a stock split event returned by Yahoo Finance (e.g. 4-for-1: Numerator=4, Denominator=1).
type SplitEvent struct {
	Time        int64   `json:"time"` // unix seconds
	Numerator   float64 `json:"numerator"`
	Denominator float64 `json:"denominator"`
	Ratio       string  `json:"ratio,omitempty"`
}

// EarningsEvent is a corporate earnings announcement returned by Yahoo Finance.
// Actual and Estimate remain nil whenever Yahoo does not report numeric EPS values (never fabricated).
type EarningsEvent struct {
	Time     int64    `json:"time"` // unix seconds
	Actual   *float64 `json:"actual,omitempty"`
	Estimate *float64 `json:"estimate,omitempty"`
}

// CorporateEvents bundles dividends, splits, and earnings for one equity symbol.
type CorporateEvents struct {
	Symbol    string          `json:"symbol"`
	Supported bool            `json:"supported"`
	Reason    string          `json:"reason,omitempty"`
	Dividends []DividendEvent `json:"dividends"`
	Splits    []SplitEvent    `json:"splits"`
	Earnings  []EarningsEvent `json:"earnings"`
}

// CorporateEventsFetcher is implemented by providers that can fetch real corporate actions.
type CorporateEventsFetcher interface {
	FetchCorporateEvents(ctx context.Context, symbol string, fromSec, toSec int64) (CorporateEvents, error)
}

// ParseYahooEvents extracts dividends, stock splits, and earnings from Yahoo v8 /chart JSON.
func ParseYahooEvents(symbol string, body []byte) (CorporateEvents, error) {
	var env struct {
		Chart struct {
			Result []struct {
				Events struct {
					Dividends map[string]struct {
						Amount float64 `json:"amount"`
						Date   int64   `json:"date"`
					} `json:"dividends"`
					Splits map[string]struct {
						Date        int64   `json:"date"`
						Numerator   float64 `json:"numerator"`
						Denominator float64 `json:"denominator"`
						SplitRatio  string  `json:"splitRatio"`
					} `json:"splits"`
					Earnings map[string]struct {
						Date     int64    `json:"date"`
						Raw      int64    `json:"raw"`
						Actual   *float64 `json:"epsActual"`
						Estimate *float64 `json:"epsEstimate"`
					} `json:"earnings"`
				} `json:"events"`
			} `json:"result"`
		} `json:"chart"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return CorporateEvents{}, fmt.Errorf("parse yahoo events: %w", err)
	}
	out := CorporateEvents{
		Symbol:    domain.NormalizeSymbol(symbol),
		Supported: true,
		Dividends: []DividendEvent{},
		Splits:    []SplitEvent{},
		Earnings:  []EarningsEvent{},
	}
	if len(env.Chart.Result) == 0 {
		return out, nil
	}
	ev := env.Chart.Result[0].Events
	for k, d := range ev.Dividends {
		ts := d.Date
		if ts <= 0 {
			ts, _ = strconv.ParseInt(k, 10, 64)
		}
		if ts > 0 && d.Amount > 0 {
			out.Dividends = append(out.Dividends, DividendEvent{Time: ts, Amount: d.Amount})
		}
	}
	for k, s := range ev.Splits {
		ts := s.Date
		if ts <= 0 {
			ts, _ = strconv.ParseInt(k, 10, 64)
		}
		if ts > 0 && s.Numerator > 0 && s.Denominator > 0 {
			out.Splits = append(out.Splits, SplitEvent{
				Time:        ts,
				Numerator:   s.Numerator,
				Denominator: s.Denominator,
				Ratio:       s.SplitRatio,
			})
		}
	}
	for k, e := range ev.Earnings {
		ts := e.Date
		if ts <= 0 {
			ts = e.Raw
		}
		if ts <= 0 {
			ts, _ = strconv.ParseInt(k, 10, 64)
		}
		if ts > 0 {
			out.Earnings = append(out.Earnings, EarningsEvent{
				Time:     ts,
				Actual:   e.Actual,
				Estimate: e.Estimate,
			})
		}
	}
	sort.Slice(out.Dividends, func(i, j int) bool { return out.Dividends[i].Time < out.Dividends[j].Time })
	sort.Slice(out.Splits, func(i, j int) bool { return out.Splits[i].Time < out.Splits[j].Time })
	sort.Slice(out.Earnings, func(i, j int) bool { return out.Earnings[i].Time < out.Earnings[j].Time })
	return out, nil
}

// FetchCorporateEvents queries Yahoo Finance v8 chart API for real dividend, split, and earnings events.
func (y *YahooProvider) FetchCorporateEvents(ctx context.Context, symbol string, fromSec, toSec int64) (CorporateEvents, error) {
	sym := domain.NormalizeSymbol(symbol)
	nowSec := time.Now().Unix()
	if toSec <= 0 || toSec > nowSec+86400 {
		toSec = nowSec
	}
	if fromSec <= 0 || fromSec >= toSec {
		fromSec = toSec - 86400*365*10
	}

	params := url.Values{}
	params.Set("interval", "1d")
	params.Set("period1", strconv.FormatInt(fromSec, 10))
	params.Set("period2", strconv.FormatInt(toSec, 10))
	params.Set("events", "div|split|earn")

	var lastErr error
	for _, base := range y.BaseURLs {
		endpoint := fmt.Sprintf("%s/v8/finance/chart/%s?%s", strings.TrimRight(base, "/"), url.PathEscape(sym), params.Encode())
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

		if resp.StatusCode == http.StatusOK && readErr == nil {
			ev, parseErr := ParseYahooEvents(sym, body)
			if parseErr == nil {
				return ev, nil
			}
			lastErr = parseErr
			continue
		}
		lastErr = fmt.Errorf("yahoo events status %d from %s", resp.StatusCode, base)
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no events returned from yahoo for %s", sym)
	}
	return CorporateEvents{}, lastErr
}
