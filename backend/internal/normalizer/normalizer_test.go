package normalizer

import (
	"testing"

	"github.com/ersincebi/titanview/backend/internal/domain"
)

func TestNormalizeBinanceKlines(t *testing.T) {
	raw := `[
		[1731283200000, "88100.50", "88500.00", "87950.25", "88420.75", "1420.55", 1731284099999, "125000000", 3420, "700.1", "61000000", "0"],
		[1731284100000, "88420.75", "88910.00", "88300.00", "88750.00", "980.10", 1731284999999, "87000000", 2150, "510.0", "45000000", "0"]
	]`

	candles, err := NormalizeBinanceKlines("btcusdt", "15m", []byte(raw))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(candles) != 2 {
		t.Fatalf("expected 2 candles, got %d", len(candles))
	}
	if candles[0].Timestamp != 1731283200 {
		t.Fatalf("expected timestamp in seconds 1731283200, got %d", candles[0].Timestamp)
	}
	if candles[0].Open != 88100.50 || candles[1].Close != 88750.00 {
		t.Fatalf("unexpected candle prices: %+v", candles)
	}
}

func TestNormalizeYahooChartWithNullsAnd4HResample(t *testing.T) {
	raw := `{
		"chart": {
			"result": [{
				"meta": {"currency": "TRY", "symbol": "THYAO.IS", "regularMarketPrice": 294.5, "gmtoffset": 10800},
				"timestamp": [1731283200, 1731286800, 1731290400, 1731297600],
				"indicators": {
					"quote": [{
						"open":   [290.0, null, 292.0, 295.0],
						"high":   [293.0, null, 296.0, 298.0],
						"low":    [289.0, null, 291.0, 293.5],
						"close":  [292.0, null, 294.5, 297.0],
						"volume": [100000, null, 150000, 200000]
					}]
				}
			}],
			"error": null
		}
	}`

	candles15m, err := NormalizeYahooChart("THYAO.IS", "15m", []byte(raw))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// 2nd entry is null and must be filtered out cleanly
	if len(candles15m) != 3 {
		t.Fatalf("expected 3 valid candles after filtering nulls, got %d", len(candles15m))
	}

	// Test 4h resampling (1731283200 and 1731290400 fall in same 4h bucket, 1731297600 starts next 4h bucket)
	candles4h, err := NormalizeYahooChart("THYAO.IS", "4h", []byte(raw))
	if err != nil {
		t.Fatalf("unexpected error in 4h resample: %v", err)
	}
	if len(candles4h) != 2 {
		t.Fatalf("expected 2 resampled 4h candles, got %d", len(candles4h))
	}
	if candles4h[0].Open != 290.0 || candles4h[0].High != 296.0 || candles4h[0].Low != 289.0 || candles4h[0].Close != 294.5 || candles4h[0].Volume != 250000 {
		t.Fatalf("unexpected aggregated 4h candle[0]: %+v", candles4h[0])
	}

	direct4h := Resample1HTo4H(candles15m, "THYAO.IS")
	if len(direct4h) != 2 || direct4h[0].Close != 294.5 {
		t.Fatalf("expected Resample1HTo4H to produce 2 candles, got %+v", direct4h)
	}
}

func TestResampleSessionAlignedBIST(t *testing.T) {
	// 2026-11-10 10:00 TRT (UTC+3) = 07:00 UTC; hourly bars 10:00..17:00 local.
	base := int64(1794294000) // 2026-11-10 07:00:00 UTC
	var hrs []domain.Candle
	for i := int64(0); i < 8; i++ {
		hrs = append(hrs, domain.Candle{Symbol: "THYAO.IS", Timeframe: "1h", Timestamp: base + i*3600, Open: 1, High: 2, Low: 1, Close: 1.5, Volume: 1})
	}
	got := ResampleSessionAligned(hrs, "THYAO.IS", "4h", 3*3600, 10*3600)
	if len(got) != 2 || got[0].Timestamp != base || got[1].Timestamp != base+14400 || got[0].Volume != 4 {
		t.Fatalf("bad buckets: %+v", got)
	}
}

func TestNormalizeYahooDropsOffGridTrailingPoint(t *testing.T) {
	// two real 15m bars + the trailing "last trade" point (off-grid, no volume)
	raw := []byte(`{"chart":{"result":[{"meta":{"gmtoffset":-18000},"timestamp":[1763398800,1763399700,1763400483],
	"indicators":{"quote":[{"open":[10,11,12],"high":[11,12,12],"low":[9,10,12],"close":[11,12,12],"volume":[100,200,null]}]}}]}}`)
	got, err := NormalizeYahooChart("AAPL", "15m", raw)
	if err != nil || len(got) != 2 {
		t.Fatalf("want 2 on-grid bars, got %d err %v", len(got), err)
	}
}

