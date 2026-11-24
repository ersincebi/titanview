package access

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

const (
	team = "acme"
	aud  = "aud-123"
	iss  = "https://acme.cloudflareaccess.com"
)

type fixture struct {
	key     *rsa.PrivateKey
	certs   *httptest.Server
	fetches atomic.Int32
	now     time.Time
	v       *Verifier
}

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func newFixture(t *testing.T, emails ...string) *fixture {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	f := &fixture{key: key, now: time.Unix(1_800_000_000, 0)}
	f.certs = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.fetches.Add(1)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"keys": []map[string]string{{
			"kid": "k1", "kty": "RSA", "alg": "RS256", "use": "sig",
			"n": b64(key.N.Bytes()), "e": b64(big.NewInt(int64(key.E)).Bytes()),
		}}})
	}))
	t.Cleanup(f.certs.Close)
	f.v = New(Config{Team: team, AUD: aud, Emails: emails, CertsURL: f.certs.URL, Now: func() time.Time { return f.now }})
	return f
}

func (f *fixture) token(t *testing.T, kid, alg string, claims map[string]interface{}) string {
	t.Helper()
	h, _ := json.Marshal(map[string]string{"alg": alg, "kid": kid, "typ": "JWT"})
	c, _ := json.Marshal(claims)
	signing := b64(h) + "." + b64(c)
	sum := sha256.Sum256([]byte(signing))
	sig, err := rsa.SignPKCS1v15(rand.Reader, f.key, crypto.SHA256, sum[:])
	if err != nil {
		t.Fatal(err)
	}
	return signing + "." + b64(sig)
}

func (f *fixture) good(t *testing.T) string {
	return f.token(t, "k1", "RS256", map[string]interface{}{
		"iss": iss, "aud": []string{aud}, "exp": f.now.Add(time.Hour).Unix(), "email": "me@example.com", "sub": "u1",
	})
}

func TestVerifyAcceptsValidToken(t *testing.T) {
	f := newFixture(t)
	c, err := f.v.Verify(f.good(t))
	if err != nil || c.Email != "me@example.com" {
		t.Fatalf("claims %+v err %v", c, err)
	}
}

func TestVerifyRejects(t *testing.T) {
	f := newFixture(t)
	exp := f.now.Add(time.Hour).Unix()
	cases := map[string]string{
		"empty":          "",
		"garbage":        "a.b",
		"wrong issuer":   f.token(t, "k1", "RS256", map[string]interface{}{"iss": "https://evil.cloudflareaccess.com", "aud": []string{aud}, "exp": exp}),
		"wrong audience": f.token(t, "k1", "RS256", map[string]interface{}{"iss": iss, "aud": []string{"other"}, "exp": exp}),
		"expired":        f.token(t, "k1", "RS256", map[string]interface{}{"iss": iss, "aud": []string{aud}, "exp": f.now.Add(-time.Hour).Unix()}),
		"no exp":         f.token(t, "k1", "RS256", map[string]interface{}{"iss": iss, "aud": []string{aud}}),
		"not yet valid":  f.token(t, "k1", "RS256", map[string]interface{}{"iss": iss, "aud": []string{aud}, "exp": exp, "nbf": f.now.Add(time.Hour).Unix()}),
		"alg none":       f.token(t, "k1", "none", map[string]interface{}{"iss": iss, "aud": []string{aud}, "exp": exp}),
		"alg HS256":      f.token(t, "k1", "HS256", map[string]interface{}{"iss": iss, "aud": []string{aud}, "exp": exp}),
		"unknown kid":    f.token(t, "zzz", "RS256", map[string]interface{}{"iss": iss, "aud": []string{aud}, "exp": exp}),
	}
	for name, tok := range cases {
		if _, err := f.v.Verify(tok); err == nil {
			t.Errorf("%s: must be rejected", name)
		}
	}
	// tampered payload keeps the old signature
	good := f.good(t)
	other := f.token(t, "k1", "RS256", map[string]interface{}{"iss": iss, "aud": []string{aud}, "exp": exp, "email": "evil@example.com"})
	parts := splitDot(good)
	parts2 := splitDot(other)
	if _, err := f.v.Verify(parts[0] + "." + parts2[1] + "." + parts[2]); err == nil {
		t.Error("tampered payload must fail signature check")
	}
}

func splitDot(s string) [3]string {
	var out [3]string
	i := 0
	cur := ""
	for _, r := range s {
		if r == '.' {
			out[i] = cur
			i++
			cur = ""
			continue
		}
		cur += string(r)
	}
	out[i] = cur
	return out
}

