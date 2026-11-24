package api

import (
	"bufio"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ersincebi/titanview/backend/internal/hub"
	"github.com/ersincebi/titanview/backend/internal/provider"
	"github.com/ersincebi/titanview/backend/internal/storage"
	"github.com/ersincebi/titanview/backend/internal/trading"
)

func tradingServer(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	dir := t.TempDir()
	store, err := storage.NewSQLiteStore(filepath.Join(dir, "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	t.Setenv("TITAN_SECRET_KEY", "")
	coord := provider.NewCacheCoordinator(store, nil, nil)
	srv := NewServer(coord, hub.NewLiveHub(coord, time.Hour), "")
	if _, err := srv.EnableTrading(dir); err != nil {
		t.Fatal(err)
	}
	srv.Trading.Paper.Live = nil // no upstream feeds in tests: prices come from OnTick
	ts := httptest.NewServer(srv.Routes())
	t.Cleanup(ts.Close)
	return srv, ts
}

func TestTradingDisabled(t *testing.T) {
	store, err := storage.NewSQLiteStore(filepath.Join(t.TempDir(), "d.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	coord := provider.NewCacheCoordinator(store, nil, nil)
	ts := httptest.NewServer(NewServer(coord, hub.NewLiveHub(coord, time.Hour), "").Routes())
	defer ts.Close()
	if code, _ := doJSON(t, http.MethodGet, ts.URL+"/api/trading/paper", nil); code != http.StatusServiceUnavailable {
		t.Fatalf("code %d", code)
	}
}

func TestPaperTradingAPI(t *testing.T) {
	srv, ts := tradingServer(t)
	code, snap := doJSON(t, http.MethodGet, ts.URL+"/api/trading/paper", nil)
	if code != 200 || snap["balance"].(float64) != 100000 {
		t.Fatalf("initial %d %v", code, snap)
	}
	// seed a live price through the engine (no network in tests)
	srv.Trading.Paper.OnTick("BTCUSDT", 60000)

	code, res := doJSON(t, http.MethodPost, ts.URL+"/api/trading/paper/orders", map[string]any{
		"symbol": "BTCUSDT", "side": "buy", "type": "limit", "qty": 0.1, "limitPrice": 59000, "takeProfit": 61000, "stopLoss": 58000,
	})
	if code != 200 {
		t.Fatalf("place %d %v", code, res)
	}
	id := res["order"].(map[string]any)["id"].(string)
	if code, res = doJSON(t, http.MethodPost, ts.URL+"/api/trading/paper/orders", map[string]any{
		"symbol": "BTCUSDT", "side": "buy", "type": "stop", "qty": 0.1, "stopPrice": 1,
	}); code != 400 || !strings.Contains(res["error"].(string), "stop") {
		t.Fatalf("bad stop %d %v", code, res)
	}
	if code, _ = doJSON(t, http.MethodPost, ts.URL+"/api/trading/paper/orders", "{bad"); code != 400 {
		t.Fatal("bad json")
	}
	// drag the limit line (PUT)
	code, res = doJSON(t, http.MethodPut, ts.URL+"/api/trading/paper/orders?id="+id, map[string]any{"limitPrice": 59500})
	if code != 200 || res["order"].(map[string]any)["limitPrice"].(float64) != 59500 {
		t.Fatalf("modify %d %v", code, res)
	}
	if code, _ = doJSON(t, http.MethodPut, ts.URL+"/api/trading/paper/orders?id=nope", map[string]any{"limitPrice": 1}); code != 404 {
		t.Fatalf("modify unknown %d", code)
	}
	srv.Trading.Paper.OnTick("BTCUSDT", 59400) // fills; TP/SL children appear
	_, snap = doJSON(t, http.MethodGet, ts.URL+"/api/trading/paper", nil)
	if len(snap["positions"].([]any)) != 1 || len(snap["orders"].([]any)) != 2 {
		t.Fatalf("after fill %v", snap)
	}
	code, res = doJSON(t, http.MethodPut, ts.URL+"/api/trading/positions/brackets", map[string]any{"symbol": "BTCUSDT", "takeProfit": 62000, "stopLoss": -1})
	if code != 200 || len(res["snapshot"].(map[string]any)["orders"].([]any)) != 1 {
		t.Fatalf("brackets %d %v", code, res)
	}
	if code, _ = doJSON(t, http.MethodPost, ts.URL+"/api/trading/paper/reverse?symbol=BTCUSDT", nil); code != 200 {
		t.Fatalf("reverse %d", code)
	}
	code, res = doJSON(t, http.MethodPost, ts.URL+"/api/trading/paper/close?symbol=BTCUSDT", nil)
	if code != 200 || len(res["snapshot"].(map[string]any)["positions"].([]any)) != 0 {
		t.Fatalf("close %d %v", code, res)
	}
	if code, _ = doJSON(t, http.MethodPost, ts.URL+"/api/trading/paper/close?symbol=BTCUSDT", nil); code != 400 {
		t.Fatal("close flat must fail")
	}
	code, res = doJSON(t, http.MethodGet, ts.URL+"/api/trading/paper/fills?limit=10", nil)
	if code != 200 || len(res["fills"].([]any)) != 3 {
		t.Fatalf("fills %d %v", code, res)
	}
	// cancel
	_, res = doJSON(t, http.MethodPost, ts.URL+"/api/trading/paper/orders", map[string]any{"symbol": "BTCUSDT", "side": "sell", "type": "limit", "qty": 0.1, "limitPrice": 70000})
	id = res["order"].(map[string]any)["id"].(string)
	if code, _ = doJSON(t, http.MethodDelete, ts.URL+"/api/trading/paper/orders?id="+id, nil); code != 200 {
		t.Fatal("cancel")
	}
	if code, _ = doJSON(t, http.MethodPatch, ts.URL+"/api/trading/paper/orders", nil); code != 405 {
		t.Fatal("405")
	}
	code, res = doJSON(t, http.MethodPost, ts.URL+"/api/trading/paper/reset", map[string]any{"initialBalance": 25000, "commissionPct": 0.1})
	if code != 200 || res["balance"].(float64) != 25000 {
		t.Fatalf("reset %d %v", code, res)
	}
}

func TestTradingStreamAndBinanceKeys(t *testing.T) {
	srv, ts := tradingServer(t)
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/trading/stream", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	rd := bufio.NewReader(resp.Body)
	readEvent := func() string {
		var data string
		for {
			line, err := rd.ReadString('\n')
			if err != nil {
				t.Fatal(err)
			}
			if strings.HasPrefix(line, "data: ") {
				data = line
			}
			if line == "\n" && data != "" {
				return data
			}
		}
	}
	if first := readEvent(); !strings.Contains(first, `"balance":100000`) {
		t.Fatalf("first snapshot %s", first)
	}
	srv.Trading.Paper.OnTick("ETHUSDT", 3000)
	go func() {
		_, _, _ = srv.Trading.Paper.Place(t.Context(), trading.OrderRequest{Symbol: "ETHUSDT", Side: "buy", Type: "market", Qty: 1})
	}()
	if ev := readEvent(); !strings.Contains(ev, "ETHUSDT") {
		t.Fatalf("event %s", ev)
	}

	code, st := doJSON(t, http.MethodGet, ts.URL+"/api/trading/binance", nil)
	if code != 200 || st["configured"].(bool) {
		t.Fatalf("status %d %v", code, st)
	}
	if code, _ = doJSON(t, http.MethodGet, ts.URL+"/api/trading/binance/account", nil); code != http.StatusPreconditionFailed {
		t.Fatalf("account without key %d", code)
	}
	code, st = doJSON(t, http.MethodPut, ts.URL+"/api/trading/binance", map[string]any{"apiKey": "KEYKEYKEYKEYKEYKEY12", "secret": "SECRETSECRETSECRET99", "testnet": true})
	if code != 200 || !st["configured"].(bool) || st["keyHint"] != "KEYK…EY12" {
		t.Fatalf("save %d %v", code, st)
	}
	if _, ok := st["secret"]; ok {
		t.Fatal("secret leaked")
	}
	if code, res := doJSON(t, http.MethodPost, ts.URL+"/api/trading/binance/order", map[string]any{"token": "x"}); code != 400 || !strings.Contains(res["error"].(string), "confirm") {
		t.Fatalf("order without confirm %d %v", code, res)
	}
	if code, _ = doJSON(t, http.MethodPost, ts.URL+"/api/trading/binance/order", map[string]any{"token": "x", "confirm": true}); code != 400 {
		t.Fatalf("bogus token %d", code)
	}
	if code, _ = doJSON(t, http.MethodPost, ts.URL+"/api/trading/binance/preview", map[string]any{"symbol": "THYAO.IS", "side": "buy", "type": "market", "qty": 1}); code != 400 {
		t.Fatalf("BIST preview %d", code)
	}
	if code, st = doJSON(t, http.MethodDelete, ts.URL+"/api/trading/binance", nil); code != 200 || st["configured"].(bool) {
		t.Fatalf("delete %d %v", code, st)
	}
}
