package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ersincebi/titanview/backend/internal/hub"
	"github.com/ersincebi/titanview/backend/internal/provider"
	"github.com/ersincebi/titanview/backend/internal/storage"
)

func TestFootprintEndpointValidation(t *testing.T) {
	store, err := storage.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	coord := provider.NewCacheCoordinator(store, nil, nil)
	h := NewServer(coord, hub.NewLiveHub(coord, 10*time.Second), "").Routes()

	get := func(url string) (int, map[string]interface{}) {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, url, nil))
		var body map[string]interface{}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		return rec.Code, body
	}
	if code, body := get("/api/footprint?symbol=THYAO.IS&interval=15m&row=0.1&times=1731200400"); code != 200 || body["supported"] != false {
		t.Fatalf("BIST should be unsupported: %d %v", code, body)
	}
	if code, _ := get("/api/footprint?symbol=BTCUSDT&interval=1m&row=0&times=1731200400"); code != 400 {
		t.Fatalf("row=0 must be 400, got %d", code)
	}
	if code, _ := get("/api/footprint?symbol=BTCUSDT&interval=1m&row=10&times=1731200401"); code != 400 {
		t.Fatalf("misaligned time must be 400, got %d", code)
	}
	if code, _ := get("/api/footprint?symbol=BTCUSDT&interval=1m&row=10"); code != 400 {
		t.Fatalf("missing times must be 400, got %d", code)
	}
}
