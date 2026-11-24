package app

import (
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestStartStop(t *testing.T) {
	wrapped := false
	a, err := New(Config{DBPath: filepath.Join(t.TempDir(), "t.db"), NoTrading: true, Wrap: func(h http.Handler) http.Handler {
		wrapped = true
		return h
	}})
	if err != nil {
		t.Fatal(err)
	}
	if a.Addr() != "" {
		t.Fatal("addr before start")
	}
	addr, err := a.Start()
	if err != nil {
		t.Fatal(err)
	}
	if again, _ := a.Start(); again != addr || a.Addr() != addr || !wrapped {
		t.Fatalf("Start not idempotent / not wrapped: %s %s %v", again, addr, wrapped)
	}
	resp, err := http.Get("http://" + addr + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("healthz %d", resp.StatusCode)
	}
	if err := a.Stop(3 * time.Second); err != nil {
		t.Fatal(err)
	}
	if err := a.Stop(time.Second); err != nil {
		t.Fatal("second Stop:", err)
	}
	if _, err := a.Start(); err == nil {
		t.Fatal("restart after Stop")
	}
	if _, err := http.Get("http://" + addr + "/healthz"); err == nil {
		t.Fatal("still listening after Stop")
	}
}

func TestWithTrading(t *testing.T) {
	a, err := New(Config{DBPath: filepath.Join(t.TempDir(), "t.db")})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.Start(); err != nil {
		t.Fatal(err)
	}
	if err := a.Stop(3 * time.Second); err != nil {
		t.Fatal(err)
	}
}

func TestNeedsDB(t *testing.T) {
	if _, err := New(Config{}); err == nil {
		t.Fatal("empty config accepted")
	}
}

func TestUnofficialSourcesGatedByDefault(t *testing.T) {
	t.Setenv("TITAN_UNOFFICIAL_SOURCES", "")
	a, err := New(Config{DBPath: filepath.Join(t.TempDir(), "gate.db"), NoTrading: true})
	if err != nil {
		t.Fatal(err)
	}
	addr, err := a.Start()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = a.Stop(3 * time.Second) }()

	resp, err := http.Get("http://" + addr + "/api/history?symbol=THYAO.IS&interval=15m")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden || !strings.Contains(string(body), "unofficial_sources_disabled") {
		t.Fatalf("expected 403 unofficial_sources_disabled, got %d: %s", resp.StatusCode, string(body))
	}
}
