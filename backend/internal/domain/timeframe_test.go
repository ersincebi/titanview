package domain

import "testing"

func TestNormalizeTimeframeAndSeconds(t *testing.T) {
	cases := []struct {
		in   string
		want string
		sec  int64
	}{
		{"1s", "1s", 1}, {"5s", "5s", 5}, {"15sec", "15s", 15}, {"59s", "59s", 59}, {"60s", "1m", 60},
		{"1m", "1m", 60}, {"1MIN", "1m", 60}, {"3min", "3m", 180}, {" 5m ", "5m", 300},
		{"15min", "15m", 900}, {"30m", "30m", 1800}, {"45m", "45m", 2700},
		{"60m", "1h", 3600}, {"1H", "1h", 3600}, {"2h", "2h", 7200}, {"3h", "3h", 10800},
		{"240m", "4h", 14400}, {"6h", "6h", 21600}, {"8h", "8h", 28800}, {"12h", "12h", 43200}, {"24h", "1d", 86400},
		{"daily", "1d", 86400}, {"D", "1d", 86400}, {"2D", "2d", 172800}, {"3d", "3d", 259200},
		{"weekly", "1w", 604800}, {"1wk", "1w", 604800}, {"2w", "2w", 1209600},
		// Month (uppercase M) must NEVER collide with minute (lowercase m).
		{"1M", "1M", 30 * 86400}, {"M", "1M", 30 * 86400}, {"1mo", "1M", 30 * 86400}, {"monthly", "1M", 30 * 86400},
		{"3M", "3M", 90 * 86400}, {"6M", "6M", 180 * 86400}, {"12M", "12M", 360 * 86400}, {"1y", "12M", 360 * 86400},
		{"garbage", "15m", 900}, {"", "15m", 900}, {"0s", "15m", 900}, {"13M", "15m", 900},
	}
	for _, c := range cases {
		if got := NormalizeTimeframe(c.in); got != c.want {
			t.Errorf("NormalizeTimeframe(%q)=%q want %q", c.in, got, c.want)
		}
		if got := TimeframeSeconds(c.in); got != c.sec {
			t.Errorf("TimeframeSeconds(%q)=%d want %d", c.in, got, c.sec)
		}
	}
}

func TestDefaultHistoryLookbackMonotonic(t *testing.T) {
	order := []string{"1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"}
	var prev int64
	for _, tf := range order {
		got := DefaultHistoryLookbackSeconds(tf)
		if got <= 0 {
			t.Fatalf("%s lookback %d must be positive", tf, got)
		}
		if got < prev {
			t.Errorf("%s lookback %d shrank below previous %d", tf, got, prev)
		}
		// a lookback must hold at least 100 candles so the chart is never empty
		if got/TimeframeSeconds(tf) < 100 {
			t.Errorf("%s lookback holds only %d candles", tf, got/TimeframeSeconds(tf))
		}
		prev = got
	}
}

func FuzzValidateAndRepairCandle(f *testing.F) {
	f.Add(int64(1), 1.0, 2.0, 0.5, 1.5, 3.0)
	f.Add(int64(-1), 0.0, 0.0, 0.0, 0.0, -1.0)
	f.Fuzz(func(t *testing.T, ts int64, o, h, l, c, v float64) {
		cd := Candle{Timestamp: ts, Open: o, High: h, Low: l, Close: c, Volume: v}
		if err := ValidateAndRepairCandle(&cd); err != nil {
			return
		}
		if cd.High < cd.Open || cd.High < cd.Close || cd.Low > cd.Open || cd.Low > cd.Close || cd.Volume < 0 {
			t.Fatalf("repair left inconsistent candle: %+v", cd)
		}
	})
}
