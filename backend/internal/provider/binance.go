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
	"github.com/gorilla/websocket"
)

// BinanceProvider fetches historical klines and live WebSocket streams from Binance Public API.
type BinanceProvider struct {
	BaseURLs    []string
	WSBaseURLs  []string
	HTTPClient  *http.Client
	PageLimit   int
	MaxPages    int
	BackoffBase time.Duration
}

// NewBinanceProvider creates a new Binance REST + WS provider with public mirror endpoints.
func NewBinanceProvider(client *http.Client) *BinanceProvider {
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}
	return &BinanceProvider{
		BaseURLs: []string{
			"https://data-api.binance.vision",
			"https://api.binance.com",
			"https://api1.binance.com",
		},
		WSBaseURLs: []string{
			"wss://stream.binance.com:9443/ws",
			"wss://data-stream.binance.vision/ws",
		},
		HTTPClient:  client,
		PageLimit:   1000,
		MaxPages:    10,
		BackoffBase: time.Second,
	}
}

var binanceNativeIntervals = map[string]bool{
	"1s": true, "1m": true, "3m": true, "5m": true, "15m": true, "30m": true,
	"1h": true, "2h": true, "4h": true, "6h": true, "8h": true, "12h": true,
	"1d": true, "3d": true, "1w": true, "1M": true,
}

// BinanceBaseInterval returns the finest native Binance kline interval to fetch/stream for tf,
// and whether resampling into tf is required.
func BinanceBaseInterval(rawTf string) (base string, needResample bool) {
	tf := domain.NormalizeTimeframe(rawTf)
	if binanceNativeIntervals[tf] {
		return tf, false
	}
	n, unit, ok := domain.ParseTimeframe(tf)
	if !ok {
		return "15m", false
	}
	switch unit {
	case "s":
		return "1s", true
	case "m":
		switch {
		case n%15 == 0:
			return "15m", true
		case n%5 == 0:
			return "5m", true
		case n%3 == 0:
			return "3m", true
		default:
			return "1m", true
		}
	case "h":
		if n%2 == 0 {
			return "2h", true
		}
		return "1h", true
	case "d":
		if n%3 == 0 {
			return "3d", true
		}
		return "1d", true
	case "w":
		return "1w", true
	case "M":
		return "1M", true
	default:
		return "15m", false
	}
}

// FetchHistory retrieves normalized candles for [fromSec, toSec] from Binance /api/v3/klines.
// Non-native intervals (e.g. 5s, 30s, 3h, 2d, 3M, 6M, 12M) fetch their native base interval and resample cleanly.
func (b *BinanceProvider) FetchHistory(ctx context.Context, symbol, timeframe string, fromSec, toSec int64) ([]domain.Candle, error) {
	sym := domain.NormalizeSymbol(symbol)
	tf := domain.NormalizeTimeframe(timeframe)
	baseTf, needResample := BinanceBaseInterval(tf)
	stepSec := domain.TimeframeSeconds(baseTf)

	pageLimit := b.PageLimit
	if pageLimit <= 0 {
		pageLimit = 1000
	}
	maxPages := b.MaxPages
	if maxPages <= 0 {
		maxPages = 10
	}

	startSec := fromSec
	if needResample && startSec > 0 {
		// Align start down to the target bucket boundary so the first resampled bar has full OHLCV.
		aligned := normalizer.BucketStart(startSec, tf)
		if aligned > 0 && aligned < startSec {
			startSec = aligned
		}
	}

	var allCandles []domain.Candle
	curStartMs := startSec * 1000
	endMs := toSec * 1000

	for page := 0; page < maxPages && curStartMs <= endMs; page++ {
		rawBody, err := b.fetchPage(ctx, sym, baseTf, curStartMs, endMs, pageLimit)
		if err != nil {
			if len(allCandles) > 0 {
				break
			}
			return nil, err
		}

		batch, err := normalizer.NormalizeBinanceKlines(sym, baseTf, rawBody)
		if err != nil {
			return nil, err
		}
		if len(batch) == 0 {
			break
		}

		allCandles = append(allCandles, batch...)
		lastTs := batch[len(batch)-1].Timestamp
		var nextStartSec int64
		if baseTf == "1M" {
			nextStartSec = time.Unix(lastTs, 0).UTC().AddDate(0, 1, 0).Unix()
		} else {
			nextStartSec = lastTs + stepSec
		}
		if nextStartSec*1000 <= curStartMs || len(batch) < pageLimit {
			break
		}
		curStartMs = nextStartSec * 1000
	}

	sorted := normalizer.SortAndDeduplicateCandles(allCandles)
	if needResample {
		return normalizer.ResampleToTimeframe(sorted, sym, tf), nil
	}
	return sorted, nil
}

