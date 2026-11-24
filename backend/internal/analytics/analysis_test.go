package analytics

import (
	"math"
	"testing"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
)

// synth builds n daily bars: drift per bar + deterministic wiggle. Starts on a Monday (2024-01-01 UTC).
func synth(n int, start, drift, wiggle float64) []domain.Candle {
	t0 := time.Date(2024, 1, 1, 14, 30, 0, 0, time.UTC).Unix()
	out := make([]domain.Candle, n)
	p := start
	for i := 0; i < n; i++ {
		w := wiggle * math.Sin(float64(i)*0.9)
		o := p
		p = p*(1+drift) + w
		hi := math.Max(o, p) + math.Abs(w)*0.5 + 0.1
		lo := math.Min(o, p) - math.Abs(w)*0.5 - 0.1
		out[i] = domain.Candle{Timestamp: t0 + int64(i)*86400, Open: o, High: hi, Low: lo, Close: p, Volume: 1000 + float64(i%7)*50}
	}
	return out
}

func TestEMAAndMACD(t *testing.T) {
	e := emaSeries([]float64{1, 2, 3, 4, 5}, 3)
	if !math.IsNaN(e[1]) || math.Abs(e[2]-2) > 1e-9 || math.Abs(e[3]-3) > 1e-9 || math.Abs(e[4]-4) > 1e-9 {
		t.Fatalf("ema %v", e)
	}
	up := closesOf(synth(120, 100, 0.004, 0.3))
	if _, _, h, ok := MACDLast(up); !ok || h == 0 {
		t.Fatalf("macd on trend: ok=%v h=%v", ok, h)
	}
	if _, _, _, ok := MACDLast(up[:20]); ok {
		t.Fatal("macd needs history")
	}
}

func TestAnalysisUptrendVsDowntrend(t *testing.T) {
	up, ok := ComputeAnalysis(synth(400, 100, 0.003, 0.4), nil, true)
	if !ok {
		t.Fatal("up not ok")
	}
	dn, ok := ComputeAnalysis(synth(400, 300, -0.003, 0.4), nil, true)
	if !ok {
		t.Fatal("dn not ok")
	}
	if up.Score <= 20 || dn.Score >= -20 {
		t.Fatalf("scores up=%d dn=%d", up.Score, dn.Score)
	}
	if up.Buy <= up.Sell || dn.Sell <= dn.Buy {
		t.Fatalf("votes up %d/%d dn %d/%d", up.Buy, up.Sell, dn.Buy, dn.Sell)
	}
	if up.Buy+up.Sell+up.Neutral != len(up.Votes) {
		t.Fatal("vote tally mismatch")
	}
	if up.Score < -100 || up.Score > 100 {
		t.Fatal("score out of range")
	}
}

func TestAnalysisTooShort(t *testing.T) {
	if _, ok := ComputeAnalysis(synth(10, 100, 0.001, 0.1), nil, false); ok {
		t.Fatal("must refuse short history")
	}
}

func TestProjectionConesNestAndWiden(t *testing.T) {
	a, _ := ComputeAnalysis(synth(300, 100, 0.001, 1.5), nil, false)
	p := a.Projection
	if p == nil || len(p.Cones) != 3 {
		t.Fatalf("projection %+v", p)
	}
	last := a.Insights.Last
	prevW := 0.0
	for _, c := range p.Cones {
		if !(c.Lo95 < c.Lo68 && c.Lo68 < last && last < c.Hi68 && c.Hi68 < c.Hi95) {
			t.Fatalf("cone not nested: %+v last %v", c, last)
		}
		if w := c.Hi95 - c.Lo95; w <= prevW {
			t.Fatalf("cone must widen with horizon: %v <= %v", w, prevW)
		}
		prevW = c.Hi95 - c.Lo95
	}
	if len(p.ATRTargets) != 6 || len(p.FibTargets) != 5 {
		t.Fatalf("targets atr=%d fib=%d", len(p.ATRTargets), len(p.FibTargets))
	}
}

func TestVolumeProfilePOC(t *testing.T) {
	c := synth(130, 100, 0, 0)
	for i := range c { // flat price band, all volume at ~100
		c[i].Open, c[i].High, c[i].Low, c[i].Close, c[i].Volume = 100, 101, 99, 100, 10
	}
	c[5].High, c[5].Low, c[5].Close, c[5].Volume = 120, 80, 100, 10
	vp := volumeProfile(c, 120, 24)
	if vp == nil || vp.POC < 98 || vp.POC > 102 || vp.VAL > vp.POC || vp.VAH < vp.POC {
		t.Fatalf("profile %+v", vp)
	}
}

