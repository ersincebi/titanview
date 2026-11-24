// Package app assembles a complete TitanView server (store, providers, live
// hub, collector, alert and trading engines, HTTP) behind one Start/Stop
// pair. cmd/server (web, desktop sidecar, remote server) and the mobile
// local mode (backend/mobile) share it.
package app

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"path/filepath"
	"sync"
	"time"

	"github.com/ersincebi/titanview/backend/internal/api"
	"github.com/ersincebi/titanview/backend/internal/collector"
	"github.com/ersincebi/titanview/backend/internal/hub"
	"github.com/ersincebi/titanview/backend/internal/provider"
	"github.com/ersincebi/titanview/backend/internal/sources"
	"github.com/ersincebi/titanview/backend/internal/storage"
)

// Config describes one server instance.
type Config struct {
	DBPath            string        // SQLite file; its directory also holds secrets
	StaticDir         string        // built frontend; "" = API only (a shell serves the UI)
	Addr              string        // listen address (default 127.0.0.1:0)
	PollEvery         time.Duration // Yahoo polling (default 15s)
	CollectEvery      time.Duration // favourites collection (0 = off)
	NoTrading         bool          // skip the paper-trading engine
	PushSubject       string        // VAPID subject for web push
	UnofficialSources *bool         // explicit CLI override for unofficial sources (nil = SQLite / env / off)
	// Wrap adds outer middleware (access, desktop or remote token checks).
	Wrap func(http.Handler) http.Handler
}

// App is one server.
type App struct {
	cfg   Config
	store *storage.SQLiteStore
	srv   *api.Server

	mu       sync.Mutex
	hs       *http.Server
	ln       net.Listener
	cancel   context.CancelFunc
	done     chan struct{}
	stopping bool
}

// New opens the store and wires the API without listening yet.
func New(cfg Config) (*App, error) {
	if cfg.DBPath == "" {
		return nil, errors.New("app: DBPath required")
	}
	if cfg.PollEvery <= 0 {
		cfg.PollEvery = 15 * time.Second
	}
	if cfg.Addr == "" {
		cfg.Addr = "127.0.0.1:0"
	}
	store, err := storage.NewSQLiteStore(cfg.DBPath)
	if err != nil {
		return nil, fmt.Errorf("store %s: %w", cfg.DBPath, err)
	}
	sources.InstallDefaultTransport()
	if err := sources.Init(context.Background(), store, cfg.UnofficialSources); err != nil {
		_ = store.Close()
		return nil, fmt.Errorf("sources init: %w", err)
	}
	coord := provider.NewCacheCoordinator(store, nil, nil)
	srv := api.NewServer(coord, hub.NewLiveHub(coord, cfg.PollEvery), cfg.StaticDir)
	srv.NewsFallback = provider.NewGoogleNewsProvider(nil)
	if cfg.StaticDir == "" {
		srv.StaticDir = "" // NewServer would otherwise go looking for a dist/
	}
	return &App{cfg: cfg, store: store, srv: srv}, nil
}

// Server exposes the API server (tests, extra wiring).
func (a *App) Server() *api.Server { return a.srv }

// Start launches the engines and the listener and returns the bound address.
func (a *App) Start() (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.stopping {
		return "", errors.New("app: stopped")
	}
	if a.hs != nil {
		return a.ln.Addr().String(), nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	fail := func(err error) (string, error) { cancel(); return "", err }
	if a.cfg.CollectEvery > 0 {
		go collector.Run(ctx, a.store, a.srv.Coord, a.cfg.CollectEvery)
	}
	alerts, err := a.srv.EnableAlerts()
	if err != nil {
		return fail(fmt.Errorf("alert engine: %w", err))
	}
	if a.cfg.PushSubject != "" {
		a.srv.Alerts.Notifier.PushSubject = a.cfg.PushSubject
	}
	go alerts.Run(ctx)
	if !a.cfg.NoTrading {
		trade, err := a.srv.EnableTrading(filepath.Dir(a.cfg.DBPath))
		if err != nil {
			return fail(fmt.Errorf("trading engine: %w", err))
		}
		go trade.Run(ctx)
	}
	var h http.Handler = a.srv.Routes()
	if a.cfg.Wrap != nil {
		h = a.cfg.Wrap(h)
	}
	ln, err := net.Listen("tcp", a.cfg.Addr)
	if err != nil {
		return fail(fmt.Errorf("listen %s: %w", a.cfg.Addr, err))
	}
	a.ln, a.cancel, a.done = ln, cancel, make(chan struct{})
	// Long-lived SSE/WebSocket handlers watch the base context; cancelling it
	// on shutdown lets them return so Shutdown completes quickly.
	a.hs = &http.Server{Handler: h, ReadHeaderTimeout: 10 * time.Second, BaseContext: func(net.Listener) context.Context { return ctx }}
	go func(hs *http.Server, done chan struct{}) {
		defer close(done)
		if err := hs.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("app: serve: %v", err)
		}
	}(a.hs, a.done)
	return ln.Addr().String(), nil
}

// Addr is the bound address, or "" before Start.
func (a *App) Addr() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.ln == nil {
		return ""
	}
	return a.ln.Addr().String()
}

// Stop shuts the listener and engines down and closes the store. Safe to call twice.
func (a *App) Stop(timeout time.Duration) error {
	a.mu.Lock()
	if a.stopping {
		a.mu.Unlock()
		return nil
	}
	a.stopping = true
	hs, cancel, done := a.hs, a.cancel, a.done
	a.mu.Unlock()
	var err error
	if hs != nil {
		cancel()
		ctx, c := context.WithTimeout(context.Background(), timeout)
		err = hs.Shutdown(ctx)
		c()
		<-done
	}
	if cerr := a.store.Close(); err == nil {
		err = cerr
	}
	return err
}