// StreamLive opens a live WebSocket kline stream (wss://stream.binance.com:9443/ws/{symbol_lower}@kline_{interval})
// and automatically reconnects with exponential backoff (1s, 2s, 4s, 8s) on disconnect until ctx is cancelled.
func (b *BinanceProvider) StreamLive(ctx context.Context, symbol, interval string, onCandle func(candle domain.Candle, isClosed bool)) error {
	symLower := strings.ToLower(domain.NormalizeSymbol(symbol))
	tf := domain.NormalizeTimeframe(interval)

	wsBases := b.WSBaseURLs
	if len(wsBases) == 0 {
		wsBases = []string{"wss://stream.binance.com:9443/ws"}
	}
	baseBackoff := b.BackoffBase
	if baseBackoff <= 0 {
		baseBackoff = time.Second
	}

	dialer := websocket.Dialer{HandshakeTimeout: 5 * time.Second}
	attempt := 0

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		wsBase := strings.TrimRight(wsBases[attempt%len(wsBases)], "/")
		wsURL := fmt.Sprintf("%s/%s@kline_%s", wsBase, symLower, tf)

		conn, _, err := dialer.DialContext(ctx, wsURL, nil)
		if err != nil {
			shift := attempt
			if shift > 3 {
				shift = 3 // Cap exponential backoff at 8x base (1s, 2s, 4s, 8s)
			}
			wait := baseBackoff * time.Duration(1<<shift)
			attempt++
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(wait):
				continue
			}
		}

		// Reset backoff attempt counter once connected
		attempt = 0
		for {
			select {
			case <-ctx.Done():
				_ = conn.Close()
				return ctx.Err()
			default:
			}

			_ = conn.SetReadDeadline(time.Now().Add(20 * time.Second))
			_, rawMsg, readErr := conn.ReadMessage()
			if readErr != nil {
				_ = conn.Close()
				break
			}

			candle, isClosed, normErr := normalizer.NormalizeBinanceWSKline(rawMsg)
			if normErr == nil && onCandle != nil {
				if candle.Symbol == "" {
					candle.Symbol = domain.NormalizeSymbol(symbol)
				}
				if candle.Timeframe == "" {
					candle.Timeframe = tf
				}
				onCandle(candle, isClosed)
			}
		}

		// Disconnected mid-stream: wait baseBackoff before reconnecting
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(baseBackoff):
		}
	}
}

func (b *BinanceProvider) fetchPage(ctx context.Context, symbol, interval string, startMs, endMs int64, limit int) ([]byte, error) {
	params := url.Values{}
	params.Set("symbol", strings.ToUpper(symbol))
	params.Set("interval", interval)
	if startMs > 0 {
		params.Set("startTime", strconv.FormatInt(startMs, 10))
	}
	if endMs > 0 {
		params.Set("endTime", strconv.FormatInt(endMs, 10))
	}
	params.Set("limit", strconv.Itoa(limit))

	var lastErr error
	for _, base := range b.BaseURLs {
		endpoint := fmt.Sprintf("%s/api/v3/klines?%s", strings.TrimRight(base, "/"), params.Encode())
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			lastErr = err
			continue
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("User-Agent", "TitanView/1.0")

		resp, err := b.HTTPClient.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		body, readErr := io.ReadAll(resp.Body)
		_ = resp.Body.Close()

		if resp.StatusCode == http.StatusOK && readErr == nil {
			return body, nil
		}
		lastErr = fmt.Errorf("binance status %d from %s", resp.StatusCode, base)
	}
	return nil, lastErr
}
