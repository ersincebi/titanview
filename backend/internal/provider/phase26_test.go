package provider

import (
	"bytes"
	"context"
	"io"
	"math"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ersincebi/titanview/backend/internal/storage"
)

func TestParseYahooTimeseriesAndQuoteSummary(t *testing.T) {
	tsJSON := []byte(`{
		"timeseries": {
			"result": [
				{
					"meta": {"symbol": ["AAPL"], "type": ["annualTotalRevenue"]},
					"annualTotalRevenue": [
						{"asOfDate": "2024-09-30", "reportedValue": {"raw": 391035000000}},
						{"asOfDate": "2023-09-30", "reportedValue": {"raw": 383285000000}}
					]
				},
				{
					"meta": {"symbol": ["AAPL"], "type": ["annualNetIncome"]},
					"annualNetIncome": [
						{"asOfDate": "2024-09-30", "reportedValue": {"raw": 93736000000}},
						{"asOfDate": "2023-09-30", "reportedValue": {"raw": 96995000000}}
					]
				},
				{
					"meta": {"symbol": ["AAPL"], "type": ["quarterlyTotalRevenue"]},
					"quarterlyTotalRevenue": [
						{"asOfDate": "2024-09-30", "reportedValue": {"raw": 94930000000}}
					]
				}
			]
		}
	}`)
	ann, qtr, err := ParseYahooTimeseries(tsJSON)
	if err != nil {
		t.Fatalf("ParseYahooTimeseries error: %v", err)
	}
	if len(ann) != 2 || ann[0].Period != "2024" || ann[0].TotalRevenue == nil || *ann[0].TotalRevenue != 391035000000 {
		t.Fatalf("unexpected annual rows: %+v", ann)
	}
	if len(qtr) != 1 || qtr[0].Period != "2024-Q3" {
		t.Fatalf("unexpected quarterly rows: %+v", qtr)
	}

	qsJSON := []byte(`{
		"quoteSummary": {
			"result": [{
				"summaryDetail": {
					"marketCap": {"raw": 3400000000000},
					"trailingPE": {"raw": 35.4},
					"dividendYield": {"raw": 0.0045}
				},
				"defaultKeyStatistics": {
					"priceToBook": {"raw": 48.2},
					"enterpriseToEbitda": {"raw": 26.1}
				},
				"financialData": {
					"returnOnEquity": {"raw": 1.45},
					"profitMargins": {"raw": 0.24},
					"currentRatio": {"raw": 0.98}
				},
				"calendarEvents": {
					"exDividendDate": {"raw": 1731024000},
					"earnings": {
						"earningsDate": [{"raw": 1738195200}],
						"earningsAverage": {"raw": 2.35}
					}
				},
				"earningsHistory": {
					"history": [
						{"quarter": {"raw": 1727654400}, "epsActual": {"raw": 1.64}, "epsEstimate": {"raw": 1.60}}
					]
				}
			}]
		}
	}`)
	ratios, _, _, earn, nextEarn, exDiv, err := ParseYahooQuoteSummary(qsJSON)
	if err != nil {
		t.Fatalf("ParseYahooQuoteSummary error: %v", err)
	}
	if ratios.MarketCap == nil || *ratios.MarketCap != 3400000000000 || ratios.TrailingPE == nil || *ratios.TrailingPE != 35.4 {
		t.Fatalf("unexpected ratios: %+v", ratios)
	}
	if ratios.ROEPct == nil || math.Abs(*ratios.ROEPct-145.0) > 1e-4 {
		t.Fatalf("unexpected ROE: %+v", ratios.ROEPct)
	}
	if len(earn) != 2 || nextEarn == nil || *nextEarn != 1738195200 || exDiv == nil || *exDiv != 1731024000 {
		t.Fatalf("unexpected earnings/dates: earn=%+v next=%v exDiv=%v", earn, nextEarn, exDiv)
	}
}

