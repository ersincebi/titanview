package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ersincebi/titanview/backend/internal/domain"
	"github.com/ersincebi/titanview/backend/internal/hub"
	"github.com/ersincebi/titanview/backend/internal/provider"
	"github.com/ersincebi/titanview/backend/internal/storage"
)

type fakeEventsYahoo struct {
	candles map[string][]domain.Candle
	events  map[string]provider.CorporateEvents
}

func (f *fakeEventsYahoo) FetchHistory(_ context.Context, symbol, _ string, _, _ int64) ([]domain.Candle, error) {
	if c, ok := f.candles[domain.NormalizeSymbol(symbol)]; ok {
		return c, nil
	}
	return nil, &provider.UpstreamError{Provider: "YAHOO", Err: context.DeadlineExceeded}
}

func (f *fakeEventsYahoo) FetchCorporateEvents(_ context.Context, symbol string, _, _ int64) (provider.CorporateEvents, error) {
	if ev, ok := f.events[domain.NormalizeSymbol(symbol)]; ok {
		return ev, nil
	}
	return provider.CorporateEvents{Symbol: symbol, Supported: true}, nil
}

func TestHandleEventsAndFx(t *testing.T) {
	store, err := storage.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	defer store.Close()

	actual := 1.46
	est := 1.40
	fy := &fakeEventsYahoo{
		events: map[string]provider.CorporateEvents{
			"AAPL": {
				Symbol:    "AAPL",
				Supported: true,
				Dividends: []provider.DividendEvent{{Time: 1700000000, Amount: 0.24}},
				Splits:    []provider.SplitEvent{{Time: 1598880000, Numerator: 4, Denominator: 1, Ratio: "4:1"}},
				Earnings:  []provider.EarningsEvent{{Time: 1701000000, Actual: &actual, Estimate: &est}},
			},
		},
		candles: map[string][]domain.Candle{
			"EURUSD=X": {
				{Symbol: "EURUSD=X", Timeframe: "1d", Timestamp: 1700000000, Open: 1.08, High: 1.09, Low: 1.07, Close: 1.085, Volume: 1},
				{Symbol: "EURUSD=X", Timeframe: "1d", Timestamp: 1700086400, Open: 1.085, High: 1.10, Low: 1.08, Close: 1.095, Volume: 1},
			},
		},
	}

	coord := provider.NewCacheCoordinator(store, fy, fy)
	liveHub := hub.NewLiveHub(coord, 0)
	srv := NewServer(coord, liveHub, "")
	h := srv.Routes()

	// 1. Equity events (Yahoo)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/events?symbol=AAPL", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var ev provider.CorporateEvents
	if err := json.Unmarshal(rec.Body.Bytes(), &ev); err != nil {
		t.Fatalf("json: %v", err)
	}
	if !ev.Supported || len(ev.Dividends) != 1 || len(ev.Splits) != 1 || len(ev.Earnings) != 1 {
		t.Fatalf("unexpected events payload: %+v", ev)
	}

	// 2. Crypto events -> honest supported=false
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, httptest.NewRequest(http.MethodGet, "/api/events?symbol=BTCUSDT", nil))
	if rec2.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec2.Code)
	}
	var evCrypto provider.CorporateEvents
	_ = json.Unmarshal(rec2.Body.Bytes(), &evCrypto)
	if evCrypto.Supported {
		t.Fatalf("expected crypto events supported=false, got true")
	}

	// 3. Direct FX EUR/USD
	rec3 := httptest.NewRecorder()
	h.ServeHTTP(rec3, httptest.NewRequest(http.MethodGet, "/api/fx?from=EUR&to=USD&fromTs=1699900000&toTs=1700200000", nil))
	if rec3.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec3.Code)
	}
	var fx FxRatesResponse
	_ = json.Unmarshal(rec3.Body.Bytes(), &fx)
	if !fx.Supported || len(fx.Rates) != 2 || fx.Rates[0].Rate != 1.085 {
		t.Fatalf("unexpected direct fx: %+v", fx)
	}

	// 4. Inverse FX USD/EUR -> 1/EURUSD
	rec4 := httptest.NewRecorder()
	h.ServeHTTP(rec4, httptest.NewRequest(http.MethodGet, "/api/fx?from=USD&to=EUR&fromTs=1699900000&toTs=1700200000", nil))
	var fxInv FxRatesResponse
	_ = json.Unmarshal(rec4.Body.Bytes(), &fxInv)
	if !fxInv.Supported || len(fxInv.Rates) != 2 || fxInv.Rates[0].Rate < 0.92 || fxInv.Rates[0].Rate > 0.93 {
		t.Fatalf("unexpected inverse fx: %+v", fxInv)
	}

	// 5. Same currency -> 1.0
	rec5 := httptest.NewRecorder()
	h.ServeHTTP(rec5, httptest.NewRequest(http.MethodGet, "/api/fx?from=USD&to=USD", nil))
	var fxSame FxRatesResponse
	_ = json.Unmarshal(rec5.Body.Bytes(), &fxSame)
	if !fxSame.Supported || len(fxSame.Rates) != 1 || fxSame.Rates[0].Rate != 1.0 {
		t.Fatalf("unexpected same currency fx: %+v", fxSame)
	}

	// 6. Unknown FX -> honest supported=false
	rec6 := httptest.NewRecorder()
	h.ServeHTTP(rec6, httptest.NewRequest(http.MethodGet, "/api/fx?from=ZZZ&to=YYY&fromTs=1699900000&toTs=1700200000", nil))
	var fxNone FxRatesResponse
	_ = json.Unmarshal(rec6.Body.Bytes(), &fxNone)
	if fxNone.Supported {
		t.Fatalf("expected unsupported fx for ZZZ/YYY")
	}
}