func TestGapStats(t *testing.T) {
	c := synth(100, 100, 0, 0)
	// make bar 20 (a Monday: index%7==0 from a Monday start, 20%7!=0 -> pick 21) gap up 2% and fill
	i := 21
	c[i].Open = c[i-1].Close * 1.02
	c[i].Low = c[i-1].Close * 0.999
	g := gapStats(c)
	if g == nil || g.Up.N != 1 || g.Up.FillPct != 100 || g.Monday.N != 1 {
		t.Fatalf("gaps %+v", g)
	}
}

func TestAnalogNeedsHistoryAndSamples(t *testing.T) {
	if analog(closesOf(synth(100, 100, 0.001, 1))) != nil {
		t.Fatal("short series must give nil")
	}
	a := analog(closesOf(synth(1500, 100, 0.0005, 2)))
	if a != nil && (a.N < 20 || a.H5 == nil) {
		t.Fatalf("analog %+v", a)
	}
}

func TestTrendState(t *testing.T) {
	up, ok := TrendState("1d", synth(120, 100, 0.004, 0.3))
	if !ok || up.Dir != "up" {
		t.Fatalf("up %+v", up)
	}
	dn, _ := TrendState("1d", synth(120, 300, -0.004, 0))
	if dn.Dir == "up" || dn.Score >= 0 {
		t.Fatalf("dn %+v", dn)
	}
	if _, ok := TrendState("1d", synth(20, 1, 0, 0)); ok {
		t.Fatal("needs ≥55 bars")
	}
}

func TestStochRSIAndCMFAndOBVBounds(t *testing.T) {
	c := synth(200, 100, 0.001, 2)
	if k, d, ok := StochRSILast(closesOf(c)); !ok || k < 0 || k > 100 || d < 0 || d > 100 {
		t.Fatalf("stochrsi %v %v %v", k, d, ok)
	}
	if v, ok := CMFLast(c, 20); !ok || v < -1 || v > 1 {
		t.Fatalf("cmf %v", v)
	}
	if o := OBVSeries(c); len(o) != len(c) {
		t.Fatal("obv len")
	}
}

func TestSupertrendAndIchimoku(t *testing.T) {
	_, dir, ok := SupertrendLast(synth(200, 100, 0.004, 0.3), 10, 3)
	if !ok || dir != 1 {
		t.Fatalf("supertrend up dir=%d", dir)
	}
	_, dir, _ = SupertrendLast(synth(200, 400, -0.004, 0.3), 10, 3)
	if dir != -1 {
		t.Fatalf("supertrend down dir=%d", dir)
	}
	if _, ok := IchimokuLast(synth(70, 1, 0, 0)); ok {
		t.Fatal("ichimoku needs 78 bars")
	}
}

func TestNewsToneAndRank(t *testing.T) {
	ts := NewsTone([]string{"Stock surges to record high", "Company faces lawsuit and probe", "THYAO kâr artışı açıkladı", "Quarterly meeting scheduled"})
	if ts.Pos != 2 || ts.Neg != 1 || ts.Neutral != 1 || ts.Score != 25 {
		t.Fatalf("tone %+v", ts)
	}
	if NewsTone(nil).Label != "Haber yok" {
		t.Fatal("empty label")
	}
	pos, neg := RankRelated([]RelatedItem{{Symbol: "A", R90: 0.9}, {Symbol: "B", R90: -0.7}, {Symbol: "C", R90: 0.2}, {Symbol: "D", R90: -0.1}}, 1)
	if len(pos) != 1 || pos[0].Symbol != "A" || len(neg) != 1 || neg[0].Symbol != "B" {
		t.Fatalf("rank %v %v", pos, neg)
	}
}

func TestCorrOver(t *testing.T) {
	a := synth(120, 100, 0.002, 1)
	r, n, ok := CorrOver(a, a, 90)
	if !ok || r < 0.999 || n != 90 {
		t.Fatalf("self corr r=%v n=%d ok=%v", r, n, ok)
	}
	if _, _, ok := CorrOver(a[:10], a[:10], 0); ok {
		t.Fatal("too few pairs")
	}
}
