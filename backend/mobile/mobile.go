// Package mobile is the in-process "yerel mod" of the TitanView phone app
// (Faz 33): the whole Go server runs inside the app on a random loopback
// port, guarded by a per-launch token, exactly like the desktop sidecar but
// without a child process (iOS forbids them).
//
// The API uses only gomobile-bindable types, so
//
//	gomobile bind -target=android ./mobile   (→ .aar)
//	gomobile bind -target=ios ./mobile       (→ .xcframework)
//
// work for native hosts. The Tauri app links the C exports in cmd/libtitan,
// which wrap this package.
package mobile

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/ersincebi/titanview/backend/internal/app"
	"github.com/ersincebi/titanview/backend/internal/desktop"
)

// Config is what Start returns (JSON): the same shape the shell injects as
// window.__TITAN_DESKTOP__.
type Config struct {
	Base  string `json:"base"`
	Token string `json:"token"`
}

var (
	mu      sync.Mutex
	running *app.App
	current Config
)

// Start launches the server with its data under dataDir and returns the
// connection config as JSON. Calling it again while running returns the same
// config.
func Start(dataDir string) (string, error) {
	mu.Lock()
	defer mu.Unlock()
	if running != nil {
		b, _ := json.Marshal(current)
		return string(b), nil
	}
	dataDir = strings.TrimSpace(dataDir)
	if dataDir == "" {
		return "", errors.New("mobile: dataDir required")
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return "", err
	}
	tok := make([]byte, 32)
	if _, err := rand.Read(tok); err != nil {
		return "", err
	}
	token := hex.EncodeToString(tok)
	a, err := app.New(app.Config{
		DBPath:    filepath.Join(dataDir, "titanview.db"),
		Addr:      "127.0.0.1:0",
		PollEvery: 30 * time.Second, // battery: half the desktop rate
		Wrap:      func(h http.Handler) http.Handler { return desktop.Middleware(token, h) },
	})
	if err != nil {
		return "", err
	}
	addr, err := a.Start()
	if err != nil {
		_ = a.Stop(time.Second)
		return "", err
	}
	running, current = a, Config{Base: "http://" + addr, Token: token}
	b, _ := json.Marshal(current)
	return string(b), nil
}

// Stop shuts the server down (app going to background for good / exiting).
func Stop() {
	mu.Lock()
	a := running
	running, current = nil, Config{}
	mu.Unlock()
	if a != nil {
		_ = a.Stop(3 * time.Second)
	}
}

// Running reports whether the server is up.
func Running() bool {
	mu.Lock()
	defer mu.Unlock()
	return running != nil
}
