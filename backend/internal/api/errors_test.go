package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandlerMethodAndValidationErrors(t *testing.T) {
	h := newAnalyticsHandler(t, &stubUpstream{fail: map[string]bool{"BAD": true}})
	do := func(method, url, body string) int {
		req := httptest.NewRequest(method, url, strings.NewReader(body))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	cases := []struct {
		method, url, body string
		want              int
	}{
		{"POST", "/api/history?symbol=AAPL", "", http.StatusMethodNotAllowed},
		{"GET", "/api/history?symbol=BAD&interval=1d", "", http.StatusBadGateway},
		{"POST", "/api/scripts", "{not json", http.StatusBadRequest},
		{"DELETE", "/api/scripts", "", http.StatusBadRequest},
		{"PUT", "/api/scripts", "", http.StatusMethodNotAllowed},
		{"POST", "/api/drawings", "{not json", http.StatusBadRequest},
		{"PUT", "/api/drawings", "", http.StatusMethodNotAllowed},
		{"GET", "/api/nope", "", http.StatusNotFound},
	}
	for _, c := range cases {
		if got := do(c.method, c.url, c.body); got != c.want {
			t.Errorf("%s %s = %d want %d", c.method, c.url, got, c.want)
		}
	}
}

func TestScriptGeneratedIDAndDrawingDefaults(t *testing.T) {
	h := newAnalyticsHandler(t, &stubUpstream{})
	req := httptest.NewRequest("POST", "/api/scripts", strings.NewReader(`{"name":"n","code":"c"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"id":"script_`) {
		t.Fatalf("server must mint an id: %d %s", rec.Code, rec.Body.String())
	}
	req = httptest.NewRequest("POST", "/api/drawings", strings.NewReader(`{"symbol":"x","timeframe":"1h","toolType":"t","pointsJson":"[]","styleJson":"{}"}`))
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"id":"draw_`) {
		t.Fatalf("drawing id: %d %s", rec.Code, rec.Body.String())
	}
}

func TestCollectEndpoint(t *testing.T) {
	h := newAnalyticsHandler(t, &stubUpstream{})
	do := func(method, body string) (int, string) {
		req := httptest.NewRequest(method, "/api/collect", strings.NewReader(body))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code, rec.Body.String()
	}
	if c, b := do("GET", ""); c != 200 || !strings.Contains(b, `"symbols":[]`) {
		t.Fatalf("empty list: %d %s", c, b)
	}
	if c, b := do("PUT", `{"symbols":["thyao.is","BTCUSDT"]}`); c != 200 || !strings.Contains(b, "THYAO.IS") {
		t.Fatalf("put: %d %s", c, b)
	}
	if c, b := do("GET", ""); c != 200 || !strings.Contains(b, "BTCUSDT") {
		t.Fatalf("persisted: %d %s", c, b)
	}
	if c, b := do("GET", ""); c != 200 || !strings.Contains(b, `"displayName"`) || !strings.Contains(b, `"market":"BIST"`) {
		t.Fatalf("items with display info: %d %s", c, b)
	}
	if c, _ := do("PUT", "{nope"); c != http.StatusBadRequest {
		t.Errorf("bad json: %d", c)
	}
	if c, _ := do("DELETE", ""); c != http.StatusMethodNotAllowed {
		t.Errorf("method: %d", c)
	}
}
