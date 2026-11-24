// Package remote is the "uzak sunucu" mode (Faz 33): one TitanView server
// (home server, VPS, NAS) that phones and other computers reach over the
// network. Unlike the desktop sidecar, whose token lives for one launch, the
// remote token is persistent (0600 file next to the database) so a paired
// phone keeps working across restarts.
//
// Accepted credentials: X-Titan-Token header, Authorization: Bearer,
// titan_token query parameter (EventSource/WebSocket), titan_token cookie
// (browser after POST /api/remote/login). Requests from the Tauri webview
// origins (desktop and mobile) are delegated to desktop.Middleware; any other
// cross-origin request is refused. Repeated failures from one address are
// throttled.
package remote

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/ersincebi/titanview/backend/internal/desktop"
)

// TokenFile is the token's file name inside the data directory.
const TokenFile = "remote_token"

// CookieName holds the token for same-origin browser sessions.
const CookieName = "titan_token"

const minTokenLen = 24

// NewToken returns 32 random bytes, base64url without padding (43 chars).
func NewToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// ValidateToken checks a token supplied by the operator (TITAN_REMOTE_TOKEN).
func ValidateToken(tok string) error {
	if len(tok) < minTokenLen {
		return fmt.Errorf("remote token must be at least %d characters", minTokenLen)
	}
	if strings.ContainsAny(tok, " \t\r\n") {
		return errors.New("remote token must not contain whitespace")
	}
	return nil
}

// LoadOrCreateToken reads dir/remote_token, creating it (0600) on first use.
func LoadOrCreateToken(dir string) (string, error) {
	p := filepath.Join(dir, TokenFile)
	if b, err := os.ReadFile(p); err == nil {
		tok := strings.TrimSpace(string(b))
		if err := ValidateToken(tok); err != nil {
			return "", fmt.Errorf("%s: %w", p, err)
		}
		return tok, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	return RotateToken(dir)
}

// RotateToken writes a fresh token, unpairing every device.
func RotateToken(dir string) (string, error) {
	tok, err := NewToken()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	p := filepath.Join(dir, TokenFile)
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, []byte(tok+"\n"), 0o600); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, p); err != nil {
		return "", err
	}
	return tok, nil
}

// PairURI is what the phone scans or pastes: titanview://pair?server=…&token=…
func PairURI(server, token string) string {
	q := url.Values{}
	q.Set("server", strings.TrimRight(server, "/"))
	q.Set("token", token)
	return "titanview://pair?" + q.Encode()
}

// ParsePairURI is the inverse of PairURI.
func ParsePairURI(raw string) (server, token string, err error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", "", err
	}
	if u.Scheme != "titanview" || (u.Host != "pair" && u.Opaque != "pair") {
		return "", "", errors.New("not a titanview://pair URI")
	}
	server, token = u.Query().Get("server"), u.Query().Get("token")
	su, err := url.Parse(server)
	if err != nil || (su.Scheme != "http" && su.Scheme != "https") || su.Host == "" {
		return "", "", errors.New("pair URI has no valid http(s) server")
	}
	if err := ValidateToken(token); err != nil {
		return "", "", err
	}
	return server, token, nil
}

// Limiter throttles addresses that keep presenting wrong tokens.
type Limiter struct {
	Max    int
	Window time.Duration
	now    func() time.Time

	mu    sync.Mutex
	fails map[string][]time.Time
}

// NewLimiter allows max failures per window per address.
func NewLimiter(max int, window time.Duration) *Limiter {
	return &Limiter{Max: max, Window: window, now: time.Now, fails: map[string][]time.Time{}}
}

func (l *Limiter) prune(key string, now time.Time) []time.Time {
	ts := l.fails[key]
	i := 0
	for i < len(ts) && now.Sub(ts[i]) >= l.Window {
		i++
	}
	ts = ts[i:]
	if len(ts) == 0 {
		delete(l.fails, key)
	} else {
		l.fails[key] = ts
	}
	return ts
}

// Blocked reports whether key has used up its failures for the window.
func (l *Limiter) Blocked(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.prune(key, l.now())) >= l.Max
}

// Fail records one failed attempt.
func (l *Limiter) Fail(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.fails[key] = append(l.prune(key, now), now)
}

// Reset forgets key after a successful attempt.
func (l *Limiter) Reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.fails, key)
}

func clientKey(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func presented(r *http.Request) string {
	if v := r.Header.Get(desktop.TokenHeader); v != "" {
		return v
	}
	if v := r.Header.Get("Authorization"); len(v) > 7 && strings.EqualFold(v[:7], "bearer ") {
		return strings.TrimSpace(v[7:])
	}
	if v := r.URL.Query().Get(desktop.TokenParam); v != "" {
		return v
	}
	if c, err := r.Cookie(CookieName); err == nil {
		return c.Value
	}
	return ""
}

func equal(a, b string) bool { return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1 }

func sameOrigin(r *http.Request, origin string) bool {
	u, err := url.Parse(origin)
	return err == nil && u.Host != "" && strings.EqualFold(u.Host, r.Host)
}

func isBackend(p string) bool {
	return p == "/api" || strings.HasPrefix(p, "/api/") || strings.HasPrefix(p, "/ws")
}

// Options tweaks Middleware; the zero value is production-ready.
type Options struct {
	Limiter *Limiter // default: 10 failures / 10 minutes per address
	// Static serves the web app shell without a token so a browser can show
	// the connection screen; API, WebSocket and SSE paths always need one.
	Static bool
}

// Middleware enforces the remote token on next.
func Middleware(token string, next http.Handler, opt Options) http.Handler {
	lim := opt.Limiter
	if lim == nil {
		lim = NewLimiter(10, 10*time.Minute)
	}
	tauri := desktop.Middleware(token, next)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := clientKey(r)
		if lim.Blocked(key) {
			w.Header().Set("Retry-After", fmt.Sprint(int(lim.Window.Seconds())))
			http.Error(w, "too many failed attempts", http.StatusTooManyRequests)
			return
		}
		origin := r.Header.Get("Origin")
		if origin != "" && desktop.AllowedOrigin(origin) {
			if r.Method != http.MethodOptions {
				if equal(presented(r), token) {
					lim.Reset(key)
				} else {
					lim.Fail(key)
				}
			}
			tauri.ServeHTTP(w, r)
			return
		}
		if origin != "" && !sameOrigin(r, origin) {
			http.Error(w, "origin not allowed", http.StatusForbidden)
			return
		}
		switch r.URL.Path {
		case "/healthz":
			next.ServeHTTP(w, r)
			return
		case "/api/remote/login":
			login(w, r, token, lim)
			return
		case "/api/remote/logout":
			logout(w)
			return
		}
		if opt.Static && !isBackend(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		if !equal(presented(r), token) {
			lim.Fail(key)
			http.Error(w, "missing or invalid remote token", http.StatusUnauthorized)
			return
		}
		lim.Reset(key)
		next.ServeHTTP(w, r)
	})
}

func login(w http.ResponseWriter, r *http.Request, token string, lim *Limiter) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&body); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	key := clientKey(r)
	if !equal(strings.TrimSpace(body.Token), token) {
		lim.Fail(key)
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}
	lim.Reset(key)
	http.SetCookie(w, &http.Cookie{
		Name: CookieName, Value: token, Path: "/", HttpOnly: true,
		Secure:   r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https"),
		SameSite: http.SameSiteStrictMode, MaxAge: 180 * 24 * 3600,
	})
	w.WriteHeader(http.StatusNoContent)
}

func logout(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: CookieName, Value: "", Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: -1})
	w.WriteHeader(http.StatusNoContent)
}
