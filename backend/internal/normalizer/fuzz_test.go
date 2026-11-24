package normalizer

import (
	"math"
	"testing"

	"github.com/ersincebi/titanview/backend/internal/domain"
)

// Parsers eat untrusted upstream bytes: they may return an error but must never panic,
// and every candle they do return must already be valid.
func assertValid(t *testing.T, cs []domain.Candle) {
	t.Helper()
	for _, c := range cs {
		if c.Timestamp <= 0 || c.Open <= 0 || c.High < c.Low || c.High < c.Open || c.High < c.Close ||
			c.Low > c.Open || c.Low > c.Close || math.IsNaN(c.Close) || math.IsInf(c.Close, 0) || c.Volume < 0 {
			t.Fatalf("invalid candle escaped parser: %+v", c)
		}
	}
}

func FuzzNormalizeBinanceKlines(f *testing.F) {
	f.Add([]byte(`[[1700000000000,"1","2","0.5","1.5","10",1700000059999,"0",1,"0","0","0"]]`))
	f.Add([]byte(`[]`))
	f.Add([]byte(`[[1,2,3]]`))
	f.Add([]byte(`{"code":-1121}`))
	f.Fuzz(func(t *testing.T, b []byte) {
		cs, err := NormalizeBinanceKlines("BTCUSDT", "1h", b)
		if err == nil {
			assertValid(t, cs)
		}
	})
}

func FuzzNormalizeYahooChart(f *testing.F) {
	f.Add([]byte(`{"chart":{"result":[{"timestamp":[1700000000],"indicators":{"quote":[{"open":[1],"high":[2],"low":[0.5],"close":[1.5],"volume":[3]}]}}]}}`))
	f.Add([]byte(`{"chart":{"result":null,"error":{"code":"Not Found"}}}`))
	f.Add([]byte(`{"chart":{"result":[{"timestamp":[1,2],"indicators":{"quote":[{"open":[null,1]}]}}]}}`))
	f.Fuzz(func(t *testing.T, b []byte) {
		cs, err := NormalizeYahooChart("AAPL", "1d", b)
		if err == nil {
			assertValid(t, cs)
		}
	})
}

func FuzzNormalizeBinanceWSKline(f *testing.F) {
	f.Add([]byte(`{"e":"kline","s":"BTCUSDT","k":{"t":1700000000000,"i":"1m","o":"1","h":"2","l":"0.5","c":"1.5","v":"3","x":true}}`))
	f.Add([]byte(`{}`))
	f.Fuzz(func(t *testing.T, b []byte) {
		c, ok, err := NormalizeBinanceWSKline(b)
		if err == nil && ok {
			assertValid(t, []domain.Candle{c})
		}
	})
}

// Resampling must preserve totals and the OHLC envelope, and never emit a bucket it cannot fill.
func FuzzResampleInvariants(f *testing.F) {
	f.Add(int64(3600), int64(14400), uint8(12), 100.0)
	f.Fuzz(func(t *testing.T, step, bucket int64, n uint8, base float64) {
		if step <= 0 || step > 86400 || bucket < step || bucket > 7*86400 || base <= 0 || base > 1e9 || math.IsNaN(base) {
			t.Skip()
		}
		var cs []domain.Candle
		var vol float64
		for i := 0; i < int(n); i++ {
			p := base + float64(i%7)
			cs = append(cs, domain.Candle{Symbol: "X", Timeframe: "1h", Timestamp: 1_700_000_000 + int64(i)*step,
				Open: p, High: p + 1, Low: p - 0.5, Close: p + 0.25, Volume: 2})
			vol += 2
		}
		out := ResampleCandles(cs, "X", "4h", bucket)
		var ov float64
		for i, o := range out {
			ov += o.Volume
			if o.High < o.Low {
				t.Fatalf("bucket %d High<Low: %+v", i, o)
			}
			if i > 0 && o.Timestamp <= out[i-1].Timestamp {
				t.Fatalf("buckets not strictly ascending")
			}
		}
		if len(cs) > 0 && math.Abs(ov-vol) > 1e-6 {
			t.Fatalf("volume not conserved: in=%v out=%v", vol, ov)
		}
	})
}
