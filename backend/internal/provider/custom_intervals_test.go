package provider

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBinanceBaseIntervalAndResampling(t *testing.T) {
	cases := []struct {
		tf       string
		wantBase string
		resample bool
	}{
		{"1s", "1s", false},
		{"5s", "1s", true},
		{"30s", "1s", true},
		{"2h", "2h", false},
		{"3h", "1h", true},
		{"6h", "6h", false},
		{"8h", "8h", false},
		{"12h", "12h", false},
		{"2d", "1d", true},
		{"3d", "3d", false},
		{"1M", "1M", false},
		{"3M", "1M", true},
		{"6M", "1M", true},
		{"12M", "1M", true},
	}
	for _, c := range cases {
		base, res := BinanceBaseInterval(c.tf)
		if base != c.wantBase || res != c.resample {
			t.Errorf("BinanceBaseInterval(%q)=(%q,%v) want (%q,%v)", c.tf, base, res, c.wantBase, c.resample)
		}
	}

	// Verify 5s FetchHistory hits Binance with interval=1s and resamples to 5s.
	var gotInterval string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotInterval = r.URL.Query().Get("interval")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[
			[1730000000000, "100", "105", "99", "102", "1.0", 1730000000999],
			[1730000001000, "102", "108", "101", "107", "2.0", 1730000001999],
			[1730000005000, "107", "110", "106", "109", "3.0", 1730000005999]
		]`))
	}))
	defer srv.Close()

	bp := NewBinanceProvider(srv.Client())
	bp.BaseURLs = []string{srv.URL}
	bars, err := bp.FetchHistory(context.Background(), "BTCUSDT", "5s", 1730000000, 1730000010)
	if err != nil {
		t.Fatalf("FetchHistory 5s failed: %v", err)
	}
	if gotInterval != "1s" {
		t.Fatalf("expected base interval=1s, got %q", gotInterval)
	}
	if len(bars) != 2 || bars[0].Timeframe != "5s" || bars[0].High != 108 || bars[0].Volume != 3.0 || bars[1].Close != 109 {
		t.Fatalf("unexpected resampled 5s bars: %+v", bars)
	}
}

func TestYahooCustomIntervalsAndSecondsRejection(t *testing.T) {
	yp := NewYahooProvider(nil)
	_, err := yp.FetchHistory(context.Background(), "THYAO.IS", "10s", 1730000000, 1730001000)
	var unsup *UnsupportedIntervalError
	if !errors.As(err, &unsup) {
		t.Fatalf("expected UnsupportedIntervalError for Yahoo 10s, got %v", err)
	}

	// Verify 3M queries Yahoo with interval=1mo and resamples quarterly.
	var gotInterval string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotInterval = r.URL.Query().Get("interval")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"chart":{"result":[{"meta":{"gmtoffset":0},"timestamp":[1735689600,1738368000,1743465600],"indicators":{"quote":[{"open":[10,12,15],"high":[13,16,18],"low":[9,11,14],"close":[12,15,17],"volume":[100,200,300]}]}}]}}`))
	}))
	defer srv.Close()

	yp = NewYahooProvider(srv.Client())
	yp.BaseURLs = []string{srv.URL}
	bars, err := yp.FetchHistory(context.Background(), "AAPL", "3M", 1735689600, 1750000000)
	if err != nil {
		t.Fatalf("FetchHistory 3M failed: %v", err)
	}
	if gotInterval != "1mo" {
		t.Fatalf("expected Yahoo base interval=1mo, got %q", gotInterval)
	}
	if len(bars) != 2 || bars[0].Timeframe != "3M" || bars[0].Open != 10 || bars[0].Close != 15 || bars[0].Volume != 300 {
		t.Fatalf("unexpected Yahoo 3M bars: %+v", bars)
	}
}