func TestParseIsYatirimMaliTablo(t *testing.T) {
	raw := []byte(`{
		"ok": true,
		"value": [
			{"itemCode": "1A", "value1": "542535251740", "value2": "447533961344", "value3": "", "value4": ""},
			{"itemCode": "1AA", "value1": "106956317387", "value2": "125646164246", "value3": "", "value4": ""},
			{"itemCode": "1BL", "value1": "2482297808574", "value2": "1831976887193", "value3": "", "value4": ""},
			{"itemCode": "2A", "value1": "549576578894", "value2": "444422650688", "value3": "", "value4": ""},
			{"itemCode": "2B", "value1": "799873133479", "value2": "497470693698", "value3": "", "value4": ""},
			{"itemCode": "2N", "value1": "1132848096201", "value2": "890083542807", "value3": "", "value4": ""},
			{"itemCode": "3C", "value1": "1187816196737", "value2": "975710686451", "value3": "", "value4": ""},
			{"itemCode": "3D", "value1": "193387862297", "value2": "187055609218", "value3": "", "value4": ""},
			{"itemCode": "3DF", "value1": "112045864239", "value2": "105228269879", "value3": "", "value4": ""},
			{"itemCode": "3Z", "value1": "146952895515", "value2": "148403104528", "value3": "", "value4": ""},
			{"itemCode": "4B", "value1": "117706027115", "value2": "94643007250", "value3": "", "value4": ""},
			{"itemCode": "4C", "value1": "230997549865", "value2": "177463819365", "value3": "", "value4": ""},
			{"itemCode": "4CB", "value1": "51149075639", "value2": "190556979013", "value3": "", "value4": ""}
		]
	}`)
	periods := [4][2]int{{2025, 12}, {2024, 12}, {2023, 12}, {2022, 12}}
	rows, err := ParseIsYatirimMaliTablo(raw, periods, false)
	if err != nil {
		t.Fatalf("ParseIsYatirimMaliTablo error: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected 2 non-empty period rows, got %d", len(rows))
	}
	if rows[0].Period != "2025" || rows[0].TotalRevenue == nil || *rows[0].TotalRevenue != 1187816196737 {
		t.Fatalf("unexpected row[0]: %+v", rows[0])
	}
	if rows[0].EBITDA == nil || *rows[0].EBITDA != 112045864239+117706027115 {
		t.Fatalf("unexpected row[0] EBITDA: %v", rows[0].EBITDA)
	}
}

func TestParseDeribitBookSummariesAndGreeks(t *testing.T) {
	now := time.Date(2026, 11, 22, 12, 0, 0, 0, time.UTC)
	raw := []byte(`{
		"result": [
			{
				"instrument_name": "BTC-29JAN27-55000-C",
				"underlying_price": 60000,
				"estimated_delivery_price": 60000,
				"mark_price": 0.14,
				"mark_iv": 52.5,
				"bid_price": 0.135,
				"ask_price": 0.145,
				"open_interest": 120,
				"volume": 15,
				"volume_usd": 900000
			},
			{
				"instrument_name": "BTC-29JAN27-55000-P",
				"underlying_price": 60000,
				"estimated_delivery_price": 60000,
				"mark_price": 0.04,
				"mark_iv": 53.0,
				"bid_price": 0.038,
				"ask_price": 0.042,
				"open_interest": 180,
				"volume": 20,
				"volume_usd": 1200000
			},
			{
				"instrument_name": "BTC-29JAN27-60000-C",
				"underlying_price": 60000,
				"estimated_delivery_price": 60000,
				"mark_price": 0.075,
				"mark_iv": 50.0,
				"bid_price": 0.073,
				"ask_price": 0.077,
				"open_interest": 250,
				"volume": 40,
				"volume_usd": 2400000
			},
			{
				"instrument_name": "BTC-29JAN27-60000-P",
				"underlying_price": 60000,
				"estimated_delivery_price": 60000,
				"mark_price": 0.075,
				"mark_iv": 50.0,
				"bid_price": 0.073,
				"ask_price": 0.077,
				"open_interest": 200,
				"volume": 35,
				"volume_usd": 2100000
			}
		]
	}`)
	chain, err := ParseDeribitBookSummaries("BTC", "29JAN27", raw, now)
	if err != nil {
		t.Fatalf("ParseDeribitBookSummaries error: %v", err)
	}
	if !chain.Supported || chain.Underlying != "BTC" || chain.SelectedExpiry != "29JAN27" {
		t.Fatalf("unexpected chain header: %+v", chain)
	}
	if len(chain.Rows) != 2 {
		t.Fatalf("expected 2 strike rows, got %d", len(chain.Rows))
	}
	if chain.Rows[0].Call == nil || !chain.Rows[0].Call.ITM || chain.Rows[0].Call.Delta <= 0.5 {
		t.Fatalf("expected 55000 Call to be ITM with delta > 0.5: %+v", chain.Rows[0].Call)
	}
	if chain.Summary.AtmIV != 50.0 || chain.Summary.MaxPainStrike != 60000 {
		t.Fatalf("unexpected summary stats: %+v", chain.Summary)
	}
}

