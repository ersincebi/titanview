package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
	"github.com/ersincebi/titanview/backend/internal/hub"
	"github.com/ersincebi/titanview/backend/internal/provider"
	"github.com/ersincebi/titanview/backend/internal/storage"
)

func newPhase27Server(t *testing.T) (*Server, *storage.SQLiteStore, http.Handler) {
	t.Helper()
	store, err := storage.NewSQLiteStore(filepath.Join(t.TempDir(), "api_p27.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	coord := provider.NewCacheCoordinator(store, nil, nil)
	liveHub := hub.NewLiveHub(coord, 10*time.Second)
	srv := NewServer(coord, liveHub, "")
	return srv, store, srv.Routes()
}

func TestPhase27WatchlistsFlagsAndNotesEndpoints(t *testing.T) {
	_, store, h := newPhase27Server(t)
	seedRealisticCandles(t, store, "THYAO.IS", 1730090000/900*900, 120)

	// 1. GET /api/watchlists seeds defaults
	req := httptest.NewRequest(http.MethodGet, "/api/watchlists", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/watchlists = %d: %s", rec.Code, rec.Body.String())
	}
	var wlResp struct {
		Watchlists []storage.SavedWatchlist `json:"watchlists"`
		Flags      map[string]string        `json:"flags"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &wlResp); err != nil || len(wlResp.Watchlists) != 3 {
		t.Fatalf("expected 3 seeded watchlists, got %+v err=%v", wlResp, err)
	}

	// 2. POST /api/watchlists create custom watchlist
	newWL := `{"name":"Favori BIST","items":[{"type":"section","title":"HAVACILIK"},{"type":"symbol","symbol":"THYAO.IS"},{"type":"symbol","symbol":"PGSUS.IS"}]}`
	recCreate := httptest.NewRecorder()
	h.ServeHTTP(recCreate, httptest.NewRequest(http.MethodPost, "/api/watchlists", bytes.NewBufferString(newWL)))
	if recCreate.Code != http.StatusOK {
		t.Fatalf("POST /api/watchlists = %d: %s", recCreate.Code, recCreate.Body.String())
	}
	var created storage.SavedWatchlist
	_ = json.Unmarshal(recCreate.Body.Bytes(), &created)
	if created.ID == "" || len(created.Items) != 3 {
		t.Fatalf("created watchlist unexpected: %+v", created)
	}

	// 3. PUT /api/watchlists/flag (7 colors)
	recFlag := httptest.NewRecorder()
	h.ServeHTTP(recFlag, httptest.NewRequest(http.MethodPut, "/api/watchlists/flag", bytes.NewBufferString(`{"symbol":"THYAO.IS","color":"red"}`)))
	if recFlag.Code != http.StatusOK {
		t.Fatalf("PUT /api/watchlists/flag = %d: %s", recFlag.Code, recFlag.Body.String())
	}
	recBadFlag := httptest.NewRecorder()
	h.ServeHTTP(recBadFlag, httptest.NewRequest(http.MethodPut, "/api/watchlists/flag", bytes.NewBufferString(`{"symbol":"THYAO.IS","color":"invalid"}`)))
	if recBadFlag.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid flag color, got %d", recBadFlag.Code)
	}

	// 4. POST / GET / DELETE /api/notes
	recNote := httptest.NewRecorder()
	h.ServeHTTP(recNote, httptest.NewRequest(http.MethodPost, "/api/notes", bytes.NewBufferString(`{"symbol":"THYAO.IS","title":"Test Notu","body":"Destek üzerinde tutunuyor","tags":"Analiz","sentiment":"bull","timeframe":"15m","pinned":true}`)))
	if recNote.Code != http.StatusOK {
		t.Fatalf("POST /api/notes = %d: %s", recNote.Code, recNote.Body.String())
	}
	var savedNote storage.SymbolNote
	_ = json.Unmarshal(recNote.Body.Bytes(), &savedNote)
	if savedNote.ID == "" || savedNote.SnapshotPrice <= 0 {
		t.Fatalf("expected auto-filled snapshotPrice from real cached candles, got %+v", savedNote)
	}

	recListNotes := httptest.NewRecorder()
	h.ServeHTTP(recListNotes, httptest.NewRequest(http.MethodGet, "/api/notes?symbol=THYAO.IS", nil))
	if recListNotes.Code != http.StatusOK {
		t.Fatalf("GET /api/notes = %d", recListNotes.Code)
	}
	var notesResp struct {
		Notes []storage.SymbolNote `json:"notes"`
	}
	_ = json.Unmarshal(recListNotes.Body.Bytes(), &notesResp)
	if len(notesResp.Notes) != 1 || notesResp.Notes[0].ID != savedNote.ID {
		t.Fatalf("expected 1 note, got %+v", notesResp.Notes)
	}

	recDelNote := httptest.NewRecorder()
	h.ServeHTTP(recDelNote, httptest.NewRequest(http.MethodDelete, "/api/notes?id="+savedNote.ID, nil))
	if recDelNote.Code != http.StatusOK {
		t.Fatalf("DELETE /api/notes = %d", recDelNote.Code)
	}

	// 5. POST / GET / DELETE /api/screener/presets
	recPreset := httptest.NewRecorder()
	h.ServeHTTP(recPreset, httptest.NewRequest(http.MethodPost, "/api/screener/presets", bytes.NewBufferString(`{"name":"Momentum Ekranı","market":"CRYPTO","timeframe":"1h","columnSet":"oscillators","config":{"filters":[{"field":"rsi14","op":"gt","value":55}]}}`)))
	if recPreset.Code != http.StatusOK {
		t.Fatalf("POST /api/screener/presets = %d: %s", recPreset.Code, recPreset.Body.String())
	}
	var savedPreset storage.SavedScreenerPreset
	_ = json.Unmarshal(recPreset.Body.Bytes(), &savedPreset)

	recGetPresets := httptest.NewRecorder()
	h.ServeHTTP(recGetPresets, httptest.NewRequest(http.MethodGet, "/api/screener/presets", nil))
	if recGetPresets.Code != http.StatusOK {
		t.Fatalf("GET /api/screener/presets = %d", recGetPresets.Code)
	}
	recDelPreset := httptest.NewRecorder()
	h.ServeHTTP(recDelPreset, httptest.NewRequest(http.MethodDelete, "/api/screener/presets?id="+savedPreset.ID, nil))
	if recDelPreset.Code != http.StatusOK {
		t.Fatalf("DELETE /api/screener/presets = %d", recDelPreset.Code)
	}
}

func TestPhase27AdvancedScreenerAndScriptScreener(t *testing.T) {
	srv, store, h := newPhase27Server(t)
	now := int64(1730090000 / 900 * 900)
	seedRealisticCandles(t, store, "THYAO.IS", now, 120)
	seedRealisticCandles(t, store, "BTCUSDT", now, 120)
	seedRealisticCandles(t, store, "SPY", now, 120)

	// Cache a fundamentals report for THYAO.IS to verify fundamental columns attach cleanly
	mcap := 410_000_000_000.0
	pe := 4.85
	roe := 28.4
	srv.cache.set("fundamentals|THYAO.IS", provider.FundamentalsReport{
		Symbol:    "THYAO.IS",
		Supported: true,
		Ratios: provider.FinancialRatios{
			MarketCap:  &mcap,
			TrailingPE: &pe,
			ROEPct:     &roe,
		},
	})

	// 1. Advanced Screener GET /api/screener?market=ALL
	recScr := httptest.NewRecorder()
	h.ServeHTTP(recScr, httptest.NewRequest(http.MethodGet, "/api/screener?market=ALL", nil))
	if recScr.Code != http.StatusOK {
		t.Fatalf("GET /api/screener = %d: %s", recScr.Code, recScr.Body.String())
	}
	var scrResp struct {
		Rows []ScreenerRow `json:"rows"`
	}
	if err := json.Unmarshal(recScr.Body.Bytes(), &scrResp); err != nil || len(scrResp.Rows) != 3 {
		t.Fatalf("expected 3 screener rows, got %d (err=%v)", len(scrResp.Rows), err)
	}
	for _, r := range scrResp.Rows {
		if r.SMA20 <= 0 || r.EMA20 <= 0 || r.WMA20 <= 0 || r.VWMA20 <= 0 || r.HMA9 <= 0 || r.BBUpper20 <= r.BBLower20 {
			t.Fatalf("expected populated technical metrics on %s: %+v", r.Symbol, r)
		}
		if r.Symbol == "THYAO.IS" && (r.MarketCap == nil || *r.MarketCap != mcap || r.TrailingPE == nil || *r.TrailingPE != pe) {
			t.Fatalf("expected fundamentals attached to THYAO.IS: %+v", r)
		}
		if r.Symbol == "SPY" && !r.IsETF {
			t.Fatalf("expected SPY IsETF == true")
		}
	}

	// ETF filter
	recETF := httptest.NewRecorder()
	h.ServeHTTP(recETF, httptest.NewRequest(http.MethodGet, "/api/screener?market=ETF", nil))
	_ = json.Unmarshal(recETF.Body.Bytes(), &scrResp)
	if len(scrResp.Rows) != 1 || scrResp.Rows[0].Symbol != "SPY" {
		t.Fatalf("expected only SPY for market=ETF, got %+v", scrResp.Rows)
	}

	// 2. Flag THYAO.IS as red and run Script Screener on red flagged list
	_ = store.SetSymbolFlag(context.Background(), "THYAO.IS", "red")
	_ = store.SetSymbolFlag(context.Background(), "BTCUSDT", "red")

	scriptBody := map[string]interface{}{
		"code": `//@version=6
indicator("Faz27 Betik Tarayıcı Test")
r = ta.rsi(close, 14)
e20 = ta.ema(close, 20)
plot(r, "RSI_14")
plot(e20, "EMA_20")
alertcondition(r > 10, "RSI Aktif", "RSI pozitif")
`,
		"timeframe": "15m",
		"flagColor": "red",
		"filters": []map[string]interface{}{
			{"target": "RSI_14", "op": "gt", "value": 10},
			{"target": "RSI Aktif", "op": "alert_title"},
		},
		"onlyMatched": true,
	}
	rawBody, _ := json.Marshal(scriptBody)
	recScript := httptest.NewRecorder()
	h.ServeHTTP(recScript, httptest.NewRequest(http.MethodPost, "/api/screener/script", bytes.NewReader(rawBody)))
	if recScript.Code != http.StatusOK {
		t.Fatalf("POST /api/screener/script = %d: %s", recScript.Code, recScript.Body.String())
	}
	var scriptResp struct {
		OK          bool                  `json:"ok"`
		ScriptTitle string                `json:"scriptTitle"`
		Columns     []ScriptScreenerPlotCol `json:"columns"`
		Conditions  []string              `json:"conditions"`
		Rows        []ScriptScreenerRow     `json:"rows"`
	}
	if err := json.Unmarshal(recScript.Body.Bytes(), &scriptResp); err != nil {
		t.Fatal(err)
	}
	if !scriptResp.OK || len(scriptResp.Columns) != 2 || len(scriptResp.Rows) != 2 {
		t.Fatalf("unexpected script screener response: %+v", scriptResp)
	}
	for _, r := range scriptResp.Rows {
		if !r.Matched || r.Plots["RSI_14"] == nil || r.Plots["EMA_20"] == nil || len(r.AlertsFired) == 0 {
			t.Fatalf("unexpected script screener row: %+v", r)
		}
	}

	// Verify filter helper operators directly
	v50, v60, v40, v55 := 50.0, 60.0, 40.0, 55.0
	sampleRow := ScriptScreenerRow{
		SymbolInfo:  domain.SymbolInfo{Symbol: "BTCUSDT"},
		Plots:       map[string]*float64{"A": &v60, "B": &v55},
		PrevPlots:   map[string]*float64{"A": &v50, "B": &v55},
		AlertsFired: []string{"Kırılım"},
	}
	filterCases := []struct {
		f    ScriptScreenerFilter
		want bool
	}{
		{ScriptScreenerFilter{Op: "any_alert"}, true},
		{ScriptScreenerFilter{Target: "Kırılım", Op: "alert_title"}, true},
		{ScriptScreenerFilter{Target: "Yok", Op: "alert_title"}, false},
		{ScriptScreenerFilter{Target: "A", Op: "gt", Value: 55}, true},
		{ScriptScreenerFilter{Target: "A", Op: "lt", Value: 55}, false},
		{ScriptScreenerFilter{Target: "A", Op: "between", Value: 55, Value2: 65}, true},
		{ScriptScreenerFilter{Target: "A", Op: "rising"}, true},
		{ScriptScreenerFilter{Target: "A", Op: "falling"}, false},
		{ScriptScreenerFilter{Target: "A", Op: "cross_up", Value: 55}, true},
		{ScriptScreenerFilter{Target: "A", Op: "cross_up", RHSPlot: "B"}, true},
		{ScriptScreenerFilter{Target: "A", Op: "cross_down", Value: 55}, false},
		{ScriptScreenerFilter{Target: "B", Op: "gt", Value: v40}, true},
	}
	for _, tc := range filterCases {
		if got := evalSingleScriptFilter(sampleRow, tc.f); got != tc.want {
			t.Errorf("evalSingleScriptFilter(%+v) = %v want %v", tc.f, got, tc.want)
		}
	}
}
