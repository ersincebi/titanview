package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSettingsRoundTrip(t *testing.T) {
	h := newAnalyticsHandler(t, &stubUpstream{})
	getJSON(t, h, "/api/settings?key=workspace", http.StatusNotFound, nil)

	put := func(url, body string) int {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, url, strings.NewReader(body)))
		return rec.Code
	}
	if c := put("/api/settings?key=workspace", `{"symbol":"BTCUSDT","n":1}`); c != http.StatusOK {
		t.Fatalf("put: %d", c)
	}
	var got struct {
		Value     map[string]interface{} `json:"value"`
		UpdatedAt int64                  `json:"updatedAt"`
	}
	getJSON(t, h, "/api/settings?key=workspace", http.StatusOK, &got)
	if got.Value["symbol"] != "BTCUSDT" || got.UpdatedAt == 0 {
		t.Fatalf("got %+v", got)
	}
	// overwrite
	put("/api/settings?key=workspace", `{"symbol":"AAPL"}`)
	getJSON(t, h, "/api/settings?key=workspace", http.StatusOK, &got)
	if got.Value["symbol"] != "AAPL" {
		t.Fatalf("overwrite: %+v", got)
	}
}

func TestSettingsValidation(t *testing.T) {
	h := newAnalyticsHandler(t, &stubUpstream{})
	for _, k := range []string{"", "BAD KEY", "../x", strings.Repeat("a", 41)} {
		getJSON(t, h, "/api/settings?key="+strings.ReplaceAll(k, " ", "%20"), http.StatusBadRequest, nil)
	}
	put := func(body string) int {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/api/settings?key=workspace", strings.NewReader(body)))
		return rec.Code
	}
	if c := put("not json"); c != http.StatusBadRequest {
		t.Fatalf("invalid json: %d", c)
	}
	if c := put(`"` + strings.Repeat("x", 600*1024) + `"`); c != http.StatusRequestEntityTooLarge {
		t.Fatalf("too large: %d", c)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/api/settings?key=workspace", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("delete: %d", rec.Code)
	}
}
