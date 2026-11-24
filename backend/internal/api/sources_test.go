package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ersincebi/titanview/backend/internal/domain"
	"github.com/ersincebi/titanview/backend/internal/hub"
	"github.com/ersincebi/titanview/backend/internal/provider"
	"github.com/ersincebi/titanview/backend/internal/sources"
	"github.com/ersincebi/titanview/backend/internal/storage"
)

type disabledYahooStub struct{}

func (disabledYahooStub) FetchHistory(_ context.Context, _, _ string, _, _ int64) ([]domain.Candle, error) {
	return nil, sources.ErrUnofficialDisabled
}

func (disabledYahooStub) FetchNews(_ context.Context, _ string, _ int) ([]provider.NewsItem, error) {
	return nil, sources.ErrUnofficialDisabled
}

func (disabledYahooStub) FetchFundamentals(_ context.Context, _ string) (provider.FundamentalsReport, error) {
	return provider.FundamentalsReport{}, sources.ErrUnofficialDisabled
}

func (disabledYahooStub) FetchCorporateEvents(_ context.Context, _ string, _, _ int64) (provider.CorporateEvents, error) {
	return provider.CorporateEvents{}, sources.ErrUnofficialDisabled
}

func TestHandleSourcesLifecycle(t *testing.T) {
	defer sources.SetForTest(false)()
	t.Setenv(sources.EnvVar, "")

	st, err := storage.NewSQLiteStore(filepath.Join(t.TempDir(), "src.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := sources.Init(context.Background(), st, nil); err != nil {
		t.Fatal(err)
	}

	coord := provider.NewCacheCoordinator(st, nil, disabledYahooStub{})
	srv := NewServer(coord, hub.NewLiveHub(coord, 0), "")
	h := srv.Routes()

	// 1. Default GET reports disabled.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/sources", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/sources = %d: %s", rec.Code, rec.Body.String())
	}
	var got sources.Status
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Unofficial || len(got.Hosts) != 3 {
		t.Fatalf("unexpected initial status: %+v", got)
	}

	// 2. Enabling without acceptTerms must fail with 400.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/api/sources", strings.NewReader(`{"unofficial":true,"acceptTerms":false}`)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 without acceptTerms, got %d: %s", rec.Code, rec.Body.String())
	}
	if sources.Enabled() {
		t.Fatalf("gate must remain disabled")
	}

	// 3. Disabled unofficial endpoints return 403 with structured code.
	for _, path := range []string{
		"/api/history?symbol=THYAO.IS&interval=15m",
		"/api/news?symbol=THYAO.IS",
		"/api/fundamentals?symbol=THYAO.IS",
		"/api/events?symbol=THYAO.IS",
	} {
		rec = httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusForbidden {
			t.Fatalf("GET %s expected 403 while disabled, got %d: %s", path, rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), `"unofficial_sources_disabled"`) {
			t.Fatalf("GET %s missing error code: %s", path, rec.Body.String())
		}
	}

	// 4. Enabling with acceptTerms=true persists to SQLite and flips gate ON.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/api/sources", strings.NewReader(`{"unofficial":true,"acceptTerms":true}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT enable = %d: %s", rec.Code, rec.Body.String())
	}
	if !sources.Enabled() || sources.AcceptedAt() == 0 {
		t.Fatalf("expected enabled with acceptedAt, got %+v", sources.Current())
	}

	// Reload from store simulates restart: remains enabled.
	sources.Set(false, 0)
	if err := sources.Init(context.Background(), st, nil); err != nil {
		t.Fatal(err)
	}
	if !sources.Enabled() {
		t.Fatalf("expected persisted enabled state after Init")
	}

	// 5. Disabling works without acceptTerms.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/api/sources", strings.NewReader(`{"unofficial":false}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT disable = %d: %s", rec.Code, rec.Body.String())
	}
	if sources.Enabled() {
		t.Fatalf("expected gate disabled")
	}

	// 6. When env override is active, PUT returns 409 Conflict.
	t.Setenv(sources.EnvVar, "0")
	if err := sources.Init(context.Background(), st, nil); err != nil {
		t.Fatal(err)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/api/sources", strings.NewReader(`{"unofficial":true,"acceptTerms":true}`)))
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409 under env override, got %d: %s", rec.Code, rec.Body.String())
	}
}
