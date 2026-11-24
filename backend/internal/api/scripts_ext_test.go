package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestScriptVersionsAndRenameAPI(t *testing.T) {
	h := newAnalyticsHandler(t, &stubUpstream{})
	do := func(method, url, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(method, url, strings.NewReader(body)))
		return rec
	}
	for _, code := range []string{"plot(close)", "plot(open)"} {
		if rec := do(http.MethodPost, "/api/scripts", `{"id":"s1","name":"Deneme","code":"`+code+`"}`); rec.Code != http.StatusOK {
			t.Fatalf("save: %d %s", rec.Code, rec.Body)
		}
	}
	var got struct {
		Versions []struct {
			Version int    `json:"version"`
			Code    string `json:"code"`
		} `json:"versions"`
	}
	getJSON(t, h, "/api/scripts/versions?id=s1", http.StatusOK, &got)
	if len(got.Versions) != 2 || got.Versions[0].Version != 2 || got.Versions[0].Code != "plot(open)" {
		t.Fatalf("versions: %+v", got)
	}
	getJSON(t, h, "/api/scripts/versions?id=none", http.StatusOK, &got)
	if len(got.Versions) != 0 {
		t.Fatalf("empty versions should be [] : %+v", got)
	}
	getJSON(t, h, "/api/scripts/versions", http.StatusBadRequest, nil)
	if rec := do(http.MethodPost, "/api/scripts/versions?id=s1", ""); rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("versions POST: %d", rec.Code)
	}

	if rec := do(http.MethodPost, "/api/scripts/rename", `{"id":"s1","name":"  Yeni Ad "}`); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"Yeni Ad"`) {
		t.Fatalf("rename: %d %s", rec.Code, rec.Body)
	}
	var list struct {
		Scripts []struct {
			Name string `json:"name"`
		} `json:"scripts"`
	}
	getJSON(t, h, "/api/scripts", http.StatusOK, &list)
	if len(list.Scripts) != 1 || list.Scripts[0].Name != "Yeni Ad" {
		t.Fatalf("list after rename: %+v", list)
	}
	cases := map[string]int{
		`{"id":"nope","name":"x"}`: http.StatusNotFound,
		`{"id":"s1","name":"  "}`:  http.StatusBadRequest,
		`not json`:                 http.StatusBadRequest,
	}
	for body, want := range cases {
		if rec := do(http.MethodPost, "/api/scripts/rename", body); rec.Code != want {
			t.Fatalf("rename %s: got %d want %d", body, rec.Code, want)
		}
	}
	if rec := do(http.MethodGet, "/api/scripts/rename", ""); rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("rename GET: %d", rec.Code)
	}
}
