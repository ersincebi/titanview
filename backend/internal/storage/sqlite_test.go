package storage

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/ersincebi/titanview/backend/internal/domain"
)

func TestSQLiteStoreAndSmartGapFill(t *testing.T) {
	ctx := context.Background()
	store, err := NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatalf("failed to create memory sqlite store: %v", err)
	}
	defer store.Close()

	// 1. Initially empty -> full gap
	minTs, maxTs, count, err := store.GetCoverage(ctx, "BTCUSDT", "4h")
	if err != nil {
		t.Fatalf("get coverage err: %v", err)
	}
	gaps := ComputeMissingGaps(minTs, maxTs, count, 10000, 50000, 14400)
	if len(gaps) != 1 || gaps[0].From != 10000 || gaps[0].To != 50000 {
		t.Fatalf("expected 1 full gap [10000, 50000], got %+v", gaps)
	}

	// 2. Insert candles covering [20000, 40000]
	batch := []domain.Candle{
		{Symbol: "BTCUSDT", Timeframe: "4h", Timestamp: 20000, Open: 80000, High: 81000, Low: 79500, Close: 80500, Volume: 120},
		{Symbol: "BTCUSDT", Timeframe: "4h", Timestamp: 30000, Open: 80500, High: 82000, Low: 80100, Close: 81800, Volume: 185},
		{Symbol: "BTCUSDT", Timeframe: "4h", Timestamp: 40000, Open: 81800, High: 83000, Low: 81500, Close: 82900, Volume: 210},
	}
	if err := store.BatchUpsertCandles(ctx, batch); err != nil {
		t.Fatalf("batch upsert failed: %v", err)
	}

	minTs, maxTs, count, err = store.GetCoverage(ctx, "BTCUSDT", "4h")
	if err != nil || count != 3 || minTs != 20000 || maxTs != 40000 {
		t.Fatalf("unexpected coverage: min=%d max=%d count=%d err=%v", minTs, maxTs, count, err)
	}

	// 3. Request [20000, 40000] -> FULL CACHE HIT (0 missing gaps!)
	hitGaps := ComputeMissingGaps(minTs, maxTs, count, 20000, 40000, 1000)
	if len(hitGaps) != 0 {
		t.Fatalf("expected 0 missing gaps on cache hit, got %+v", hitGaps)
	}

	// 4. Request [10000, 50000] -> should detect both Left Gap and Right Gap
	bothGaps := ComputeMissingGaps(minTs, maxTs, count, 10000, 50000, 1000)
	if len(bothGaps) != 2 {
		t.Fatalf("expected 2 gaps (leading + trailing), got %+v", bothGaps)
	}

	// 5. Query candles back
	queried, err := store.QueryCandles(ctx, "BTCUSDT", "4h", 20000, 40000)
	if err != nil || len(queried) != 3 {
		t.Fatalf("expected 3 queried candles, got %d (err=%v)", len(queried), err)
	}

	// 6. Verify mock provider call counter is 0 on second request for the same range
	upstreamCalls := 0
	mockFetch := func(r domain.GapRange) []domain.Candle {
		upstreamCalls++
		return nil
	}
	secondGaps := ComputeMissingGaps(minTs, maxTs, count, 20000, 40000, 14400)
	for _, g := range secondGaps {
		_ = mockFetch(g)
	}
	if upstreamCalls != 0 {
		t.Fatalf("expected 0 upstream calls on repeated range request, got %d", upstreamCalls)
	}
}

func TestMigrationV2ClearsCandleCacheOnce(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mig.db")
	st, err := NewSQLiteStore(path)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	_ = st.BatchUpsertCandles(ctx, []domain.Candle{{Symbol: "X", Timeframe: "15m", Timestamp: 900, Open: 1, High: 1, Low: 1, Close: 1}})
	// simulate a pre-v2 database
	if _, err := st.db.Exec(`DELETE FROM schema_version`); err != nil {
		t.Fatal(err)
	}
	_ = st.Close()

	st, err = NewSQLiteStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, n, _ := st.GetCoverage(ctx, "X", "15m"); n != 0 {
		t.Fatalf("expected cache cleared by v2 migration, got %d candles", n)
	}
	_ = st.BatchUpsertCandles(ctx, []domain.Candle{{Symbol: "X", Timeframe: "15m", Timestamp: 900, Open: 1, High: 1, Low: 1, Close: 1}})
	_ = st.Close()

	st, _ = NewSQLiteStore(path) // already at v2: must not wipe again
	defer st.Close()
	if _, _, n, _ := st.GetCoverage(ctx, "X", "15m"); n != 1 {
		t.Fatalf("migration must run once, got %d candles", n)
	}
}

func TestLastFetchedAtTracksRefresh(t *testing.T) {
	st, err := NewSQLiteStore(filepath.Join(t.TempDir(), "fa.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	if st.LastFetchedAt(ctx, "X", "1d") != 0 {
		t.Fatal("expected 0 before any fetch")
	}
	_ = st.RecordFetchedRange(ctx, "X", "1d", 100, 200)
	if st.LastFetchedAt(ctx, "X", "1d") == 0 {
		t.Fatal("RecordFetchedRange must set fetched_at")
	}
}
