// Package sources enforces an opt-in gate for unofficial / undocumented third-party
// data endpoints (Yahoo Finance, Google News, İş Yatırım). Official public APIs
// (Binance, Deribit, central-bank/statistical calendars, ntfy, Telegram) remain
// enabled by default.
package sources

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
)

const (
	// SettingKey is stored in SQLite app_settings as JSON {"enabled":bool,"acceptedAt":int64}.
	// The dot keeps it outside the generic /api/settings keyspace so callers must go through /api/sources.
	SettingKey = "sources.unofficial"
	// EnvVar overrides the persisted setting when set to a boolean value (1/0, true/false).
	EnvVar = "TITAN_UNOFFICIAL_SOURCES"
)

// ErrUnofficialDisabled is returned whenever an outbound HTTP call targets an
// unofficial host while the user has not opted in.
var ErrUnofficialDisabled = errors.New("unofficial data sources (Yahoo Finance, Google News, İş Yatırım) are disabled — enable them in Settings → Data sources")

// UnofficialHosts lists the base host suffixes gated behind explicit user opt-in.
var UnofficialHosts = []string{
	"yahoo.com",
	"news.google.com",
	"isyatirim.com.tr",
}

// Status describes the current unofficial-sources opt-in state.
type Status struct {
	Unofficial  bool     `json:"unofficial"`
	AcceptedAt  int64    `json:"acceptedAt"`
	EnvOverride *bool    `json:"envOverride,omitempty"`
	Hosts       []string `json:"hosts"`
}

// SettingReader is the minimal SQLiteStore slice needed to load persisted state.
type SettingReader interface {
	GetSetting(ctx context.Context, key string) (value string, updatedAt int64, ok bool, err error)
}

type persistedState struct {
	Enabled    bool  `json:"enabled"`
	AcceptedAt int64 `json:"acceptedAt"`
}

var (
	stateMu     sync.RWMutex
	enabled     bool
	acceptedAt  int64
	envOverride *bool

	installMu sync.Mutex
	installed bool
)

// IsUnofficialHost reports whether host (with optional :port) belongs to an
// unofficial third-party data endpoint that requires user opt-in.
func IsUnofficialHost(host string) bool {
	h := strings.TrimSpace(host)
	if h == "" {
		return false
	}
	if stripped, _, err := net.SplitHostPort(h); err == nil {
		h = stripped
	}
	h = strings.ToLower(strings.TrimSuffix(h, "."))
	if h == "" || h == "localhost" || h == "127.0.0.1" || h == "::1" {
		return false
	}
	for _, base := range UnofficialHosts {
		if h == base || strings.HasSuffix(h, "."+base) {
			return true
		}
	}
	return false
}

// Enabled reports whether unofficial data sources are currently allowed.
func Enabled() bool {
	stateMu.RLock()
	defer stateMu.RUnlock()
	return enabled
}

// AcceptedAt returns the Unix timestamp (seconds) when terms were accepted, or 0.
func AcceptedAt() int64 {
	stateMu.RLock()
	defer stateMu.RUnlock()
	return acceptedAt
}

// Current returns a snapshot of the gate state suitable for API responses.
func Current() Status {
	stateMu.RLock()
	defer stateMu.RUnlock()
	hosts := make([]string, len(UnofficialHosts))
	copy(hosts, UnofficialHosts)
	var ov *bool
	if envOverride != nil {
		v := *envOverride
		ov = &v
	}
	return Status{
		Unofficial:  enabled,
		AcceptedAt:  acceptedAt,
		EnvOverride: ov,
		Hosts:       hosts,
	}
}

// Set updates the in-memory gate state (does not touch envOverride).
func Set(on bool, acceptedUnix int64) {
	stateMu.Lock()
	defer stateMu.Unlock()
	enabled = on
	if on {
		acceptedAt = acceptedUnix
	} else {
		acceptedAt = 0
	}
}

// SetForTest replaces the full gate state (including clearing envOverride) and
// returns a restore function. Intended for unit tests.
func SetForTest(on bool) func() {
	stateMu.Lock()
	prevOn, prevAt, prevOv := enabled, acceptedAt, envOverride
	enabled = on
	if on {
		acceptedAt = 1
	} else {
		acceptedAt = 0
	}
	envOverride = nil
	stateMu.Unlock()
	return func() {
		stateMu.Lock()
		enabled, acceptedAt, envOverride = prevOn, prevAt, prevOv
		stateMu.Unlock()
	}
}

// ParseEnv reads TITAN_UNOFFICIAL_SOURCES. It returns (val, true) when set to a
// valid boolean string ("1", "0", "true", "false", "yes", "no", "on", "off").
func ParseEnv() (bool, bool) {
	raw := strings.TrimSpace(os.Getenv(EnvVar))
	if raw == "" {
		return false, false
	}
	switch strings.ToLower(raw) {
	case "1", "true", "yes", "on":
		return true, true
	case "0", "false", "no", "off":
		return false, true
	default:
		if b, err := strconv.ParseBool(raw); err == nil {
			return b, true
		}
		return false, false
	}
}

// EncodeSetting marshals the persisted setting value for SQLite.
func EncodeSetting(on bool, acceptedUnix int64) string {
	if !on {
		acceptedUnix = 0
	}
	b, _ := json.Marshal(persistedState{Enabled: on, AcceptedAt: acceptedUnix})
	return string(b)
}

// Init loads the persisted opt-in state from store (defaulting to disabled) and
// applies TITAN_UNOFFICIAL_SOURCES or an explicit CLI override if provided.
func Init(ctx context.Context, store SettingReader, cliOverride *bool) error {
	var on bool
	var at int64
	if store != nil {
		raw, updatedAt, ok, err := store.GetSetting(ctx, SettingKey)
		if err != nil {
			return err
		}
		if ok && strings.TrimSpace(raw) != "" {
			var ps persistedState
			if err := json.Unmarshal([]byte(raw), &ps); err == nil {
				on = ps.Enabled
				at = ps.AcceptedAt
				if on && at == 0 {
					at = updatedAt
				}
			} else if raw == "1" || raw == "true" {
				on = true
				at = updatedAt
			}
		}
	}

	var ov *bool
	if envVal, ok := ParseEnv(); ok {
		v := envVal
		ov = &v
		on = envVal
	}
	if cliOverride != nil {
		v := *cliOverride
		ov = &v
		on = v
	}

	stateMu.Lock()
	enabled = on
	if on {
		acceptedAt = at
	} else {
		acceptedAt = 0
	}
	envOverride = ov
	stateMu.Unlock()
	return nil
}

type gatedTransport struct {
	base http.RoundTripper
}

func (g *gatedTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req != nil && req.URL != nil && IsUnofficialHost(req.URL.Hostname()) && !Enabled() {
		return nil, fmt.Errorf("%w (host: %s)", ErrUnofficialDisabled, req.URL.Hostname())
	}
	return g.base.RoundTrip(req)
}

// WrapTransport returns an http.RoundTripper that blocks requests to unofficial
// hosts while the opt-in gate is disabled. Double-wrapping is a no-op.
func WrapTransport(base http.RoundTripper) http.RoundTripper {
	if base == nil {
		base = http.DefaultTransport
	}
	if _, already := base.(*gatedTransport); already {
		return base
	}
	return &gatedTransport{base: base}
}

// InstallDefaultTransport wraps http.DefaultTransport once at process startup so
// every http.Client using the default transport enforces the opt-in gate.
func InstallDefaultTransport() {
	installMu.Lock()
	defer installMu.Unlock()
	if installed {
		return
	}
	http.DefaultTransport = WrapTransport(http.DefaultTransport)
	installed = true
}