func TestKeyForgedWithOtherKeyIsRejected(t *testing.T) {
	f := newFixture(t)
	evil, _ := rsa.GenerateKey(rand.Reader, 2048)
	g := &fixture{key: evil, now: f.now}
	tok := g.good(t) // same kid "k1", different private key
	if _, err := f.v.Verify(tok); err == nil {
		t.Fatal("token signed with a foreign key must fail")
	}
}

func TestEmailAllowList(t *testing.T) {
	f := newFixture(t, "me@example.com")
	if _, err := f.v.Verify(f.good(t)); err != nil {
		t.Fatal(err)
	}
	g := newFixture(t, "someone@else.com")
	if _, err := g.v.Verify(g.good(t)); err == nil {
		t.Fatal("e-mail outside the allow-list must be rejected")
	}
}

func TestKeysAreCachedAndUnknownKidIsRateLimited(t *testing.T) {
	f := newFixture(t)
	for i := 0; i < 5; i++ {
		if _, err := f.v.Verify(f.good(t)); err != nil {
			t.Fatal(err)
		}
	}
	if n := f.fetches.Load(); n != 1 {
		t.Fatalf("keys must be fetched once, got %d", n)
	}
	for i := 0; i < 5; i++ {
		_, _ = f.v.Verify(f.token(t, "nope", "RS256", map[string]interface{}{"iss": iss, "aud": []string{aud}, "exp": f.now.Add(time.Hour).Unix()}))
	}
	if n := f.fetches.Load(); n != 1 {
		t.Fatalf("unknown kid must not hammer the certs endpoint, fetches=%d", n)
	}
	f.now = f.now.Add(2 * time.Hour) // cache expired: refetch once
	tok := f.token(t, "k1", "RS256", map[string]interface{}{"iss": iss, "aud": []string{aud}, "exp": f.now.Add(time.Hour).Unix()})
	if _, err := f.v.Verify(tok); err != nil || f.fetches.Load() != 2 {
		t.Fatalf("refetch after ttl: err %v fetches %d", err, f.fetches.Load())
	}
}

func TestFailsClosedWhenCertsUnreachable(t *testing.T) {
	f := newFixture(t)
	f.certs.Close()
	if _, err := f.v.Verify(f.good(t)); err == nil {
		t.Fatal("unreachable key set must deny")
	}
}

func TestMiddleware(t *testing.T) {
	f := newFixture(t)
	hits := 0
	h := Middleware(f.v, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if r.URL.Path == "/who" {
			_, _ = w.Write([]byte(r.Header.Get("X-Access-User")))
		}
	}))
	do := func(path string, mod func(*http.Request)) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, path, nil)
		if mod != nil {
			mod(r)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if w := do("/api/symbols", nil); w.Code != http.StatusUnauthorized || hits != 0 {
		t.Fatalf("no token: %d hits %d", w.Code, hits)
	}
	if w := do("/healthz", nil); w.Code != http.StatusOK || hits != 1 {
		t.Fatalf("healthz must be exempt: %d", w.Code)
	}
	tok := f.good(t)
	if w := do("/who", func(r *http.Request) { r.Header.Set(HeaderJWT, tok) }); w.Code != 200 || w.Body.String() != "me@example.com" {
		t.Fatalf("header token: %d %q", w.Code, w.Body.String())
	}
	if w := do("/ws/live", func(r *http.Request) { r.AddCookie(&http.Cookie{Name: CookieJWT, Value: tok}) }); w.Code != 200 {
		t.Fatalf("cookie token (websocket upgrade): %d", w.Code)
	}
	// a client cannot pre-set the identity header
	if w := do("/who", func(r *http.Request) { r.Header.Set("X-Access-User", "admin"); r.Header.Set(HeaderJWT, tok) }); w.Body.String() != "me@example.com" {
		t.Fatalf("identity header must come from the verified token, got %q", w.Body.String())
	}
}

func TestDisabledAndConfig(t *testing.T) {
	called := false
	h := Middleware(nil, http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true }))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/x", nil))
	if !called {
		t.Fatal("nil verifier must pass through")
	}
	if (Config{Team: "x"}).Validate() == nil || (Config{AUD: "x"}).Validate() == nil {
		t.Fatal("half configuration must be an error")
	}
	if (Config{}).Validate() != nil || (Config{Team: "a", AUD: "b"}).Validate() != nil {
		t.Fatal("empty and full configuration are valid")
	}
	if got := ParseEmails(" A@x.com, ,b@y.com "); len(got) != 2 || got[0] != "a@x.com" {
		t.Fatalf("emails %v", got)
	}
}
