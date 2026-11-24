package storage

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
)

func TestPhase27WatchlistsFlagsNotesAndPresets(t *testing.T) {
	store, err := NewSQLiteStore(filepath.Join(t.TempDir(), "p27.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ctx := context.Background()

	// 1. Default watchlists seed
	lists, err := store.ListWatchlists(ctx)
	if err != nil {
		t.Fatalf("ListWatchlists: %v", err)
	}
	if len(lists) != 3 || lists[0].ID != "wl_main" || len(lists[0].Items) < 10 {
		t.Fatalf("unexpected default watchlists: %+v", lists)
	}

	// 2. Save custom watchlist with sections & duplicate symbols
	custom, err := store.SaveWatchlist(ctx, SavedWatchlist{
		Name: "Temettü & Banka",
		Items: []WatchlistEntry{
			{Type: "section", Title: "BANKALAR"},
			{Type: "symbol", Symbol: "GARAN.IS"},
			{Type: "symbol", Symbol: "garan.is"}, // duplicate should be deduplicated
			{Type: "symbol", Symbol: "AKBNK.IS"},
		},
	})
	if err != nil {
		t.Fatalf("SaveWatchlist: %v", err)
	}
	if custom.ID == "" || len(custom.Items) != 3 {
		t.Fatalf("expected 3 sanitized items (1 section + 2 unique symbols), got %+v", custom)
	}

	got, err := store.GetWatchlist(ctx, custom.ID)
	if err != nil || got.Name != "Temettü & Banka" || len(got.Items) != 3 {
		t.Fatalf("GetWatchlist: %v %+v", err, got)
	}

	// Delete watchlists down to 1, verify last one cannot be deleted
	all, _ := store.ListWatchlists(ctx)
	for i := 0; i < len(all)-1; i++ {
		if err := store.DeleteWatchlist(ctx, all[i].ID); err != nil {
			t.Fatalf("DeleteWatchlist(%s): %v", all[i].ID, err)
		}
	}
	if err := store.DeleteWatchlist(ctx, all[len(all)-1].ID); !errors.Is(err, ErrLastWatchlist) {
		t.Fatalf("expected ErrLastWatchlist, got %v", err)
	}

	// 3. 7-color symbol flags
	for _, col := range []string{"red", "blue", "green", "orange", "purple", "cyan", "pink"} {
		if err := store.SetSymbolFlag(ctx, "THYAO.IS", col); err != nil {
			t.Fatalf("SetSymbolFlag(%s): %v", col, err)
		}
	}
	if err := store.SetSymbolFlag(ctx, "BTCUSDT", "blue"); err != nil {
		t.Fatal(err)
	}
	if err := store.SetSymbolFlag(ctx, "BTCUSDT", "neon_yellow"); !errors.Is(err, ErrInvalidFlagColor) {
		t.Fatalf("expected ErrInvalidFlagColor, got %v", err)
	}
	flags, err := store.ListSymbolFlags(ctx)
	if err != nil || flags["THYAO.IS"] != "pink" || flags["BTCUSDT"] != "blue" {
		t.Fatalf("unexpected flags: %v %+v", err, flags)
	}
	if err := store.SetSymbolFlag(ctx, "THYAO.IS", ""); err != nil {
		t.Fatal(err)
	}
	flags, _ = store.ListSymbolFlags(ctx)
	if _, ok := flags["THYAO.IS"]; ok {
		t.Fatalf("expected THYAO.IS flag cleared, got %+v", flags)
	}

	// 4. Symbol notes / journal
	n1, err := store.SaveNote(ctx, SymbolNote{
		Symbol:        "THYAO.IS",
		Title:         "Bilanço öncesi destek analizi",
		Body:          "285 TL güçlü hacim profili POC desteği.",
		Tags:          "Analiz,Bilanço",
		Sentiment:     "bull",
		SnapshotPrice: 292.5,
		Timeframe:     "1d",
		Pinned:        false,
	})
	if err != nil {
		t.Fatalf("SaveNote n1: %v", err)
	}
	n2, err := store.SaveNote(ctx, SymbolNote{
		Symbol:        "THYAO.IS",
		Title:         "Sabitlenmiş işlem planı",
		Body:          "310 TL hedef, 278 TL stop.",
		Tags:          "İşlem Planı",
		Sentiment:     "bull",
		SnapshotPrice: 295.0,
		Timeframe:     "4h",
		Pinned:        true,
	})
	if err != nil {
		t.Fatalf("SaveNote n2: %v", err)
	}
	notes, err := store.ListNotes(ctx, "THYAO.IS")
	if err != nil || len(notes) != 2 || notes[0].ID != n2.ID {
		t.Fatalf("expected pinned note first, got %+v (err=%v)", notes, err)
	}
	if err := store.DeleteNote(ctx, n1.ID); err != nil {
		t.Fatalf("DeleteNote: %v", err)
	}
	notes, _ = store.ListNotes(ctx, "")
	if len(notes) != 1 {
		t.Fatalf("expected 1 remaining note, got %d", len(notes))
	}

	// 5. Screener presets
	p, err := store.SaveScreenerPreset(ctx, SavedScreenerPreset{
		Name:      "RSI Aşırı Satım + Yüksek Hacim",
		Market:    "BIST",
		Timeframe: "1d",
		ColumnSet: "oscillators",
		Config:    json.RawMessage(`{"filters":[{"field":"rsi14","op":"lt","value":35}]}`),
	})
	if err != nil {
		t.Fatalf("SaveScreenerPreset: %v", err)
	}
	presets, err := store.ListScreenerPresets(ctx)
	if err != nil || len(presets) != 1 || presets[0].ID != p.ID {
		t.Fatalf("ListScreenerPresets: %v %+v", err, presets)
	}
	if err := store.DeleteScreenerPreset(ctx, p.ID); err != nil {
		t.Fatalf("DeleteScreenerPreset: %v", err)
	}
}
