package remote

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const tok = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"

func ok() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, "ok") })
}

func do(h http.Handler, method, target string, set func(*http.Request)) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, nil)
	req.RemoteAddr = "10.0.0.5:4242"
	if set != nil {
		set(req)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestTokenFile(t *testing.T) {
	dir := t.TempDir()
	a, err := LoadOrCreateToken(dir)
	if err != nil || len(a) != 43 {
		t.Fatalf("create: %q %v", a, err)
	}
	st, _ := os.Stat(filepath.Join(dir, TokenFile))
	if st.Mode().Perm() != 0o600 {
		t.Fatalf("perm %v", st.Mode().Perm())
	}
	if b, _ := LoadOrCreateToken(dir); a != b {
		t.Fatal("token not persistent")
	}
	if c, _ := RotateToken(dir); c == a {
		t.Fatal("rotate kept token")
	}
	_ = os.WriteFile(filepath.Join(dir, TokenFile), []byte("short"), 0o600)
	if _, err := LoadOrCreateToken(dir); err == nil {
		t.Fatal("weak token accepted")
	}
	if ValidateToken("has space has space has space") == nil {
		t.Fatal("whitespace accepted")
	}
}

func TestPairURI(t *testing.T) {
	u := PairURI("https://home.example:8443/", tok)
	s, k, err := ParsePairURI(u)
	if err != nil || s != "https://home.example:8443" || k != tok {
		t.Fatalf("%s → %q %q %v", u, s, k, err)
	}
	for _, bad := range []string{"https://x", "titanview://pair?server=ftp://x&token=" + tok, "titanview://pair?server=https://x&token=short"} {
		if _, _, err := ParsePairURI(bad); err == nil {
			t.Errorf("accepted %s", bad)
		}
	}
}

func TestMiddleware(t *testing.T) {
	h := Middleware(tok, ok(), Options{})
	cases := []struct {
		name string
		set  func(*http.Request)
		path string
		want int
	}{
		{"none", nil, "/api/x", 401},
		{"header", func(r *http.Request) { r.Header.Set("X-Titan-Token", tok) }, "/api/x", 200},
		{"bearer", func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+tok) }, "/api/x", 200},
		{"query", nil, "/ws/live?titan_token=" + tok, 200},
		{"cookie", func(r *http.Request) { r.AddCookie(&http.Cookie{Name: CookieName, Value: tok}) }, "/api/x", 200},
		{"healthz", nil, "/healthz", 200},
		{"static closed by default", nil, "/index.html", 401},
		{"tauri android", func(r *http.Request) {
			r.Header.Set("Origin", "http://tauri.localhost")
			r.Header.Set("X-Titan-Token", tok)
		}, "/api/x", 200},
		{"tauri ios", func(r *http.Request) {
			r.Header.Set("Origin", "tauri://localhost")
			r.Header.Set("X-Titan-Token", tok)
		}, "/api/x", 200},
		{"tauri no token", func(r *http.Request) { r.Header.Set("Origin", "tauri://localhost") }, "/api/x", 401},
		{"same origin", func(r *http.Request) {
			r.Header.Set("Origin", "http://example.com")
			r.Header.Set("X-Titan-Token", tok)
		}, "/api/x", 200},
		{"foreign origin", func(r *http.Request) {
			r.Header.Set("Origin", "https://evil.example")
			r.Header.Set("X-Titan-Token", tok)
		}, "/api/x", 403},
	}
	for _, c := range cases {
		if got := do(h, "GET", c.path, c.set).Code; got != c.want {
			t.Errorf("%s: got %d want %d", c.name, got, c.want)
		}
	}
	hs := Middleware(tok, ok(), Options{Static: true})
	if got := do(hs, "GET", "/index.html", nil).Code; got != 200 {
		t.Errorf("static shell: %d", got)
	}
	if got := do(hs, "GET", "/api/x", nil).Code; got != 401 {
		t.Errorf("static mode leaked api: %d", got)
	}
}

func TestLoginCookie(t *testing.T) {
	h := Middleware(tok, ok(), Options{})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("POST", "/api/remote/login", strings.NewReader(`{"token":"nope"}`)))
	if rec.Code != 401 {
		t.Fatalf("bad login %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("POST", "/api/remote/login", strings.NewReader(`{"token":"`+tok+`"}`)))
	if rec.Code != 204 {
		t.Fatalf("login %d", rec.Code)
	}
	c := rec.Result().Cookies()
	if len(c) != 1 || !c[0].HttpOnly || c[0].SameSite != http.SameSiteStrictMode || c[0].Value != tok {
		t.Fatalf("cookie %+v", c)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("POST", "/api/remote/logout", nil))
	if rec.Code != 204 || rec.Result().Cookies()[0].MaxAge >= 0 {
		t.Fatal("logout did not clear cookie")
	}
}

func TestLimiter(t *testing.T) {
	now := time.Unix(1000, 0)
	lim := NewLimiter(3, time.Minute)
	lim.now = func() time.Time { return now }
	h := Middleware(tok, ok(), Options{Limiter: lim})
	good := func(r *http.Request) { r.Header.Set("X-Titan-Token", tok) }
	for i := 0; i < 3; i++ {
		do(h, "GET", "/api/x", nil)
	}
	if got := do(h, "GET", "/api/x", good).Code; got != 429 {
		t.Fatalf("not throttled: %d", got)
	}
	if got := do(h, "GET", "/api/x", func(r *http.Request) { r.RemoteAddr = "10.0.0.6:1"; good(r) }).Code; got != 200 {
		t.Fatalf("other address throttled: %d", got)
	}
	now = now.Add(61 * time.Second)
	if got := do(h, "GET", "/api/x", good).Code; got != 200 {
		t.Fatalf("window did not expire: %d", got)
	}
}
