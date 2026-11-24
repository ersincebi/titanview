package provider

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sync/atomic"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
	"github.com/ersincebi/titanview/backend/internal/storage"
	"golang.org/x/sync/singleflight"
)

// MarketProvider is the standard market data provider contract.
type MarketProvider interface {
	FetchHistory(ctx context.Context, symbol, timeframe string, fromSec, toSec int64) ([]domain.Candle, error)
}

// maxBinanceBars is how many bars one Binance history call can fetch (1000/page x 10 pages) with margin.
const maxBinanceBars = 9000

// UpstreamProvider is an alias for MarketProvider implemented by BinanceProvider and YahooProvider.
type UpstreamProvider = MarketProvider

// HistoryResult encapsulates the returned candles and cache diagnostics.
type HistoryResult struct {
	Symbol         string              `json:"symbol"`
	Interval       string              `json:"interval"`
	DisplayName    string              `json:"displayName"`
	Market         domain.MarketType   `json:"market"`
	Currency       string              `json:"currency"`
	NativeCurrency string              `json:"nativeCurrency,omitempty"`
	Provider       domain.ProviderType `json:"provider"`
	DelayMinutes   int                 `json:"delayMinutes"`
	CacheHit       bool                `json:"cacheHit"`
	FetchedGaps    int                 `json:"fetchedGaps"`
	QueryMs        float64             `json:"queryMs"`
	Candles        []domain.Candle     `json:"candles"`
}

// CacheCoordinator orchestrates SQLite cache lookups, smart gap detection, singleflight deduplication,
// and upstream provider calls.
type CacheCoordinator struct {
	Store         *storage.SQLiteStore
	Binance       UpstreamProvider
	Yahoo         UpstreamProvider
	sf            singleflight.Group
	totalRequests atomic.Int64
	cacheHits     atomic.Int64
}

// NewCacheCoordinator creates a ready-to-use CacheCoordinator.
func NewCacheCoordinator(store *storage.SQLiteStore, binance, yahoo UpstreamProvider) *CacheCoordinator {
	if binance == nil {
		binance = NewBinanceProvider(nil)
	}
	if yahoo == nil {
		yahoo = NewYahooProvider(nil)
	}
	return &CacheCoordinator{
		Store:   store,
		Binance: binance,
		Yahoo:   yahoo,
	}
}

// HitStats returns total history requests, cache hits and the hit ratio.
func (c *CacheCoordinator) HitStats() (totalRequests, hits int64, hitRatio float64) {
	tot := c.totalRequests.Load()
	h := c.cacheHits.Load()
	var ratio float64
	if tot > 0 {
		ratio = float64(h) / float64(tot)
	}
	return tot, h, math.Round(ratio*1000) / 1000
}

// RouteProvider selects the appropriate UpstreamProvider (BINANCE or YAHOO) for a symbol.
func (c *CacheCoordinator) RouteProvider(symbol string) UpstreamProvider {
	if domain.DetectProvider(symbol) == domain.ProviderBinance {
		return c.Binance
	}
	return c.Yahoo
}

