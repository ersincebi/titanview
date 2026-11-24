package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/ersincebi/titanview/backend/internal/domain"
	"github.com/ersincebi/titanview/backend/internal/hub"
	"github.com/ersincebi/titanview/backend/internal/provider"
	"github.com/ersincebi/titanview/backend/internal/storage"
)

type roundTripFunc26 func(*http.Request) (*http.Response, error)

func (f roundTripFunc26) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type fakePhase26Yahoo struct {
	fakeEventsYahoo
	fundamentals map[string]provider.FundamentalsReport
}

func (f *fakePhase26Yahoo) FetchFundamentals(_ context.Context, symbol string) (provider.FundamentalsReport, error) {
	if rep, ok := f.fundamentals[domain.NormalizeSymbol(symbol)]; ok {
		return rep, nil
	}
	return provider.FundamentalsReport{Symbol: symbol, Supported: false, Reason: "no mock data"}, nil
}

func TestPhase26Endpoints(t *testing.T) {
	store, err := storage.NewSQLiteStore(filepath.Join(t.TempDir(), "p26.db"))
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	defer store.Close()

	rev := 1187816196737.0
	netInc := 146952895515.0
	pe := 4.2
	actEps := 12.5
	estEps := 11.0

	fy := &fakePhase26Yahoo{
		fakeEventsYahoo: fakeEventsYahoo{
			candles: map[string][]domain.Candle{
				"THYAO.IS": {
					{Symbol: "THYAO.IS", Timeframe: "1d", Timestamp: 1700000000, Open: 340, High: 357, Low: 323, Close: 340, Volume: 1000},
				},
				"GARAN.IS": {
					{Symbol: "GARAN.IS", Timeframe: "1d", Timestamp: 1700000000, Open: 100, High: 110, Low: 90, Close: 100, Volume: 800},
				},
				"USDTRY=X": {
					{Symbol: "USDTRY=X", Timeframe: "1d", Timestamp: 1700000000, Open: 34, High: 34, Low: 34, Close: 34, Volume: 10},
				},
			},
			events: map[string]provider.CorporateEvents{
				"THYAO.IS": {
					Symbol:    "THYAO.IS",
					Supported: true,
					Dividends: []provider.DividendEvent{{Time: 1700000000, Amount: 6.85}},
					Earnings:  []provider.EarningsEvent{{Time: 1701000000, Actual: &actEps, Estimate: &estEps}},
				},
			},
		},
		fundamentals: map[string]provider.FundamentalsReport{
			"THYAO.IS": {
				Symbol:      "THYAO.IS",
				DisplayName: "Türk Hava Yolları A.O.",
				Market:      "BIST",
				Currency:    "TRY",
				Supported:   true,
				Source:      "KAP / İş Yatırım + Yahoo Finance",
				Ratios:      provider.FinancialRatios{TrailingPE: &pe},
				Annual: []provider.FinancialPeriodRow{
					{Period: "2025", Date: "2025-12-31", TotalRevenue: &rev, NetIncome: &netInc},
				},
			},
		},
	}

	coord := provider.NewCacheCoordinator(store, fy, fy)
	liveHub := hub.NewLiveHub(coord, 0)
	srv := NewServer(coord, liveHub, "")
	srv.Deribit = provider.NewDeribitProvider(&http.Client{
		Transport: roundTripFunc26(func(r *http.Request) (*http.Response, error) {
			body := `{
				"result": [
					{
						"instrument_name": "BTC-29JAN27-60000-C",
						"underlying_price": 60000,
						"estimated_delivery_price": 60000,
						"mark_price": 0.08,
						"mark_iv": 52.0,
						"bid_price": 0.078,
						"ask_price": 0.082,
						"open_interest": 100,
						"volume": 10,
						"volume_usd": 600000
					}
				]
			}`
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(bytes.NewBufferString(body)),
			}, nil
		}),
	})
	h := srv.Routes()

	// 1. Symbol expression via /api/history
	recExpr := httptest.NewRecorder()
	h.ServeHTTP(recExpr, httptest.NewRequest(http.MethodGet, "/api/history?symbol=0.5*THYAO.IS%2B0.5*GARAN.IS&interval=1d&from=1699900000&to=1700100000", nil))
	if recExpr.Code != http.StatusOK {
		t.Fatalf("expected 200 for expression history, got %d: %s", recExpr.Code, recExpr.Body.String())
	}
	var histExpr provider.HistoryResult
	_ = json.Unmarshal(recExpr.Body.Bytes(), &histExpr)
	if len(histExpr.Candles) != 1 || math.Abs(histExpr.Candles[0].Close-220.0) > 1e-6 {
		t.Fatalf("unexpected expression history: %+v", histExpr.Candles)
	}

	// 2. Currency conversion via /api/history?currency=USD
	recCur := httptest.NewRecorder()
	h.ServeHTTP(recCur, httptest.NewRequest(http.MethodGet, "/api/history?symbol=THYAO.IS&interval=1d&from=1699900000&to=1700100000&currency=USD", nil))
	if recCur.Code != http.StatusOK {
		t.Fatalf("expected 200 for currency converted history, got %d", recCur.Code)
	}
	var histCur provider.HistoryResult
	_ = json.Unmarshal(recCur.Body.Bytes(), &histCur)
	if histCur.Currency != "USD" || histCur.NativeCurrency != "TRY" || len(histCur.Candles) != 1 || math.Abs(histCur.Candles[0].Close-10.0) > 1e-6 {
		t.Fatalf("unexpected currency converted history: %+v", histCur)
	}

	// 3. /api/fundamentals (supported equity + unsupported crypto)
	recFund := httptest.NewRecorder()
	h.ServeHTTP(recFund, httptest.NewRequest(http.MethodGet, "/api/fundamentals?symbol=THYAO.IS", nil))
	if recFund.Code != http.StatusOK {
		t.Fatalf("expected 200 for fundamentals, got %d", recFund.Code)
	}
	var rep provider.FundamentalsReport
	_ = json.Unmarshal(recFund.Body.Bytes(), &rep)
	if !rep.Supported || len(rep.Annual) != 1 || rep.Ratios.TrailingPE == nil || *rep.Ratios.TrailingPE != 4.2 {
		t.Fatalf("unexpected fundamentals report: %+v", rep)
	}

	recFundCrypto := httptest.NewRecorder()
	h.ServeHTTP(recFundCrypto, httptest.NewRequest(http.MethodGet, "/api/fundamentals?symbol=BTCUSDT", nil))
	var repCrypto provider.FundamentalsReport
	_ = json.Unmarshal(recFundCrypto.Body.Bytes(), &repCrypto)
	if repCrypto.Supported {
		t.Fatalf("expected BTCUSDT fundamentals supported=false")
	}

	// 4. /api/calendar
	recCal := httptest.NewRecorder()
	h.ServeHTTP(recCal, httptest.NewRequest(http.MethodGet, "/api/calendar?country=TR", nil))
	if recCal.Code != http.StatusOK {
		t.Fatalf("expected 200 for calendar, got %d", recCal.Code)
	}
	var cal provider.CalendarResponse
	_ = json.Unmarshal(recCal.Body.Bytes(), &cal)
	if len(cal.Economic) == 0 || len(cal.Earnings) == 0 || len(cal.Dividends) == 0 || len(cal.IPOSources) == 0 {
		t.Fatalf("unexpected calendar response: econ=%d earn=%d div=%d ipo=%d", len(cal.Economic), len(cal.Earnings), len(cal.Dividends), len(cal.IPOSources))
	}
	for _, e := range cal.Economic {
		if e.Country != "TR" {
			t.Fatalf("expected only TR economic events when country=TR, got %s", e.Country)
		}
	}

	// 5. /api/options (Deribit BTC supported + BIST VİOP honestly unsupported)
	recOpt := httptest.NewRecorder()
	h.ServeHTTP(recOpt, httptest.NewRequest(http.MethodGet, "/api/options?symbol=BTCUSDT", nil))
	if recOpt.Code != http.StatusOK {
		t.Fatalf("expected 200 for BTC options, got %d", recOpt.Code)
	}
	var optChain provider.OptionChainResponse
	_ = json.Unmarshal(recOpt.Body.Bytes(), &optChain)
	if !optChain.Supported || optChain.Provider != "DERIBIT" || len(optChain.Rows) != 1 {
		t.Fatalf("unexpected BTC option chain: %+v", optChain)
	}

	recViop := httptest.NewRecorder()
	h.ServeHTTP(recViop, httptest.NewRequest(http.MethodGet, "/api/options?symbol=THYAO.IS", nil))
	var optViop provider.OptionChainResponse
	_ = json.Unmarshal(recViop.Body.Bytes(), &optViop)
	if optViop.Supported || optViop.Market != "BIST" {
		t.Fatalf("expected THYAO.IS options supported=false market=BIST, got %+v", optViop)
	}
}
