package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ersincebi/titanview/backend/internal/provider"
	"github.com/ersincebi/titanview/backend/internal/storage"
)

func TestLayoutsAPILifecycleAndSharedReadOnly(t *testing.T) {
	h := newAnalyticsHandler(t, &stubUpstream{})
	do := func(method, url, body string) (int, string) {
		req := httptest.NewRequest(method, url, strings.NewReader(body))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code, rec.Body.String()
	}

	// Empty list initially
	if code, body := do("GET", "/api/layouts", ""); code != 200 || !strings.Contains(body, `"layouts":[]`) {
		t.Fatalf("initial list: %d %s", code, body)
	}

	// Create layout
	code, body := do("POST", "/api/layouts", `{"name":"Kripto 4x4","gridId":"4x4","chartCount":16,"symbols":"BTCUSDT,ETHUSDT","state":{"layout":"4x4","symbol":"BTCUSDT","interval":"30s"}}`)
	if code != http.StatusCreated {
		t.Fatalf("create: %d %s", code, body)
	}
	var created storage.SavedLayout
	if err := json.Unmarshal([]byte(body), &created); err != nil || created.ID == "" {
		t.Fatalf("unmarshal created: %v %s", err, body)
	}

	// Get by ID
	if code, body := do("GET", "/api/layouts/"+created.ID, ""); code != 200 || !strings.Contains(body, `"Kripto 4x4"`) {
		t.Fatalf("get: %d %s", code, body)
	}

	// Update / rename
	if code, body := do("PUT", "/api/layouts/"+created.ID, `{"name":"Kripto Pro","autosave":false}`); code != 200 || !strings.Contains(body, `"Kripto Pro"`) || !strings.Contains(body, `"autosave":false`) {
		t.Fatalf("update: %d %s", code, body)
	}

	// Copy
	code, body = do("POST", "/api/layouts/"+created.ID+"/copy", `{"name":"Kripto Pro Yedek"}`)
	if code != http.StatusCreated || !strings.Contains(body, `"Kripto Pro Yedek"`) {
		t.Fatalf("copy: %d %s", code, body)
	}
	var copied storage.SavedLayout
	_ = json.Unmarshal([]byte(body), &copied)

	// Enable shareable read-only link
	code, body = do("POST", "/api/layouts/"+created.ID+"/share", `{"shared":true}`)
	if code != 200 {
		t.Fatalf("share enable: %d %s", code, body)
	}
	var shareResp struct {
		IsShared   bool   `json:"isShared"`
		ShareToken string `json:"shareToken"`
	}
	_ = json.Unmarshal([]byte(body), &shareResp)
	if !shareResp.IsShared || shareResp.ShareToken == "" {
		t.Fatalf("expected share token: %s", body)
	}

	// Fetch shared read-only snapshot
	code, body = do("GET", "/api/layouts/shared/"+shareResp.ShareToken, "")
	if code != 200 || !strings.Contains(body, `"readOnly":true`) || !strings.Contains(body, `"Kripto Pro"`) {
		t.Fatalf("get shared: %d %s", code, body)
	}

	// Disable share -> shared link becomes 404
	if code, _ := do("POST", "/api/layouts/"+created.ID+"/share", `{"shared":false}`); code != 200 {
		t.Fatalf("share disable: %d", code)
	}
	if code, _ := do("GET", "/api/layouts/shared/"+shareResp.ShareToken, ""); code != 404 {
		t.Fatalf("disabled share must 404, got %d", code)
	}

	// Validation & 404 checks
	if code, _ := do("POST", "/api/layouts", `{bad`); code != 400 {
		t.Fatalf("bad json: %d", code)
	}
	if code, _ := do("GET", "/api/layouts/nope", ""); code != 404 {
		t.Fatalf("missing id: %d", code)
	}

	// Delete both
	if code, _ := do("DELETE", "/api/layouts/"+created.ID, ""); code != 200 {
		t.Fatalf("delete 1: %d", code)
	}
	if code, _ := do("DELETE", "/api/layouts/"+copied.ID, ""); code != 200 {
		t.Fatalf("delete 2: %d", code)
	}
}

func TestHistoryReturns422OnYahooSecondsInterval(t *testing.T) {
	store, err := storage.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	defer store.Close()
	coord := provider.NewCacheCoordinator(store, provider.NewBinanceProvider(nil), provider.NewYahooProvider(nil))
	srv := NewServer(coord, nil, "")

	req := httptest.NewRequest("GET", "/api/history?symbol=THYAO.IS&interval=5s", nil)
	rec := httptest.NewRecorder()
	srv.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("want 422 for Yahoo 5s, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"unsupported":true`) {
		t.Fatalf("expected unsupported flag in body: %s", rec.Body.String())
	}
}
