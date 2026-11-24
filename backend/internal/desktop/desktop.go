// Package desktop holds the pieces the Go server needs when it runs as the
// Tauri desktop sidecar (Faz 31): a per-launch session token, a CORS policy
// limited to the Tauri webview origins, and a stdin watchdog that stops the
// server when the parent process goes away.
package desktop

import (
	"bufio"
	"crypto/subtle"
	"errors"
	"net"
	"io"
	"net/http"
	"strings"
)

// TokenHeader carries the per-launch session token on fetch/XHR requests.
const TokenHeader = "X-Titan-Token"

// TokenParam carries the token where custom headers are impossible
// (EventSource, WebSocket).
const TokenParam = "titan_token"

// allowedOrigins are the origins the Tauri v2 webview uses for bundled assets
// (macOS/Linux: tauri://localhost, Windows: http(s)://tauri.localhost).
var allowedOrigins = map[string]bool{
	"tauri://localhost":       true,
	"http://tauri.localhost":  true,
	"https://tauri.localhost": true,
}

// AllowedOrigin reports whether origin is a Tauri webview origin.
func AllowedOrigin(origin string) bool { return allowedOrigins[origin] }

// Middleware enforces the session token on every request except CORS
// preflights, and answers preflights for Tauri origins only. An empty token
// disables the check (never used by the desktop shell, which always sets one).
func Middleware(token string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && AllowedOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			if origin != "" && !AllowedOrigin(origin) {
				http.Error(w, "origin not allowed", http.StatusForbidden)
				return
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, "+TokenHeader)
			w.Header().Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if origin != "" && !AllowedOrigin(origin) {
			http.Error(w, "origin not allowed", http.StatusForbidden)
			return
		}
		if token != "" && !validToken(r, token) {
			http.Error(w, "missing or invalid desktop session token", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(&originWriter{ResponseWriter: w, origin: origin}, r)
	})
}

func validToken(r *http.Request, token string) bool {
	got := r.Header.Get(TokenHeader)
	if got == "" {
		got = r.URL.Query().Get(TokenParam)
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(token)) == 1
}

// originWriter keeps the specific Tauri origin even if an inner handler
// writes the generic "*" CORS header.
type originWriter struct {
	http.ResponseWriter
	origin string
}

func (o *originWriter) WriteHeader(code int) {
	o.fix()
	o.ResponseWriter.WriteHeader(code)
}

func (o *originWriter) Write(b []byte) (int, error) {
	o.fix()
	return o.ResponseWriter.Write(b)
}

func (o *originWriter) fix() {
	if o.origin != "" && AllowedOrigin(o.origin) {
		o.Header().Set("Access-Control-Allow-Origin", o.origin)
	}
}

// Flush lets Server-Sent Events stream through the wrapper.
func (o *originWriter) Flush() {
	o.fix()
	if f, ok := o.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Unwrap exposes the inner writer to http.ResponseController and the
// WebSocket hijacker.
func (o *originWriter) Unwrap() http.ResponseWriter { return o.ResponseWriter }

// Hijack is required by gorilla/websocket's upgrader.
func (o *originWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := o.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("desktop: response writer cannot hijack")
	}
	return h.Hijack()
}

// WatchStdin calls stop once r reaches EOF or fails: the Tauri shell keeps
// the sidecar's stdin open for its whole life, so EOF means the parent died.
func WatchStdin(r io.Reader, stop func()) {
	go func() {
		_, _ = io.Copy(io.Discard, r)
		stop()
	}()
}

// ListenLine is the stdout line the shell parses to learn the chosen port.
func ListenLine(addr string) string { return "TITAN_LISTEN=" + strings.TrimSpace(addr) }
