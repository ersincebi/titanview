package footprint

import (
	"context"
	"database/sql"
	"testing"

	"github.com/ersincebi/titanview/backend/internal/provider"
	_ "github.com/mattn/go-sqlite3"
)

// fakeTape serves a fixed, id-ordered trade list like the Binance endpoint.
type fakeTape struct {
	trades []provider.AggTrade
	calls  int
}

func (f *fakeTape) FetchAggTrades(_ context.Context, _ string, fromID, startMs, endMs int64, limit int) ([]provider.AggTrade, error) {
	f.calls++
	out := []provider.AggTrade{}
	for _, t := range f.trades {
		if fromID > 0 {
			if t.ID < fromID {
				continue
			}
		} else if t.TimeMs < startMs || t.TimeMs > endMs {
			continue
		}
		out = append(out, t)
		if len(out) == limit {
			break
		}
	}
	return out, nil
}

func newStore(t *testing.T) Store {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(Schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return Store{DB: db}
}

func tape(n int, startMs, stepMs int64) *fakeTape {
	f := &fakeTape{}
	for i := 0; i < n; i++ {
		f.trades = append(f.trades, provider.AggTrade{ID: int64(i + 1), Price: 100 + float64(i%5), Qty: 1, TimeMs: startMs + int64(i)*stepMs, Sell: i%3 == 0})
	}
	return f
}

func TestAggregateRowsBuySell(t *testing.T) {
	b := NewBar(0)
	b.Add(provider.AggTrade{ID: 1, Price: 100.4, Qty: 2}, 0.5)
	b.Add(provider.AggTrade{ID: 2, Price: 100.1, Qty: 1, Sell: true}, 0.5)
	b.Add(provider.AggTrade{ID: 3, Price: 101.0, Qty: 5}, 0.5)
	o := b.Summarise(0.5)
	if len(o.Rows) != 2 || o.Rows[0][0] != 100 || o.Rows[0][1] != 2 || o.Rows[0][2] != 1 {
		t.Fatalf("rows %+v", o.Rows)
	}
	if o.Delta != 6 || o.Total != 8 || o.POC != 101 || o.Trades != 3 || b.LastID != 3 {
		t.Fatalf("summary %+v last=%d", o, b.LastID)
	}
}

func TestComputeSplitsBarsAndCaches(t *testing.T) {
	// 2500 trades, one every 100 ms from t=0 → 0..250 s; 60 s bars
	f := tape(2500, 0, 100)
	e := &Engine{Fetch: f, Store: newStore(t), PageBudget: 50}
	res, err := e.Compute(context.Background(), "BTCUSDT", "1m", 60, 1, []int64{0, 60, 120}, 1_000_000)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Bars) != 3 || len(res.Pending) != 0 {
		t.Fatalf("bars=%d pending=%v", len(res.Bars), res.Pending)
	}
	for _, b := range res.Bars {
		if b.Trades != 600 || !b.Complete {
			t.Fatalf("bar %d trades=%d complete=%v", b.Time, b.Trades, b.Complete)
		}
	}
	calls := f.calls
	if _, err := e.Compute(context.Background(), "BTCUSDT", "1m", 60, 1, []int64{0, 60, 120}, 1_000_000); err != nil {
		t.Fatal(err)
	}
	if f.calls != calls {
		t.Fatalf("closed bars must come from cache, extra calls=%d", f.calls-calls)
	}
}

func TestBudgetLeavesPendingAndResumes(t *testing.T) {
	f := tape(5000, 0, 10) // 50 s of trades in one 60 s bar
	e := &Engine{Fetch: f, Store: newStore(t), PageBudget: 2}
	res, _ := e.Compute(context.Background(), "BTCUSDT", "1m", 60, 1, []int64{0}, 1_000_000)
	if len(res.Pending) != 1 {
		t.Fatalf("want pending, got %+v", res)
	}
	for i := 0; i < 5 && len(res.Pending) > 0; i++ {
		res, _ = e.Compute(context.Background(), "BTCUSDT", "1m", 60, 1, []int64{0}, 1_000_000)
	}
	if len(res.Pending) != 0 || res.Bars[0].Trades != 5000 || !res.Bars[0].Complete {
		t.Fatalf("resume failed: %+v", res.Bars)
	}
}

func TestFormingBarContinuesFromLastID(t *testing.T) {
	f := tape(300, 0, 100) // 30 s into a 60 s bar
	e := &Engine{Fetch: f, Store: newStore(t), PageBudget: 10}
	res, _ := e.Compute(context.Background(), "BTCUSDT", "1m", 60, 1, []int64{0}, 30_000)
	if res.Bars[0].Complete || res.Bars[0].Trades != 300 || len(res.Pending) != 0 {
		t.Fatalf("forming bar %+v pending=%v", res.Bars[0], res.Pending)
	}
	f.trades = append(f.trades, provider.AggTrade{ID: 301, Price: 100, Qty: 1, TimeMs: 59_000}, provider.AggTrade{ID: 302, Price: 100, Qty: 1, TimeMs: 61_000})
	res, _ = e.Compute(context.Background(), "BTCUSDT", "1m", 60, 1, []int64{0}, 62_000)
	if !res.Bars[0].Complete || res.Bars[0].Trades != 301 {
		t.Fatalf("continue failed %+v", res.Bars[0])
	}
}

func TestEmptyBarCompletesWhenClosed(t *testing.T) {
	f := &fakeTape{}
	e := &Engine{Fetch: f, Store: newStore(t), PageBudget: 5}
	res, _ := e.Compute(context.Background(), "X", "1m", 60, 1, []int64{0}, 1_000_000)
	if len(res.Bars) != 1 || !res.Bars[0].Complete || len(res.Pending) != 0 {
		t.Fatalf("%+v", res)
	}
}
