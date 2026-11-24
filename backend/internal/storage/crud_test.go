package storage

import (
	"context"
	"fmt"
	"testing"

	"github.com/ersincebi/titanview/backend/internal/domain"
)

func newMem(t *testing.T) *SQLiteStore {
	t.Helper()
	s, err := NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestScriptsCRUD(t *testing.T) {
	ctx := context.Background()
	s := newMem(t)
	if err := s.SaveScript(ctx, SavedScript{ID: "a", Name: "A", Code: "x", IsOverlay: true, UpdatedAt: 10}); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveScript(ctx, SavedScript{ID: "b", Name: "B", Code: "y", UpdatedAt: 20}); err != nil {
		t.Fatal(err)
	}
	list, err := s.ListScripts(ctx)
	if err != nil || len(list) != 2 {
		t.Fatalf("list=%v err=%v", list, err)
	}
	if list[0].ID != "b" || list[1].ID != "a" {
		t.Errorf("must be ordered by updated_at desc: %+v", list)
	}
	if !list[1].IsOverlay || list[0].IsOverlay {
		t.Errorf("overlay flag round-trip broken: %+v", list)
	}
	// upsert replaces
	if err := s.SaveScript(ctx, SavedScript{ID: "a", Name: "A2", Code: "z", UpdatedAt: 30}); err != nil {
		t.Fatal(err)
	}
	list, _ = s.ListScripts(ctx)
	if len(list) != 2 || list[0].ID != "a" || list[0].Name != "A2" || list[0].IsOverlay {
		t.Errorf("upsert failed: %+v", list)
	}
	if err := s.DeleteScript(ctx, "a"); err != nil {
		t.Fatal(err)
	}
	list, _ = s.ListScripts(ctx)
	if len(list) != 1 || list[0].ID != "b" {
		t.Errorf("delete failed: %+v", list)
	}
	// UpdatedAt defaults to now
	_ = s.SaveScript(ctx, SavedScript{ID: "c", Name: "C", Code: "q"})
	list, _ = s.ListScripts(ctx)
	if list[0].ID != "c" || list[0].UpdatedAt == 0 {
		t.Errorf("default timestamp missing: %+v", list)
	}
}

func TestDrawingsCRUD(t *testing.T) {
	ctx := context.Background()
	s := newMem(t)
	mk := func(id, sym string, ts int64) SavedDrawing {
		return SavedDrawing{ID: id, Symbol: sym, Timeframe: "1h", ToolType: "trend", PointsJSON: "[]", StyleJSON: "{}", CreatedAt: ts}
	}
	for _, d := range []SavedDrawing{mk("1", "btcusdt", 1), mk("2", "BTCUSDT", 2), mk("3", "AAPL", 3)} {
		if err := s.SaveDrawing(ctx, d); err != nil {
			t.Fatal(err)
		}
	}
	got, err := s.ListDrawings(ctx, " btcusdt ")
	if err != nil || len(got) != 2 || got[0].ID != "1" || got[1].ID != "2" {
		t.Fatalf("symbol normalisation/order broken: %+v err=%v", got, err)
	}
	// upsert changes points+style but keeps created_at
	up := mk("1", "BTCUSDT", 99)
	up.PointsJSON = `[{"t":1}]`
	up.StyleJSON = `{"c":"red"}`
	if err := s.SaveDrawing(ctx, up); err != nil {
		t.Fatal(err)
	}
	got, _ = s.ListDrawings(ctx, "BTCUSDT")
	if got[0].PointsJSON != `[{"t":1}]` || got[0].StyleJSON != `{"c":"red"}` || got[0].CreatedAt != 1 {
		t.Errorf("upsert semantics wrong: %+v", got[0])
	}
	if err := s.DeleteDrawings(ctx, "BTCUSDT", "2"); err != nil {
		t.Fatal(err)
	}
	got, _ = s.ListDrawings(ctx, "BTCUSDT")
	if len(got) != 1 || got[0].ID != "1" {
		t.Errorf("delete by id failed: %+v", got)
	}
	if err := s.DeleteDrawings(ctx, "BTCUSDT", ""); err != nil {
		t.Fatal(err)
	}
	got, _ = s.ListDrawings(ctx, "BTCUSDT")
	other, _ := s.ListDrawings(ctx, "AAPL")
	if len(got) != 0 || len(other) != 1 {
		t.Errorf("delete by symbol must not touch other symbols: %d %d", len(got), len(other))
	}
	st, _ := s.GetCacheStats(ctx)
	if st.SavedDrawings != 1 {
		t.Errorf("stats drawings=%d", st.SavedDrawings)
	}
}

func TestLatestCandlesAndTouch(t *testing.T) {
	ctx := context.Background()
	s := newMem(t)
	var batch []domain.Candle
	for i := int64(1); i <= 10; i++ {
		batch = append(batch, domain.Candle{Symbol: "X", Timeframe: "1h", Timestamp: i * 3600, Open: 1, High: 2, Low: 1, Close: float64(i), Volume: 1})
	}
	if err := s.BatchUpsertCandles(ctx, batch); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetLatestCandles(ctx, "x", "1h", 3)
	if err != nil || len(got) != 3 {
		t.Fatalf("len=%d err=%v", len(got), err)
	}
	if got[0].Timestamp != 8*3600 || got[2].Timestamp != 10*3600 {
		t.Errorf("must be the LAST 3 in ascending order: %+v", got)
	}
	all, _ := s.GetLatestCandles(ctx, "X", "1h", 0) // default limit 500
	if len(all) != 10 {
		t.Errorf("default limit: %d", len(all))
	}
	// TouchFetchedAt only updates rows that exist
	if err := s.TouchFetchedAt(ctx, "X", "1h"); err != nil {
		t.Fatal(err)
	}
	if s.LastFetchedAt(ctx, "NOPE", "1h") != 0 {
		t.Error("unknown symbol must report 0")
	}
}

func TestCollectSymbols(t *testing.T) {
	ctx := context.Background()
	s := newMem(t)
	if got, _ := s.ListCollectSymbols(ctx); len(got) != 0 {
		t.Fatalf("starts empty: %v", got)
	}
	if err := s.SetCollectSymbols(ctx, []string{" thyao.is ", "BTCUSDT", "THYAO.IS", "", "aapl"}); err != nil {
		t.Fatal(err)
	}
	got, _ := s.ListCollectSymbols(ctx)
	if len(got) != 3 {
		t.Fatalf("dedupe + blank drop: %v", got)
	}
	has := map[string]bool{}
	for _, g := range got {
		has[g] = true
	}
	if !has["THYAO.IS"] || !has["BTCUSDT"] || !has["AAPL"] {
		t.Errorf("normalised: %v", got)
	}
	_ = s.SetCollectSymbols(ctx, []string{"AAPL"})
	if got, _ = s.ListCollectSymbols(ctx); len(got) != 1 || got[0] != "AAPL" {
		t.Errorf("replace semantics: %v", got)
	}
	many := make([]string, 50)
	for i := range many {
		many[i] = fmt.Sprintf("S%d", i)
	}
	_ = s.SetCollectSymbols(ctx, many)
	if got, _ = s.ListCollectSymbols(ctx); len(got) != MaxCollectSymbols {
		t.Errorf("cap: %d", len(got))
	}
}