// GetHistory fulfills a history request using the Cache-First / Smart Gap-Fill strategy.
func (c *CacheCoordinator) GetHistory(ctx context.Context, rawSymbol, rawTimeframe string, fromSec, toSec int64) (*HistoryResult, error) {
	if expr, err := domain.ParseSymbolExpr(rawSymbol); err == nil && expr != nil && expr.IsComplex {
		return c.getExpressionHistory(ctx, expr, rawSymbol, rawTimeframe, fromSec, toSec)
	}
	start := time.Now()
	c.totalRequests.Add(1)
	info := domain.ResolveSymbolInfo(rawSymbol)
	tf := domain.NormalizeTimeframe(rawTimeframe)
	stepSec := domain.TimeframeSeconds(tf)

	nowSec := time.Now().Unix()
	if toSec <= 0 {
		toSec = nowSec
	}
	if fromSec <= 0 || fromSec >= toSec {
		fromSec = toSec - domain.DefaultHistoryLookbackSeconds(tf)
		// Binance pages forward from `from` (<= PageLimit*MaxPages bars): an over-wide default window would
		// return the OLDEST bars and miss the recent ones, so clamp to what one request can fully cover.
		if info.Provider == domain.ProviderBinance {
			baseTf, _ := BinanceBaseInterval(tf)
			baseStep := domain.TimeframeSeconds(baseTf)
			if maxSpan := maxBinanceBars * baseStep; toSec-fromSec > maxSpan {
				fromSec = toSec - maxSpan
			}
		}
	}

	minTs, maxTs, count, err := c.Store.GetCoverage(ctx, info.Symbol, tf)
	if err != nil {
		return nil, fmt.Errorf("coverage check failed: %w", err)
	}

	// Compute missing gaps. Allow a small tolerance on the right edge (2 steps) so rapid reloads hit SQLite directly.
	effectiveTo := toSec
	if count > 0 && toSec-maxTs < stepSec*2 {
		effectiveTo = maxTs
	}
	gaps := storage.ComputeMissingGaps(minTs, maxTs, count, fromSec, effectiveTo, stepSec)

	// Faz 30: kapsama yalnız min/max/sayı ile hesaplandığı için [min, max] İÇİNDEKİ boşluklar (ör. yarıda kalmış
	// eski bir çekim) hiç doldurulmuyordu; boş pencere sorgusu "son 400 mum"a düşüp grafiği "eski veri yok"
	// sanıyordu. 7/24 kesintisiz Binance sembollerinde pencere beklenenin %90'ından azsa yeniden çekilir.
	holeGaps := map[domain.GapRange]bool{}
	holeTo := toSec // effectiveTo geçmiş pencerelerde maxTs'ye uzar; iç boşluk için istenen pencerenin kendisi
	if holeTo > maxTs {
		holeTo = maxTs
	}
	if info.Provider == domain.ProviderBinance && count > 0 && fromSec >= minTs && holeTo > fromSec && stepSec > 0 {
		expected := (holeTo - fromSec) / stepSec
		if expected >= 10 && expected <= int64(maxBinanceBars) {
			if n, cErr := c.Store.CountCandlesInRange(ctx, info.Symbol, tf, fromSec, holeTo); cErr == nil && n < expected*9/10 {
				hg := domain.GapRange{From: fromSec, To: holeTo}
				gaps = append(gaps, hg)
				holeGaps[hg] = true
			}
		}
	}

	// Live edge: the forming bar changes until it closes, so refresh the tail whenever the last
	// upstream refresh is older than the TTL, regardless of the 2-step tolerance above.
	// Bars persisted by the live feed after the last REST refresh are unverified (a bar that closed
	// while the socket was down keeps partial OHLC), so the refresh starts at that mark, bounded.
	tailRefresh := false
	lastFetched := c.Store.LastFetchedAt(ctx, info.Symbol, tf)
	if count > 0 && toSec >= nowSec-stepSec && nowSec-lastFetched >= tailTTLSeconds(stepSec) {
		tailFrom := toSec - stepSec*3
		if verifyFrom := unverifiedFrom(lastFetched, minTs, toSec, stepSec); verifyFrom < tailFrom {
			tailFrom = verifyFrom
		} else if tailFrom < fromSec {
			tailFrom = fromSec
		}
		gaps = append(gaps, domain.GapRange{From: tailFrom, To: toSec})
		tailRefresh = true
	}

	var lastFetchErr error
	fetchedGaps := 0
	for _, gap := range gaps {
		g := gap
		sfKey := fmt.Sprintf("%s:%s:%d:%d", info.Symbol, tf, g.From/stepSec, g.To/stepSec)
		_, fetchErr, _ := c.sf.Do(sfKey, func() (interface{}, error) {
			// Double-check SQLite coverage inside singleflight in case an earlier flight just filled this gap.
			curMin, curMax, curCount, covErr := c.Store.GetCoverage(ctx, info.Symbol, tf)
			if covErr == nil && curCount > 0 && !(tailRefresh && g.To == toSec) && !holeGaps[g] {
				curEffTo := g.To
				if g.To-curMax < stepSec*2 {
					curEffTo = curMax
				}
				rem := storage.ComputeMissingGaps(curMin, curMax, curCount, g.From, curEffTo, stepSec)
				if len(rem) == 0 {
					return nil, nil
				}
			}

			upstream := c.RouteProvider(info.Symbol)
			fetched, err := upstream.FetchHistory(ctx, info.Symbol, tf, g.From, g.To)
			if err != nil || len(fetched) == 0 {
				if tailRefresh && g.To == toSec {
					// Market closed / upstream hiccup: remember the attempt so we don't hammer upstream.
					_ = c.Store.TouchFetchedAt(ctx, info.Symbol, tf)
				}
				return nil, err
			}
			if upErr := c.Store.BatchUpsertCandles(ctx, fetched); upErr != nil {
				return nil, upErr
			}
			if g.To >= nowSec-stepSec {
				_ = c.Store.RecordFetchedRange(ctx, info.Symbol, tf, g.From, g.To)
			} else {
				_ = c.Store.RecordFetchedRangeHistoric(ctx, info.Symbol, tf, g.From, g.To)
			}
			return fetched, nil
		})
		if fetchErr != nil {
			lastFetchErr = fetchErr
		} else {
			fetchedGaps++
		}
	}

	candles, err := c.Store.QueryCandles(ctx, info.Symbol, tf, fromSec, toSec)
	if err != nil {
		return nil, err
	}

	// If market was closed in [fromSec, toSec] (e.g., BIST/US over weekend or narrow window), return latest cached candles
	if len(candles) == 0 {
		candles, _ = c.Store.GetLatestCandles(ctx, info.Symbol, tf, 400)
	}

	// No data and upstream failed: surface unsupported interval cleanly (422) or upstream error (502).
	if len(candles) == 0 && lastFetchErr != nil {
		var unsup *UnsupportedIntervalError
		if errors.As(lastFetchErr, &unsup) {
			return nil, unsup
		}
		return nil, &UpstreamError{Provider: string(info.Provider), Err: lastFetchErr}
	}

	elapsedMs := float64(time.Since(start).Microseconds()) / 1000.0
	isCacheHit := len(gaps) == 0 && count > 0
	if isCacheHit {
		c.cacheHits.Add(1)
	}

	return &HistoryResult{
		Symbol:       info.Symbol,
		Interval:     tf,
		DisplayName:  info.DisplayName,
		Market:       info.Market,
		Currency:     info.Currency,
		Provider:     info.Provider,
		DelayMinutes: info.DelayMinutes,
		CacheHit:     isCacheHit,
		FetchedGaps:  fetchedGaps,
		QueryMs:      elapsedMs,
		Candles:      candles,
	}, nil
}

