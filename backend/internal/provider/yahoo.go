package provider

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
	"github.com/ersincebi/titanview/backend/internal/normalizer"
)

// YahooProvider fetches BIST (.IS) and US stocks from Yahoo Finance v8 Chart API.
type YahooProvider struct {
	BaseURLs   []string
	HTTPClient *http.Client
}

// NewYahooProvider creates a new Yahoo Finance chart provider.
func NewYahooProvider(client *http.Client) *YahooProvider {
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}
	return &YahooProvider{
		BaseURLs: []string{
			"https://query1.finance.yahoo.com",
			"https://query2.finance.yahoo.com",
		},
		HTTPClient: client,
	}
}

// mapToYahooInterval maps TitanView timeframe to Yahoo Finance chart interval and maximum allowed lookback seconds.
// Seconds intervals are honestly rejected because Yahoo Finance has no sub-minute candle endpoint.
func mapToYahooInterval(tf string) (yfInterval string, maxLookbackSec int64, err error) {
	norm := domain.NormalizeTimeframe(tf)
	n, unit, ok := domain.ParseTimeframe(norm)
	if !ok {
		return "15m", 86400 * 55, nil
	}
	switch unit {
	case "s":
		return "", 0, &UnsupportedIntervalError{
			Provider: string(domain.ProviderYahoo),
			Interval: norm,
			Reason:   fmt.Sprintf("Yahoo Finance saniyelik (%s) veri sağlamıyor; saniye aralıkları yalnızca kripto (Binance) sembollerinde desteklenir.", norm),
		}
	case "m":
		switch {
		case n == 1:
			return "1m", 86400 * 6, nil // Yahoo allows max 7 days for 1m
		case n == 2:
			return "2m", 86400 * 55, nil
		case n == 5:
			return "5m", 86400 * 55, nil
		case n == 15:
			return "15m", 86400 * 55, nil
		case n == 30:
			return "30m", 86400 * 55, nil
		case n == 90:
			return "90m", 86400 * 55, nil
		case n%15 == 0:
			return "15m", 86400 * 55, nil
		case n%5 == 0:
			return "5m", 86400 * 55, nil
		case n%2 == 0:
			return "2m", 86400 * 55, nil
		default:
			return "1m", 86400 * 6, nil
		}
	case "h":
		return "60m", 86400 * 700, nil // Yahoo allows max 730 days for 60m; multi-hour resamples from 60m
	case "d":
		return "1d", 86400 * 365 * 30, nil
	case "w":
		return "1wk", 86400 * 365 * 40, nil
	case "M":
		return "1mo", 86400 * 365 * 40, nil
	default:
		return "15m", 86400 * 55, nil
	}
}

// FetchHistory retrieves and normalizes historical & delayed intraday candles from Yahoo Finance.
func (y *YahooProvider) FetchHistory(ctx context.Context, symbol, timeframe string, fromSec, toSec int64) ([]domain.Candle, error) {
	sym := domain.NormalizeSymbol(symbol)
	tf := domain.NormalizeTimeframe(timeframe)
	yfInterval, maxLookback, err := mapToYahooInterval(tf)
	if err != nil {
		return nil, err
	}

	nowSec := time.Now().Unix()
	if toSec <= 0 || toSec > nowSec+3600 {
		toSec = nowSec
	}
	minAllowedFrom := nowSec - maxLookback
	if fromSec < minAllowedFrom {
		fromSec = minAllowedFrom
	}
	if fromSec >= toSec {
		fromSec = toSec - 86400*5
	}

	params := url.Values{}
	params.Set("interval", yfInterval)
	params.Set("period1", strconv.FormatInt(fromSec, 10))
	params.Set("period2", strconv.FormatInt(toSec, 10))
	params.Set("includePrePost", "false")
	params.Set("events", "div,splits")

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
			candles, normErr := normalizer.NormalizeYahooChart(sym, tf, body)
			if normErr == nil && len(candles) > 0 {
				return candles, nil
			}
			lastErr = normErr
			continue
		}
		lastErr = fmt.Errorf("yahoo finance status %d from %s", resp.StatusCode, base)
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("no candles returned from yahoo for %s", sym)
	}
	return nil, lastErr
}

// FetchLatestQuote performs a lightweight range=1d&interval={yfInterval} query on Yahoo Finance
// to retrieve the most recent candle for active ticker polling of BIST (.IS) and US symbols.
func (y *YahooProvider) FetchLatestQuote(ctx context.Context, symbol, timeframe string) (*domain.Candle, error) {
	sym := domain.NormalizeSymbol(symbol)
	tf := domain.NormalizeTimeframe(timeframe)
	yfInterval, _, err := mapToYahooInterval(tf)
	if err != nil {
		return nil, err
	}

	rng := "1d"
	switch yfInterval {
	case "1d":
		rng = "5d"
	case "1wk":
		rng = "1mo"
	case "1mo":
		rng = "1y"
	}

	params := url.Values{}
	params.Set("range", rng)
	params.Set("interval", yfInterval)
	params.Set("includePrePost", "false")

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
			candles, normErr := normalizer.NormalizeYahooChart(sym, tf, body)
			if normErr == nil && len(candles) > 0 {
				latest := candles[len(candles)-1]
				return &latest, nil
			}
			lastErr = normErr
			continue
		}
		lastErr = fmt.Errorf("yahoo finance latest quote status %d from %s", resp.StatusCode, base)
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("no latest quote returned from yahoo for %s", sym)
	}
	return nil, lastErr
}
