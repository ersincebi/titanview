package provider

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
)

// GetHistoryWithCurrency fulfills a history request (single symbol or arithmetic symbol expression)
// and optionally converts OHLC prices into targetCurrency using real Yahoo Finance FX rates.
func (c *CacheCoordinator) GetHistoryWithCurrency(ctx context.Context, rawSymbol, rawTimeframe string, fromSec, toSec int64, targetCurrency string) (*HistoryResult, error) {
	res, err := c.GetHistory(ctx, rawSymbol, rawTimeframe, fromSec, toSec)
	if err != nil || res == nil {
		return res, err
	}
	res.NativeCurrency = res.Currency
	targetCur := strings.ToUpper(strings.TrimSpace(targetCurrency))
	if targetCur == "" {
		return res, nil
	}
	fxSym, invert, needed, ok := domain.ResolveCurrencyConversion(res.Currency, targetCur)
	if !ok || !needed || len(res.Candles) == 0 {
		return res, nil
	}

	fxFrom := res.Candles[0].Timestamp - 86400*10
	fxTo := res.Candles[len(res.Candles)-1].Timestamp + 86400*2
	fxTf := res.Interval
	// Yahoo FX does not offer seconds bars; use daily/hourly FX for sub-minute or when intraday FX fails.
	if _, unit, ok := domain.ParseTimeframe(fxTf); ok && unit == "s" {
		fxTf = "1h"
	}
	fxRes, fxErr := c.GetHistory(ctx, fxSym, fxTf, fxFrom, fxTo)
	if fxErr != nil || fxRes == nil || len(fxRes.Candles) == 0 {
		fxRes, fxErr = c.GetHistory(ctx, fxSym, "1d", fxFrom, fxTo)
	}
	if fxErr == nil && fxRes != nil && len(fxRes.Candles) > 0 {
		res.Candles = domain.ConvertCandlesWithFx(res.Candles, fxRes.Candles, invert, targetCur)
		res.Currency = targetCur
	}
	return res, nil
}

func (c *CacheCoordinator) getExpressionHistory(ctx context.Context, expr *domain.SymbolExpr, rawSymbol, rawTimeframe string, fromSec, toSec int64) (*HistoryResult, error) {
	start := time.Now()
	info := domain.ResolveSymbolInfo(rawSymbol)
	tf := domain.NormalizeTimeframe(rawTimeframe)
	legs := expr.Symbols()

	series := make(map[string][]domain.Candle, len(legs))
	var mu sync.Mutex
	var firstErr error
	var allCacheHit = true
	var totalGaps int

	var wg sync.WaitGroup
	for _, leg := range legs {
		wg.Add(1)
		go func(sym string) {
			defer wg.Done()
			res, err := c.GetHistory(ctx, sym, tf, fromSec, toSec)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				if firstErr == nil {
					firstErr = err
				}
				return
			}
			if res != nil {
				series[sym] = res.Candles
				if !res.CacheHit {
					allCacheHit = false
				}
				totalGaps += res.FetchedGaps
			}
		}(leg)
	}
	wg.Wait()

	if firstErr != nil {
		return nil, firstErr
	}

	merged := domain.MergeExpressionCandles(expr, series, tf)
	elapsedMs := float64(time.Since(start).Microseconds()) / 1000.0
	return &HistoryResult{
		Symbol:         strings.ToUpper(strings.TrimSpace(rawSymbol)),
		Interval:       tf,
		DisplayName:    info.DisplayName,
		Market:         info.Market,
		Currency:       info.Currency,
		NativeCurrency: info.Currency,
		Provider:       info.Provider,
		DelayMinutes:   info.DelayMinutes,
		CacheHit:       allCacheHit,
		FetchedGaps:    totalGaps,
		QueryMs:        elapsedMs,
		Candles:        merged,
	}, nil
}