// maxVerifyBars bounds the unverified-tail re-fetch (one Binance page set, Yahoo intraday limits).
const maxVerifyBars = 1000

// unverifiedFrom is where re-verification of live-feed-written bars starts: the bar that was forming at the
// last REST refresh (or the oldest cached bar / maxVerifyBars back when the series was never refreshed).
func unverifiedFrom(lastFetched, minTs, toSec, stepSec int64) int64 {
	floor := toSec - maxVerifyBars*stepSec
	if floor < minTs {
		floor = minTs
	}
	from := lastFetched - stepSec
	if lastFetched <= 0 || from < floor {
		from = floor
	}
	return from
}

// tailTTLSeconds is how long the live edge may be served from cache before re-fetching:
// a quarter bar (15s..5min) for minute+ frames, or 2..29s for sub-minute frames.
func tailTTLSeconds(stepSec int64) int64 {
	if stepSec < 60 {
		ttl := stepSec / 2
		if ttl < 2 {
			return 2
		}
		return ttl
	}
	ttl := stepSec / 4
	if ttl < 15 {
		return 15
	}
	if ttl > 300 {
		return 300
	}
	return ttl
}

// UnsupportedIntervalError signals that an upstream provider does not offer the requested interval
// (e.g. Yahoo Finance for seconds intervals). Never fabricated.
type UnsupportedIntervalError struct {
	Provider string
	Interval string
	Reason   string
}

func (e *UnsupportedIntervalError) Error() string { return e.Reason }

// UpstreamError marks a failed upstream fetch with no cached data to fall back on.
type UpstreamError struct {
	Provider string
	Err      error
}

func (e *UpstreamError) Error() string { return e.Provider + " upstream: " + e.Err.Error() }
func (e *UpstreamError) Unwrap() error { return e.Err }

// Collect fetches the default recent window for a symbol (refreshing the live tail) so the bars are
// persisted; used by the background favourites collector. Returns the bar count.
func (c *CacheCoordinator) Collect(ctx context.Context, symbol, timeframe string) (int, error) {
	res, err := c.GetHistory(ctx, symbol, timeframe, 0, 0)
	if err != nil {
		return 0, err
	}
	return len(res.Candles), nil
}
