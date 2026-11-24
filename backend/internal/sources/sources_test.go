package sources

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
)

type memReader map[string]string

func (m memReader) GetSetting(_ context.Context, key string) (string, int64, bool, error) {
	v, ok := m[key]
	return v, 1700000000, ok, nil
}

type rtFunc func(*http.Request) (*http.Response, error)

func (f rtFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func okResp() *http.Response {
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader("ok")),
		Header:     make(http.Header),
	}
}

func TestIsUnofficialHost(t *testing.T) {
	unofficial := []string{
		"yahoo.com",
		"query1.finance.yahoo.com",
		"query2.finance.yahoo.com",
		"fc.yahoo.com",
		"QUERY1.FINANCE.YAHOO.COM:443",
		"news.google.com",
		"www.isyatirim.com.tr",
		"isyatirim.com.tr",
		"fc.yahoo.com.",
	}
	for _, h := range unofficial {
		if !IsUnofficialHost(h) {
			t.Errorf("expected %q to be unofficial", h)
		}
	}

	official := []string{
		"",
		"127.0.0.1",
		"127.0.0.1:8080",
		"localhost",
		"::1",
		"api.binance.com",
		"data-api.binance.vision",
		"www.deribit.com",
		"www.tcmb.gov.tr",
		"data.tuik.gov.tr",
		"www.bls.gov",
		"www.federalreserve.gov",
		"www.ecb.europa.eu",
		"www.bea.gov",
		"spk.gov.tr",
		"ntfy.sh",
		"api.telegram.org",
		"notyahoo.com",
		"google.com",
	}
	for _, h := range official {
		if IsUnofficialHost(h) {
			t.Errorf("expected %q to NOT be unofficial", h)
		}
	}
}

func TestWrapTransportGate(t *testing.T) {
	defer SetForTest(false)()

	var hits int
	base := rtFunc(func(r *http.Request) (*http.Response, error) {
		hits++
		return okResp(), nil
	})
	rt := WrapTransport(base)
	// Double wrapping must be idempotent.
	if WrapTransport(rt) != rt {
		t.Fatalf("expected WrapTransport to avoid double wrapping")
	}

	client := &http.Client{Transport: rt}

	// Disabled by default: unofficial hosts must be rejected before hitting base.
	for _, u := range []string{
		"https://query1.finance.yahoo.com/v8/finance/chart/AAPL",
		"https://fc.yahoo.com/",
		"https://news.google.com/rss/search?q=BIST",
		"https://www.isyatirim.com.tr/api/test",
	} {
		resp, err := client.Get(u)
		if resp != nil {
			_ = resp.Body.Close()
		}
		if err == nil || !errors.Is(err, ErrUnofficialDisabled) {
			t.Fatalf("expected ErrUnofficialDisabled for %s, got %v", u, err)
		}
	}
	if hits != 0 {
		t.Fatalf("expected 0 upstream hits while disabled, got %d", hits)
	}

	// Official and loopback hosts must pass through while disabled.
	for _, u := range []string{
		"https://api.binance.com/api/v3/klines",
		"https://www.deribit.com/api/v2/public/get_instruments",
		"http://127.0.0.1:18080/v8/finance/chart/THYAO.IS",
	} {
		resp, err := client.Get(u)
		if err != nil {
			t.Fatalf("expected official/loopback %s to succeed, got %v", u, err)
		}
		_ = resp.Body.Close()
	}
	if hits != 3 {
		t.Fatalf("expected 3 official hits, got %d", hits)
	}

	// Once enabled, unofficial hosts pass through.
	Set(true, 1730000123)
	resp, err := client.Get("https://query1.finance.yahoo.com/v8/finance/chart/AAPL")
	if err != nil {
		t.Fatalf("expected yahoo request to succeed once enabled, got %v", err)
	}
	_ = resp.Body.Close()
	if hits != 4 {
		t.Fatalf("expected 4 hits total, got %d", hits)
	}
}

func TestInitPersistenceAndOverrides(t *testing.T) {
	defer SetForTest(false)()
	t.Setenv(EnvVar, "")

	// Empty store -> disabled.
	if err := Init(context.Background(), memReader{}, nil); err != nil {
		t.Fatal(err)
	}
	st := Current()
	if st.Unofficial || st.AcceptedAt != 0 || st.EnvOverride != nil {
		t.Fatalf("expected disabled default, got %+v", st)
	}

	// Store has enabled=true.
	store := memReader{SettingKey: EncodeSetting(true, 1731234567)}
	if err := Init(context.Background(), store, nil); err != nil {
		t.Fatal(err)
	}
	st = Current()
	if !st.Unofficial || st.AcceptedAt != 1731234567 || st.EnvOverride != nil {
		t.Fatalf("expected restored enabled state, got %+v", st)
	}

	// Env var overrides store to false.
	t.Setenv(EnvVar, "0")
	if err := Init(context.Background(), store, nil); err != nil {
		t.Fatal(err)
	}
	st = Current()
	if st.Unofficial || st.EnvOverride == nil || *st.EnvOverride {
		t.Fatalf("expected env override false, got %+v", st)
	}

	// CLI override wins over env.
	tr := true
	if err := Init(context.Background(), store, &tr); err != nil {
		t.Fatal(err)
	}
	st = Current()
	if !st.Unofficial || st.EnvOverride == nil || !*st.EnvOverride {
		t.Fatalf("expected cli override true, got %+v", st)
	}
}

func TestGateConcurrency(t *testing.T) {
	defer SetForTest(false)()
	rt := WrapTransport(rtFunc(func(*http.Request) (*http.Response, error) { return okResp(), nil }))
	client := &http.Client{Transport: rt}

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(2)
		go func(n int) {
			defer wg.Done()
			for j := 0; j < 20; j++ {
				Set((n+j)%2 == 0, int64(j+1))
				_ = Current()
			}
		}(i)
		go func() {
			defer wg.Done()
			for j := 0; j < 20; j++ {
				resp, err := client.Get("https://query1.finance.yahoo.com/test")
				if resp != nil {
					_ = resp.Body.Close()
				}
				if err != nil && !errors.Is(err, ErrUnofficialDisabled) {
					t.Errorf("unexpected error: %v", err)
				}
			}
		}()
	}
	wg.Wait()
}
