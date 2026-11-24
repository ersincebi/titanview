package desktop

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func inner() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*") // like api.withCORS
		_, _ = io.WriteString(w, "ok")
	})
}

func TestMiddlewareToken(t *testing.T) {
	h := Middleware("s3cret", inner())
	cases := []struct {
		name, url, header, origin string
		want                      int
	}{
		{"no token", "/api/x", "", "", 401},
		{"bad token", "/api/x", "nope", "", 401},
		{"header token", "/api/x", "s3cret", "", 200},
		{"query token", "/api/x?titan_token=s3cret", "", "", 200},
		{"tauri origin", "/api/x", "s3cret", "tauri://localhost", 200},
		{"windows origin", "/api/x", "s3cret", "http://tauri.localhost", 200},
		{"foreign origin", "/api/x", "s3cret", "https://evil.example", 403},
	}
	for _, c := range cases {
		req := httptest.NewRequest(http.MethodGet, c.url, nil)
		if c.header != "" {
			req.Header.Set(TokenHeader, c.header)
		}
		if c.origin != "" {
			req.Header.Set("Origin", c.origin)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != c.want {
			t.Errorf("%s: code %d want %d", c.name, rec.Code, c.want)
		}
		if c.want == 200 && c.origin != "" {
			if got := rec.Header().Get("Access-Control-Allow-Origin"); got != c.origin {
				t.Errorf("%s: ACAO %q want %q", c.name, got, c.origin)
			}
		}
	}
}

func TestMiddlewarePreflight(t *testing.T) {
	h := Middleware("s3cret", inner())
	req := httptest.NewRequest(http.MethodOptions, "/api/x", nil)
	req.Header.Set("Origin", "tauri://localhost")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 204 || !strings.Contains(rec.Header().Get("Access-Control-Allow-Headers"), TokenHeader) {
		t.Fatalf("preflight: %d %v", rec.Code, rec.Header())
	}
	req.Header.Set("Origin", "https://evil.example")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 403 {
		t.Fatalf("foreign preflight: %d", rec.Code)
	}
}

func TestMiddlewareEmptyTokenDisables(t *testing.T) {
	rec := httptest.NewRecorder()
	Middleware("", inner()).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != 200 {
		t.Fatalf("code %d", rec.Code)
	}
}

func TestWebSocketThroughMiddleware(t *testing.T) {
	up := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	ws := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		_ = c.WriteMessage(websocket.TextMessage, []byte("hi"))
	})
	srv := httptest.NewServer(Middleware("tok", ws))
	defer srv.Close()
	u := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/live?titan_token=tok"
	c, _, err := websocket.DefaultDialer.Dial(u, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	_, msg, err := c.ReadMessage()
	if err != nil || string(msg) != "hi" {
		t.Fatalf("msg %q err %v", msg, err)
	}
	if _, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/ws/live", nil); err == nil {
		t.Fatal("tokenless websocket must be refused")
	}
}

func TestSSEFlushThroughMiddleware(t *testing.T) {
	sse := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fl, ok := w.(http.Flusher)
		if !ok {
			t.Error("wrapper must implement http.Flusher")
			return
		}
		_, _ = io.WriteString(w, "event: alert\ndata: {}\n\n")
		fl.Flush()
		<-r.Context().Done()
	})
	srv := httptest.NewServer(Middleware("tok", sse))
	defer srv.Close()
	resp, err := http.Get(srv.URL + "/api/alerts/stream?titan_token=tok")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	buf := make([]byte, 64)
	n, _ := resp.Body.Read(buf)
	if !strings.Contains(string(buf[:n]), "event: alert") {
		t.Fatalf("got %q", buf[:n])
	}
}

func TestWatchStdin(t *testing.T) {
	r, w := io.Pipe()
	done := make(chan struct{})
	WatchStdin(r, func() { close(done) })
	_, _ = w.Write([]byte("still alive"))
	select {
	case <-done:
		t.Fatal("stopped while stdin open")
	case <-time.After(50 * time.Millisecond):
	}
	_ = w.Close()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("did not stop on EOF")
	}
}

func TestListenLine(t *testing.T) {
	if ListenLine(" 127.0.0.1:5000\n") != "TITAN_LISTEN=127.0.0.1:5000" {
		t.Fatal(ListenLine("127.0.0.1:5000"))
	}
}