// Real Binance kline payload: "L"/"V"/"Q" must not collide with "l"/"v"/"q" (encoding/json is case-insensitive).
func TestNormalizeBinanceWSKlineRealPayloadCaseCollisions(t *testing.T) {
	m := `{"e":"kline","E":1795344868051,"s":"BTCUSDT","k":{"t":1795344840000,"T":1795344899999,"s":"BTCUSDT","i":"1m","f":100,"L":200,"o":"60800.0","c":"60810.0","h":"60820.0","l":"60790.0","v":"12.5","n":10,"x":true,"q":"760000.1","V":"2.25","Q":"136800.5","B":"0"}}`
	c, closed, err := NormalizeBinanceWSKline([]byte(m))
	if err != nil {
		t.Fatalf("real payload rejected: %v", err)
	}
	if !closed || c.Timestamp != 1795344840 || c.Low != 60790 || c.High != 60820 || c.Close != 60810 || c.Volume != 12.5 || c.Symbol != "BTCUSDT" || c.Timeframe != "1m" {
		t.Fatalf("candle %+v closed=%v", c, closed)
	}
}

func TestCustomIntervalResamplers(t *testing.T) {
	// 5s resampling from 1s bars
	var secBars []domain.Candle
	for i := int64(0); i < 10; i++ {
		secBars = append(secBars, domain.Candle{
			Symbol: "BTCUSDT", Timeframe: "1s", Timestamp: 1700000000 + i,
			Open: 100 + float64(i), High: 102 + float64(i), Low: 99 + float64(i), Close: 101 + float64(i), Volume: 10,
		})
	}
	r5s := ResampleToTimeframe(secBars, "BTCUSDT", "5s")
	if len(r5s) != 2 || r5s[0].Timestamp != 1700000000 || r5s[0].Open != 100 || r5s[0].Close != 105 || r5s[0].Volume != 50 {
		t.Fatalf("unexpected 5s resample: %+v", r5s)
	}

	// 2d resampling from 1d bars
	day0 := int64(1700006400) // aligned to 2d (172800s): 1700006400 % 172800 == 0
	day0 = (day0 / 172800) * 172800
	dayBars := []domain.Candle{
		{Symbol: "AAPL", Timeframe: "1d", Timestamp: day0, Open: 10, High: 12, Low: 9, Close: 11, Volume: 100},
		{Symbol: "AAPL", Timeframe: "1d", Timestamp: day0 + 86400, Open: 11, High: 15, Low: 10, Close: 14, Volume: 200},
		{Symbol: "AAPL", Timeframe: "1d", Timestamp: day0 + 2*86400, Open: 14, High: 16, Low: 13, Close: 15, Volume: 150},
	}
	r2d := ResampleDays(dayBars, "AAPL", "2d", 2)
	if len(r2d) != 2 || r2d[0].High != 15 || r2d[0].Close != 14 || r2d[0].Volume != 300 {
		t.Fatalf("unexpected 2d resample: %+v", r2d)
	}

	// 3M quarterly calendar resampling with Istanbul UTC+3 offset:
	// 2025-01-01 00:00 TRT = 2024-12-31 21:00 UTC (must bucket into 2025 Q1, NOT 2024 Q4!).
	janTRT := int64(1735678800) // 2024-12-31 21:00:00 UTC == 2025-01-01 00:00:00 UTC+3
	febTRT := int64(1738357200) // 2025-01-31 21:00:00 UTC == 2025-02-01 00:00:00 UTC+3
	aprTRT := int64(1743454800) // 2025-03-31 21:00:00 UTC == 2025-04-01 00:00:00 UTC+3
	mBars := []domain.Candle{
		{Symbol: "THYAO.IS", Timeframe: "1M", Timestamp: janTRT, Open: 250, High: 270, Low: 245, Close: 265, Volume: 1000},
		{Symbol: "THYAO.IS", Timeframe: "1M", Timestamp: febTRT, Open: 265, High: 290, Low: 260, Close: 285, Volume: 1500},
		{Symbol: "THYAO.IS", Timeframe: "1M", Timestamp: aprTRT, Open: 285, High: 310, Low: 280, Close: 300, Volume: 2000},
	}
	r3m := ResampleMonths(mBars, "THYAO.IS", "3M", 3, 10800)
	if len(r3m) != 2 || r3m[0].Open != 250 || r3m[0].Close != 285 || r3m[0].Volume != 2500 || r3m[1].Close != 300 {
		t.Fatalf("unexpected 3M TRT resample: %+v", r3m)
	}
	// 2025-01-01 00:00 UTC = 1735689600
	if r3m[0].Timestamp != 1735689600 {
		t.Fatalf("expected Q1 2025 UTC start 1735689600, got %d", r3m[0].Timestamp)
	}

	// Multi-hour BIST 2h session aligned (10:00, 12:00, 14:00, 16:00 TRT)
	base := int64(1794294000) // 2026-11-10 07:00 UTC = 10:00 TRT
	var hrs []domain.Candle
	for i := int64(0); i < 8; i++ {
		hrs = append(hrs, domain.Candle{Symbol: "THYAO.IS", Timeframe: "1h", Timestamp: base + i*3600, Open: 10, High: 12, Low: 9, Close: 11, Volume: 5})
	}
	r2h := ResampleSessionAlignedBlock(hrs, "THYAO.IS", "2h", 10800, 10*3600, 7200)
	if len(r2h) != 4 || r2h[0].Timestamp != base || r2h[1].Timestamp != base+7200 || r2h[0].Volume != 10 {
		t.Fatalf("unexpected 2h session aligned: %+v", r2h)
	}
}
