// Package collector keeps candles of the user's favourite symbols flowing into SQLite in the
// background. The cache never deletes bars, so intraday history that upstream sources only serve
// for a short window (Yahoo 15m ~60d, 1h ~2y) keeps growing for as long as the symbol is tracked.
package collector

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/ersincebi/titanview/backend/internal/sources"
)

// Timeframes collected for every tracked symbol.
var Timeframes = []string{"15m", "1h"}

// Source lists the symbols to track and fetches (and thereby caches) their candles.
type Source interface {
	ListCollectSymbols(ctx context.Context) ([]string, error)
}

// Fetcher pulls the default recent window, which also refreshes the live tail into the cache.
type Fetcher interface {
	Collect(ctx context.Context, symbol, timeframe string) (int, error)
}

// RunOnce collects every tracked symbol/timeframe once; returns the number of successful fetches.
func RunOnce(ctx context.Context, src Source, f Fetcher) (ok, failed int) {
	syms, err := src.ListCollectSymbols(ctx)
	if err != nil {
		log.Printf("collector: list symbols: %v", err)
		return 0, 0
	}
	for _, sym := range syms {
		for _, tf := range Timeframes {
			if ctx.Err() != nil {
				return ok, failed
			}
			if _, err := f.Collect(ctx, sym, tf); err != nil {
				if errors.Is(err, sources.ErrUnofficialDisabled) {
					continue
				}
				failed++
				log.Printf("collector: %s %s: %v", sym, tf, err)
				continue
			}
			ok++
		}
	}
	return ok, failed
}

// Run collects immediately, then every interval, until ctx is cancelled.
func Run(ctx context.Context, src Source, f Fetcher, interval time.Duration) {
	if interval <= 0 {
		return
	}
	RunOnce(ctx, src, f)
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			RunOnce(ctx, src, f)
		}
	}
}
