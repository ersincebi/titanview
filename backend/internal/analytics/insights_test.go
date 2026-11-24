package analytics

import (
	"math"
	"testing"

	"github.com/ersincebi/titanview/backend/internal/domain"
)

func dailies(closes []float64, vol func(i int) float64) []domain.Candle {
	out := make([]domain.Candle, len(closes))
	for i, c := range closes {
		v := 1000.0
		if vol != nil {
			v = vol(i)
		}
		out[i] = domain.Candle{Timestamp: 1_600_000_000 + int64(i)*86400, Open: c, High: c * 1.005, Low: c * 0.995, Close: c, Volume: v}
	}
	return out
}

func ramp(n int, start, step float64) []float64 {
	o := make([]float64, n)
	for i := range o {
		o[i] = start + step*float64(i)
	}
	return o
}

func hasSig(in Insights, key string) *Signal {
	for i := range in.Signals {
		if in.Signals[i].Key == key {
			return &in.Signals[i]
		}
	}
	return nil
}

func hasTag(in Insights, t string) bool {
	for _, x := range in.Tags {
		if x == t {
			return true
		}
	}
	return false
}

func TestInsightsTooShort(t *testing.T) {
	if _, ok := ComputeInsights(dailies(ramp(10, 100, 1), nil), nil); ok {
		t.Fatal("expected !ok below MinInsightBars")
	}
}

func TestInsightsUptrendBreakout(t *testing.T) {
	c := dailies(ramp(260, 100, 0.8), func(i int) float64 {
		if i == 259 {
			return 5000
		}
		return 1000
	})
	in, ok := ComputeInsights(c, nil)
	if !ok {
		t.Fatal("ok")
	}
	if in.Score < 40 || in.Bias != "Güçlü yükseliş eğilimi" {
		t.Fatalf("want strong up, got %d %s", in.Score, in.Bias)
	}
	if s := hasSig(in, "trend"); s == nil || s.Tone != "bull" {
		t.Fatalf("trend signal: %+v", s)
	}
	if !hasTag(in, "breakout") || !hasTag(in, "uptrend") {
		t.Fatalf("tags %v", in.Tags)
	}
	if in.Metrics.RSI14 == nil || *in.Metrics.RSI14 < 99 {
		t.Fatalf("monotone ramp RSI should be ~100: %v", in.Metrics.RSI14)
	}
}

func TestInsightsDowntrend(t *testing.T) {
	in, _ := ComputeInsights(dailies(ramp(260, 400, -1), nil), nil)
	if in.Score > -40 || !hasTag(in, "downtrend") || !hasTag(in, "weakening") {
		t.Fatalf("score %d tags %v", in.Score, in.Tags)
	}
	if in.Metrics.DrawdownPct >= 0 {
		t.Fatalf("drawdown should be negative: %v", in.Metrics.DrawdownPct)
	}
}

func TestInsightsSqueeze(t *testing.T) {
	cl := make([]float64, 200)
	for i := range cl {
		amp := 5.0 * (1 - float64(i)/205) // shrinking range: last bar is the tightest
		cl[i] = 100 + amp*math.Sin(float64(i)/2)
	}
	in, _ := ComputeInsights(dailies(cl, nil), nil)
	if !hasTag(in, "squeeze") {
		t.Fatalf("expected squeeze; bb pctile %v", in.Metrics.BBWidthPctile)
	}
}

func TestInsightsPullbackInUptrend(t *testing.T) {
	cl := ramp(250, 100, 1)
	for i := 0; i < 12; i++ { // sharp pullback
		cl = append(cl, cl[len(cl)-1]-3)
	}
	in, _ := ComputeInsights(dailies(cl, nil), nil)
	if !hasTag(in, "pullback") && !hasTag(in, "oversold") {
		t.Fatalf("expected pullback/oversold, tags %v rsi %v", in.Tags, in.Metrics.RSI14)
	}
}

func TestInsightsRelativeStrength(t *testing.T) {
	a := dailies(ramp(120, 100, 1.5), nil)
	b := dailies(ramp(120, 100, 0.1), nil)
	in, _ := ComputeInsights(a, b)
	if in.Metrics.RelStrength3M == nil || *in.Metrics.RelStrength3M <= 5 || hasSig(in, "rs") == nil {
		t.Fatalf("rs %v", in.Metrics.RelStrength3M)
	}
}

func TestPivotLevelsAndSeasonality(t *testing.T) {
	cl := make([]float64, 600)
	for i := range cl {
		cl[i] = 100 + 10*math.Sin(float64(i)/6)
	}
	in, _ := ComputeInsights(dailies(cl, nil), nil)
	if len(in.Support) == 0 || len(in.Resistance) == 0 {
		t.Fatalf("levels: %+v %+v", in.Support, in.Resistance)
	}
	for _, s := range in.Support {
		if s.Price >= in.Last || s.DistPct >= 0 {
			t.Fatalf("support above last: %+v", s)
		}
	}
	if len(in.Weekday) != 7 || len(in.Month) != 12 {
		t.Fatalf("season shapes %d %d", len(in.Weekday), len(in.Month))
	}
	short, _ := ComputeInsights(dailies(cl[:200], nil), nil)
	if short.Weekday != nil || short.Month != nil {
		t.Fatal("seasonality must be omitted under 500 bars")
	}
}

func TestRSIWilderKnown(t *testing.T) {
	if r, ok := RSIWilder([]float64{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15}, 14); !ok || r != 100 {
		t.Fatalf("up-only RSI want 100 got %v", r)
	}
	if r, _ := RSIWilder([]float64{5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5}, 14); r != 50 {
		t.Fatalf("flat RSI want 50 got %v", r)
	}
	if _, ok := RSIWilder([]float64{1, 2}, 14); ok {
		t.Fatal("short must be !ok")
	}
}

func TestScoreBounded(t *testing.T) {
	for _, step := range []float64{-2, -0.1, 0, 0.1, 3} {
		in, ok := ComputeInsights(dailies(ramp(300, 500, step), nil), nil)
		if !ok || in.Score < -100 || in.Score > 100 {
			t.Fatalf("step %v score %d", step, in.Score)
		}
	}
}
