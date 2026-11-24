package storage

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
)

func TestLayoutsCRUDCopyShareAndDeleteCascade(t *testing.T) {
	ctx := context.Background()
	store, err := NewSQLiteStore(filepath.Join(t.TempDir(), "layouts.db"))
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer store.Close()

	// 1. Create
	created, err := store.CreateLayout(ctx, SavedLayout{
		Name:       "BIST + Kripto 2x2",
		State:      json.RawMessage(`{"layout":"2x2","symbol":"THYAO.IS"}`),
		GridID:     "2x2",
		ChartCount: 4,
		Symbols:    "THYAO.IS,XU100.IS,BTCUSDT,USDTRY=X",
		Autosave:   true,
	})
	if err != nil || created.ID == "" || created.Name != "BIST + Kripto 2x2" {
		t.Fatalf("create failed: %+v err=%v", created, err)
	}

	// 2. List & Get
	list, err := store.ListLayouts(ctx)
	if err != nil || len(list) != 1 || list[0].ID != created.ID || list[0].ChartCount != 4 {
		t.Fatalf("list mismatch: %+v err=%v", list, err)
	}
	got, err := store.GetLayout(ctx, created.ID)
	if err != nil || string(got.State) != `{"layout":"2x2","symbol":"THYAO.IS"}` {
		t.Fatalf("get mismatch: %+v err=%v", got, err)
	}

	// 3. Rename & update state & autosave
	newName := "Ana Çalışma"
	autoOff := false
	upd, err := store.UpdateLayout(ctx, created.ID, UpdateLayoutPatch{
		Name:     &newName,
		Autosave: &autoOff,
		State:    json.RawMessage(`{"layout":"3x2","symbol":"BTCUSDT"}`),
	})
	if err != nil || upd.Name != newName || upd.Autosave != false {
		t.Fatalf("update mismatch: %+v err=%v", upd, err)
	}

	// 4. Scoped drawings: global + layout-scoped
	if err := store.SaveDrawing(ctx, SavedDrawing{
		ID: "d_global", Symbol: "BTCUSDT", Timeframe: "15m", ToolType: "hline", PointsJSON: "[]", StyleJSON: "{}", LayoutID: "",
	}); err != nil {
		t.Fatalf("save global drawing: %v", err)
	}
	if err := store.SaveDrawing(ctx, SavedDrawing{
		ID: "d_lay", Symbol: "BTCUSDT", Timeframe: "15m", ToolType: "trendline", PointsJSON: "[]", StyleJSON: "{}", LayoutID: created.ID,
	}); err != nil {
		t.Fatalf("save layout drawing: %v", err)
	}
	if err := store.SaveDrawing(ctx, SavedDrawing{
		ID: "d_slot", Symbol: "BTCUSDT", Timeframe: "15m", ToolType: "rect", PointsJSON: "[]", StyleJSON: "{}", LayoutID: created.ID + "#slot:1",
	}); err != nil {
		t.Fatalf("save slot drawing: %v", err)
	}

	globOnly, _ := store.ListDrawings(ctx, "BTCUSDT")
	if len(globOnly) != 1 || globOnly[0].ID != "d_global" {
		t.Fatalf("global drawings: %+v", globOnly)
	}
	layPlusGlob, _ := store.ListDrawingsForScope(ctx, "BTCUSDT", created.ID, true)
	if len(layPlusGlob) != 2 {
		t.Fatalf("layout+global drawings: want 2 got %+v", layPlusGlob)
	}
	slotOnly, _ := store.ListDrawingsForScope(ctx, "BTCUSDT", created.ID+"#slot:1", false)
	if len(slotOnly) != 1 || slotOnly[0].ID != "d_slot" {
		t.Fatalf("slot drawings: %+v", slotOnly)
	}

	// 5. Copy layout duplicates layout-scoped drawings
	copied, err := store.CopyLayout(ctx, created.ID, "")
	if err != nil || copied.ID == created.ID || copied.Name != "Ana Çalışma (kopya)" {
		t.Fatalf("copy failed: %+v err=%v", copied, err)
	}
	copiedDraws, _ := store.ListDrawingsForScope(ctx, "BTCUSDT", copied.ID, false)
	if len(copiedDraws) != 1 || copiedDraws[0].ToolType != "trendline" {
		t.Fatalf("expected copied layout drawing, got %+v", copiedDraws)
	}

	// 6. Shareable read-only link toggle
	shared, err := store.SetLayoutSharing(ctx, created.ID, true, false)
	if err != nil || !shared.IsShared || shared.ShareToken == "" {
		t.Fatalf("enable share failed: %+v err=%v", shared, err)
	}
	byTok, err := store.GetSharedLayout(ctx, shared.ShareToken)
	if err != nil || byTok.ID != created.ID {
		t.Fatalf("lookup shared failed: %+v err=%v", byTok, err)
	}
	// Disable sharing -> token must no longer resolve
	unshared, err := store.SetLayoutSharing(ctx, created.ID, false, false)
	if err != nil || unshared.IsShared {
		t.Fatalf("disable share failed: %+v err=%v", unshared, err)
	}
	if _, err := store.GetSharedLayout(ctx, shared.ShareToken); !errors.Is(err, ErrLayoutNotFound) {
		t.Fatalf("disabled share token should return ErrLayoutNotFound, got %v", err)
	}

	// 7. Delete cascades layout-scoped drawings but preserves global drawings
	if err := store.DeleteLayout(ctx, created.ID); err != nil {
		t.Fatalf("delete layout failed: %v", err)
	}
	if err := store.DeleteLayout(ctx, created.ID); !errors.Is(err, ErrLayoutNotFound) {
		t.Fatalf("second delete should return ErrLayoutNotFound, got %v", err)
	}
	afterDelLay, _ := store.ListDrawingsForScope(ctx, "BTCUSDT", created.ID, false)
	if len(afterDelLay) != 0 {
		t.Fatalf("expected layout drawings deleted, got %+v", afterDelLay)
	}
	afterDelGlob, _ := store.ListDrawings(ctx, "BTCUSDT")
	if len(afterDelGlob) != 1 {
		t.Fatalf("global drawings must remain after layout delete, got %+v", afterDelGlob)
	}
}