func TestOfficialEconomicCalendarAndExpressionCoordinator(t *testing.T) {
	cal := OfficialEconomicCalendar(time.Date(2026, 11, 22, 12, 0, 0, 0, time.UTC))
	if len(cal) < 15 {
		t.Fatalf("expected >= 15 official economic events, got %d", len(cal))
	}
	hasTCMB, hasFED, hasBLS := false, false, false
	for _, ev := range cal {
		if ev.Institution == "TCMB" {
			hasTCMB = true
		}
		if ev.Institution == "FED" {
			hasFED = true
		}
		if ev.Institution == "BLS" {
			hasBLS = true
		}
	}
	if !hasTCMB || !hasFED || !hasBLS {
		t.Fatalf("missing official institutions: TCMB=%v FED=%v BLS=%v", hasTCMB, hasFED, hasBLS)
	}

	// Test CacheCoordinator expression & currency conversion
	st, err := storage.NewSQLiteStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	mockClient := &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			path := r.URL.Path
			var body string
			if strings.Contains(path, "THYAO.IS") {
				body = `{"chart":{"result":[{"timestamp":[1700000000,1700086400],"indicators":{"quote":[{"open":[340,340],"high":[357,357],"low":[323,323],"close":[340,340],"volume":[1000,1200]}]}}]}}`
			} else if strings.Contains(path, "USDTRY=X") {
				body = `{"chart":{"result":[{"timestamp":[1700000000,1700086400],"indicators":{"quote":[{"open":[34,34],"high":[34,34],"low":[34,34],"close":[34,34],"volume":[100,100]}]}}]}}`
			} else {
				body = `{"chart":{"result":[]}}`
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(bytes.NewBufferString(body)),
			}, nil
		}),
	}
	yp := NewYahooProvider(mockClient)
	yp.BaseURLs = []string{"https://yahoo.test"}
	coord := NewCacheCoordinator(st, nil, yp)

	// 1. Symbol expression THYAO.IS/USDTRY
	resExpr, err := coord.GetHistory(context.Background(), "THYAO.IS/USDTRY", "1d", 1699900000, 1700100000)
	if err != nil {
		t.Fatalf("expression GetHistory error: %v", err)
	}
	if len(resExpr.Candles) != 2 || math.Abs(resExpr.Candles[0].Close-10.0) > 1e-6 {
		t.Fatalf("unexpected expression candles: %+v", resExpr.Candles)
	}

	// 2. Currency conversion THYAO.IS TRY -> USD
	resConv, err := coord.GetHistoryWithCurrency(context.Background(), "THYAO.IS", "1d", 1699900000, 1700100000, "USD")
	if err != nil {
		t.Fatalf("GetHistoryWithCurrency error: %v", err)
	}
	if resConv.Currency != "USD" || resConv.NativeCurrency != "TRY" || len(resConv.Candles) != 2 || math.Abs(resConv.Candles[0].Close-10.0) > 1e-6 {
		t.Fatalf("unexpected converted result: cur=%s native=%s candles=%+v", resConv.Currency, resConv.NativeCurrency, resConv.Candles)
	}
}
