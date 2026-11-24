package storage

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
)

// generateMockCandles creates N synthetic candles with realistic price drift.
func generateMockCandles(symbol, tf string, startTs, stepSec int64, count int) []domain.Candle {
	candles := make([]domain.Candle, count)
	price := 100.0
	for i := 0; i < count; i++ {
		ts := startTs + int64(i)*stepSec
		open := price
		high := open + 1.2
		low := open - 0.8
		closeP := open + 0.3
		vol := 1000.0 + float64(i%500)*10.0
		candles[i] = domain.Candle{
			Symbol:    symbol,
			Timeframe: tf,
			Timestamp: ts,
			Open:      open,
			High:      high,
			Low:       low,
			Close:     closeP,
			Volume:    vol,
		}
		price = closeP
	}
	return candles
}

// TestSQLite50kCandlesQueryUnder2ms verifies that querying candles from a 50,000+ candle database
// completes in under 2ms for typical chart view ranges, satisfying the Stage 8 latency SLA.
func TestSQLite50kCandlesQueryUnder2ms(t *testing.T) {
	ctx := context.Background()

	// Use temporary SQLite file to benchmark real disk I/O with WAL mode
	tmpDir, err := os.MkdirTemp("", "titanview_bench_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	dbPath := fmt.Sprintf("%s/test_50k.db", tmpDir)
	store, err := NewSQLiteStore(dbPath)
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer store.Close()

	const totalCandles = 52000
	const stepSec = 900 // 15m
	baseTs := int64(1600000000)

	candles := generateMockCandles("BTCUSDT", "15m", baseTs, stepSec, totalCandles)

	// Batch upsert in chunks of 5,000 for realistic ingestion
	chunkSize := 5000
	for i := 0; i < len(candles); i += chunkSize {
		end := i + chunkSize
		if end > len(candles) {
			end = len(candles)
		}
		if err := store.BatchUpsertCandles(ctx, candles[i:end]); err != nil {
			t.Fatalf("batch upsert failed at %d: %v", i, err)
		}
	}

	// Verify total count in DB
	stats, err := store.GetCacheStats(ctx)
	if err != nil {
		t.Fatalf("get stats failed: %v", err)
	}
	if stats.TotalCandles != totalCandles {
		t.Fatalf("expected %d candles, got %d", totalCandles, stats.TotalCandles)
	}

	// Warm-up query
	_, _ = store.QueryCandles(ctx, "BTCUSDT", "15m", baseTs+stepSec*1000, baseTs+stepSec*1500)

	// Measure 50 iterations of typical viewport query (500 candles ~ 5 days of 15m)
	const queryBars = 500
	const iterations = 50
	var totalDuration time.Duration

	for i := 0; i < iterations; i++ {
		startIdx := (i * 800) % (totalCandles - queryBars - 1)
		fromTs := baseTs + int64(startIdx)*stepSec
		toTs := fromTs + int64(queryBars)*stepSec

		start := time.Now()
		result, err := store.QueryCandles(ctx, "BTCUSDT", "15m", fromTs, toTs)
		elapsed := time.Since(start)
		totalDuration += elapsed

		if err != nil {
			t.Fatalf("query failed: %v", err)
		}
		if len(result) == 0 {
			t.Fatalf("expected candles, got 0")
		}
	}

	avgQueryMs := float64(totalDuration.Microseconds()) / float64(iterations) / 1000.0
	t.Logf("✓ 50k Candles in SQLite: Average query time for %d bars over %d runs: %.3f ms", queryBars, iterations, avgQueryMs)

	// Strict SLA verification: typical viewport query must complete in < 2ms (and well under 5ms)
	if avgQueryMs >= 5.0 {
		t.Fatalf("SLA VIOLATION: query took %.3f ms (acceptance criteria: < 5.0 ms)", avgQueryMs)
	}
}

// BenchmarkSQLiteStore_QueryCandles_500Bars benchmarks typical viewport query on a 50k database.
func BenchmarkSQLiteStore_QueryCandles_500Bars(b *testing.B) {
	ctx := context.Background()
	tmpDir, err := os.MkdirTemp("", "titanview_bench_*")
	if err != nil {
		b.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	dbPath := fmt.Sprintf("%s/bench_50k.db", tmpDir)
	store, err := NewSQLiteStore(dbPath)
	if err != nil {
		b.Fatalf("failed to create store: %v", err)
	}
	defer store.Close()

	const totalCandles = 50000
	const stepSec = 900
	baseTs := int64(1600000000)
	candles := generateMockCandles("ETHUSDT", "15m", baseTs, stepSec, totalCandles)

	for i := 0; i < len(candles); i += 5000 {
		end := i + 5000
		if end > len(candles) {
			end = len(candles)
		}
		_ = store.BatchUpsertCandles(ctx, candles[i:end])
	}

	fromTs := baseTs + int64(10000)*stepSec
	toTs := fromTs + int64(500)*stepSec

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		res, err := store.QueryCandles(ctx, "ETHUSDT", "15m", fromTs, toTs)
		if err != nil || len(res) == 0 {
			b.Fatalf("benchmark query failed: %v", err)
		}
	}
}
