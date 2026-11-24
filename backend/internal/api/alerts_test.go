package api

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ersincebi/titanview/backend/internal/alerts"
	"github.com/ersincebi/titanview/backend/internal/domain"
	"github.com/ersincebi/titanview/backend/internal/hub"
	"github.com/ersincebi/titanview/backend/internal/provider"
	"github.com/ersincebi/titanview/backend/internal/storage"
)

func alertServer(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	store, err := storage.NewSQLiteStore(filepath.Join(t.TempDir(), "a.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	coord := provider.NewCacheCoordinator(store, nil, nil)
	srv := NewServer(coord, hub.NewLiveHub(coord, time.Hour), "")
	if _, err := srv.EnableAlerts(); err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(srv.Routes())
	t.Cleanup(ts.Close)
	return srv, ts
}

func doJSON(t *testing.T, method, url string, body any) (int, map[string]any) {
	t.Helper()
	var rd io.Reader
	if s, ok := body.(string); ok {
		rd = strings.NewReader(s)
	} else if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, url, rd)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func TestAlertsCRUDAndActions(t *testing.T) {
	_, ts := alertServer(t)
	a := map[string]any{"name": "THY 300", "symbol": "THYAO.IS", "interval": "15m", "condition": "crossing_up",
		"target": map[string]any{"kind": "value", "value": 300}, "trigger": "once_per_bar", "message": "{{ticker}} {{close}}",
		"notify": map[string]any{"app": true, "popup": true}}
	code, created := doJSON(t, http.MethodPost, ts.URL+"/api/alerts", a)
	if code != http.StatusCreated || created["status"] != "active" || created["symbol"] != "THYAO.IS" {
		t.Fatalf("create %d %v", code, created)
	}
	id := created["id"].(string)
	code, list := doJSON(t, http.MethodGet, ts.URL+"/api/alerts", nil)
	if code != 200 || len(list["alerts"].([]any)) != 1 || list["feeds"].([]any)[0] != "THYAO.IS|15m" {
		t.Fatalf("list %d %v", code, list)
	}
	if code, one := doJSON(t, http.MethodGet, ts.URL+"/api/alerts?id="+id, nil); code != 200 || one["name"] != "THY 300" {
		t.Fatalf("get %d", code)
	}
	if code, _ := doJSON(t, http.MethodGet, ts.URL+"/api/alerts?id=nope", nil); code != 404 {
		t.Fatalf("get unknown %d", code)
	}
	a["name"] = "THY 310"
	if code, up := doJSON(t, http.MethodPut, ts.URL+"/api/alerts?id="+id, a); code != 200 || up["name"] != "THY 310" {
		t.Fatalf("update %d %v", code, up)
	}
	if code, _ := doJSON(t, http.MethodPut, ts.URL+"/api/alerts?id=nope", a); code != 404 {
		t.Fatalf("update unknown %d", code)
	}
	for _, c := range []struct {
		do, status string
	}{{"stop", "stopped"}, {"restart", "active"}} {
		if code, r := doJSON(t, http.MethodPost, ts.URL+"/api/alerts/action?do="+c.do+"&id="+id, nil); code != 200 || r["status"] != c.status {
			t.Fatalf("%s %d %v", c.do, code, r)
		}
	}
	code, cl := doJSON(t, http.MethodPost, ts.URL+"/api/alerts/action?do=clone&id="+id, nil)
	if code != 200 || cl["id"] == id || cl["name"] != "THY 310 (kopya)" {
		t.Fatalf("clone %d %v", code, cl)
	}
	if code, r := doJSON(t, http.MethodPost, ts.URL+"/api/alerts/action?do=stop_all", nil); code != 200 || r["affected"].(float64) != 2 {
		t.Fatalf("stop_all %d %v", code, r)
	}
	for _, bad := range []string{"?do=zzz", "?do=stop&id=nope"} {
		if code, _ := doJSON(t, http.MethodPost, ts.URL+"/api/alerts/action"+bad, nil); code == 200 {
			t.Fatalf("%s must fail", bad)
		}
	}
	if code, _ := doJSON(t, http.MethodGet, ts.URL+"/api/alerts/action?do=stop_all", nil); code != 405 {
		t.Fatal("action GET")
	}
	if code, _ := doJSON(t, http.MethodDelete, ts.URL+"/api/alerts?id="+id, nil); code != 200 {
		t.Fatal("delete")
	}
	if code, _ := doJSON(t, http.MethodDelete, ts.URL+"/api/alerts?id="+id, nil); code != 404 {
		t.Fatal("delete twice")
	}
	if code, r := doJSON(t, http.MethodPost, ts.URL+"/api/alerts", map[string]any{"symbol": "X", "condition": "nope"}); code != 400 || !strings.Contains(r["error"].(string), "condition") {
		t.Fatalf("invalid %d %v", code, r)
	}
	if code, _ := doJSON(t, http.MethodPost, ts.URL+"/api/alerts", "{bad"); code != 400 {
		t.Fatal("bad json")
	}
	if code, _ := doJSON(t, http.MethodPut, ts.URL+"/api/alerts?id=x", "{bad"); code != 400 {
		t.Fatal("bad json put")
	}
	if code, _ := doJSON(t, http.MethodPatch, ts.URL+"/api/alerts", nil); code != 405 {
		t.Fatal("patch")
	}
}

func TestAlertsLogStreamAndFiring(t *testing.T) {
	srv, ts := alertServer(t)
	// a live tick through the real hub reaches the engine, which fires and streams it
	resp, err := http.Get(ts.URL + "/api/alerts/stream")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content type %q", ct)
	}
	rd := bufio.NewReader(resp.Body)
	eng := srv.Alerts.Engine
	_, err = eng.Create(context.Background(), alerts.Alert{Symbol: "THYAO.IS", Interval: "15m", Condition: alerts.CondGreaterThan,
		Target: &alerts.Operand{Kind: "value", Value: 100}, Message: "{{ticker}} {{close}} > 100"})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().Unix()
	srv.Hub.BroadcastCandle(domain.LiveCandleMessage{Symbol: "THYAO.IS", Interval: "15m",
		Candle: domain.Candle{Timestamp: now - now%900, Open: 290, High: 301, Low: 289, Close: 300.5}})
	eng.Step(context.Background())
	deadline := time.Now().Add(3 * time.Second)
	var data string
	for time.Now().Before(deadline) && data == "" {
		line, err := rd.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		if strings.HasPrefix(line, "data: ") {
			data = strings.TrimPrefix(strings.TrimSpace(line), "data: ")
		}
	}
	var e alerts.LogEntry
	if err := json.Unmarshal([]byte(data), &e); err != nil || e.Message != "THYAO 300.5 > 100" {
		t.Fatalf("stream entry %q %v", data, err)
	}
	code, lg := doJSON(t, http.MethodGet, ts.URL+"/api/alerts/log?after=0&limit=10", nil)
	if code != 200 || len(lg["log"].([]any)) != 1 {
		t.Fatalf("log %d %v", code, lg)
	}
	if code, _ := doJSON(t, http.MethodDelete, ts.URL+"/api/alerts/log", nil); code != 200 {
		t.Fatal("clear log")
	}
	if _, lg = doJSON(t, http.MethodGet, ts.URL+"/api/alerts/log", nil); len(lg["log"].([]any)) != 0 {
		t.Fatal("log cleared")
	}
	if code, _ := doJSON(t, http.MethodPost, ts.URL+"/api/alerts/log", nil); code != 405 {
		t.Fatal("log POST")
	}
}

func TestAlertsConfigTestAndPush(t *testing.T) {
	srv, ts := alertServer(t)
	var tgText string
	tg := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var m map[string]any
		_ = json.NewDecoder(r.Body).Decode(&m)
		tgText, _ = m["text"].(string)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer tg.Close()
	srv.Alerts.Notifier.TelegramBase = tg.URL

	code, cfg := doJSON(t, http.MethodGet, ts.URL+"/api/alerts/config", nil)
	if code != 200 || cfg["telegram"].(map[string]any)["tokenSet"] != false {
		t.Fatalf("config %d %v", code, cfg)
	}
	code, cfg = doJSON(t, http.MethodPut, ts.URL+"/api/alerts/config", map[string]any{"telegram": map[string]any{"enabled": true, "chatId": "99", "token": "SECRET"}})
	tgv := cfg["telegram"].(map[string]any)
	if code != 200 || tgv["tokenSet"] != true || tgv["token"] != nil || tgv["chatId"] != "99" {
		t.Fatalf("config put %d %v", code, cfg)
	}
	if code, r := doJSON(t, http.MethodPost, ts.URL+"/api/alerts/test?channel=telegram", nil); code != 200 || r["ok"] != true || !strings.Contains(tgText, "TitanView alarm testi") {
		t.Fatalf("telegram test %d %v %q", code, r, tgText)
	}
	if code, r := doJSON(t, http.MethodPost, ts.URL+"/api/alerts/test?channel=push", nil); code != 502 || r["detail"] != "abone tarayıcı yok" {
		t.Fatalf("push test without subscribers %d %v", code, r)
	}
	hook := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer hook.Close()
	if code, r := doJSON(t, http.MethodPost, ts.URL+"/api/alerts/test?channel=webhook&url="+hook.URL, nil); code != 200 || r["ok"] != true {
		t.Fatalf("webhook test %d %v", code, r)
	}
	for _, bad := range []string{"?channel=webhook&url=ftp://x", "?channel=sms"} {
		if code, _ := doJSON(t, http.MethodPost, ts.URL+"/api/alerts/test"+bad, nil); code != 400 {
			t.Fatalf("%s must be 400", bad)
		}
	}
	if code, _ := doJSON(t, http.MethodGet, ts.URL+"/api/alerts/test?channel=push", nil); code != 405 {
		t.Fatal("test GET")
	}
	if code, _ := doJSON(t, http.MethodPut, ts.URL+"/api/alerts/config", "{bad"); code != 400 {
		t.Fatal("config bad json")
	}
	if code, _ := doJSON(t, http.MethodDelete, ts.URL+"/api/alerts/config", nil); code != 405 {
		t.Fatal("config delete")
	}

	code, key := doJSON(t, http.MethodGet, ts.URL+"/api/alerts/push/key", nil)
	pk, _ := key["publicKey"].(string)
	if code != 200 || len(pk) != 87 { // 65 bytes base64url without padding
		t.Fatalf("push key %d %q", code, pk)
	}
	sub := map[string]any{"endpoint": "https://fcm.googleapis.com/fcm/send/abc", "keys": map[string]any{"p256dh": "BOr", "auth": "x"}}
	if code, _ := doJSON(t, http.MethodPost, ts.URL+"/api/alerts/push/subscribe", sub); code != 201 {
		t.Fatalf("subscribe %d", code)
	}
	if _, cfg = doJSON(t, http.MethodGet, ts.URL+"/api/alerts/config", nil); cfg["pushSubscriptions"].(float64) != 1 {
		t.Fatalf("subscriptions %v", cfg)
	}
	if code, _ := doJSON(t, http.MethodDelete, ts.URL+"/api/alerts/push/subscribe?endpoint=https://fcm.googleapis.com/fcm/send/abc", nil); code != 200 {
		t.Fatal("unsubscribe")
	}
	for _, bad := range []any{"{bad", map[string]any{"endpoint": "http://insecure", "keys": map[string]any{"p256dh": "a", "auth": "b"}}} {
		if code, _ := doJSON(t, http.MethodPost, ts.URL+"/api/alerts/push/subscribe", bad); code != 400 {
			t.Fatalf("bad subscription %v → %d", bad, code)
		}
	}
	if code, _ := doJSON(t, http.MethodGet, ts.URL+"/api/alerts/push/subscribe", nil); code != 405 {
		t.Fatal("subscribe GET")
	}
}

func TestAlertsDisabledAndHistoryAdapter(t *testing.T) {
	store, err := storage.NewSQLiteStore(filepath.Join(t.TempDir(), "b.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	coord := provider.NewCacheCoordinator(store, nil, nil)
	srv := NewServer(coord, hub.NewLiveHub(coord, time.Hour), "")
	ts := httptest.NewServer(srv.Routes())
	defer ts.Close()
	for _, p := range []string{"/api/alerts", "/api/alerts/action", "/api/alerts/log", "/api/alerts/stream", "/api/alerts/config", "/api/alerts/test", "/api/alerts/push/key", "/api/alerts/push/subscribe"} {
		if code, _ := doJSON(t, http.MethodGet, ts.URL+p, nil); code != http.StatusServiceUnavailable {
			t.Fatalf("%s without engine: %d", p, code)
		}
	}
	// the history adapter trims to the requested bar count from the SQLite cache
	now := time.Now().Unix()
	var cs []domain.Candle
	for i := 0; i < 30; i++ {
		ts := now - now%60 - int64(29-i)*60
		cs = append(cs, domain.Candle{Symbol: "BTCUSDT", Timeframe: "1m", Timestamp: ts, Open: 1, High: 1, Low: 1, Close: float64(i), Volume: 1})
	}
	_ = store.BatchUpsertCandles(context.Background(), cs)
	_ = store.RecordFetchedRange(context.Background(), "BTCUSDT", "1m", cs[0].Timestamp, now)
	got, err := coordHistory{srv}.Candles(context.Background(), "BTCUSDT", "1m", 10)
	if err != nil || len(got) != 10 || got[9].Close != 29 {
		t.Fatalf("history adapter: %v %d", err, len(got))
	}
}
