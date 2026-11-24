package analytics

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
)

// Vote is one indicator's directional reading: +1 buy, -1 sell, 0 neutral.
type Vote struct {
	Key    string `json:"key"`
	Group  string `json:"group"` // trend | momentum | volume
	Name   string `json:"name"`
	Value  string `json:"value"`
	Vote   int    `json:"vote"`
	Detail string `json:"detail"`
}

// Cone is the expected price range after Days (driftless, from realised volatility).
type Cone struct {
	Days int     `json:"days"`
	Lo68 float64 `json:"lo68"`
	Hi68 float64 `json:"hi68"`
	Lo95 float64 `json:"lo95"`
	Hi95 float64 `json:"hi95"`
}

// Target is a price objective with its distance from the last close.
type Target struct {
	Label   string  `json:"label"`
	Price   float64 `json:"price"`
	DistPct float64 `json:"distPct"`
}

type Projection struct {
	SigmaDailyPct float64  `json:"sigmaDailyPct"`
	Cones         []Cone   `json:"cones"`
	ATRTargets    []Target `json:"atrTargets"`
	FibTargets    []Target `json:"fibTargets"`
	Note          string   `json:"note"`
}

// Dist summarises forward returns after historically similar set-ups.
type Dist struct {
	Horizon int     `json:"horizon"`
	Mean    float64 `json:"meanPct"`
	Median  float64 `json:"medianPct"`
	HitPct  float64 `json:"hitPct"`
	P10     float64 `json:"p10Pct"`
	P90     float64 `json:"p90Pct"`
}

type Analog struct {
	Condition string `json:"condition"`
	N         int    `json:"n"`
	H5        *Dist  `json:"h5"`
	H20       *Dist  `json:"h20"`
	Note      string `json:"note"`
}

type VolBin struct {
	Price  float64 `json:"price"`
	Volume float64 `json:"volume"`
}

type VolumeProfile struct {
	POC  float64  `json:"poc"`
	VAH  float64  `json:"vah"`
	VAL  float64  `json:"val"`
	Bins []VolBin `json:"bins"`
}

type Regime struct {
	Trend      string   `json:"trend"` // trend-up | trend-down | range
	ADX        *float64 `json:"adx"`
	Volatility string   `json:"volatility"` // sıkışma | normal | geniş
	RangePos   *float64 `json:"rangePos52w"`
}

type Flow struct {
	OBVSlopePct float64  `json:"obvSlopePct"` // 20-bar OBV change, % of avg daily volume * 20
	CMF20       *float64 `json:"cmf20"`
	RelVolume   *float64 `json:"relVolume"`
	Divergence  string   `json:"divergence"` // bullish | bearish | ""
}

type GapSlice struct {
	N       int     `json:"n"`
	AvgPct  float64 `json:"avgPct"`
	FillPct float64 `json:"fillPct"`
}

type GapStats struct {
	Days      int      `json:"days"`
	Up        GapSlice `json:"up"`
	Down      GapSlice `json:"down"`
	Monday    GapSlice `json:"monday"` // open vs Friday close
	LastGap   *float64 `json:"lastGapPct"`
	Threshold float64  `json:"thresholdPct"`
}

// TFTrend is the trend state of one timeframe (multi-timeframe matrix row).
type TFTrend struct {
	TF     string   `json:"tf"`
	Dir    string   `json:"dir"` // up | down | flat
	Score  int      `json:"score"`
	RSI    *float64 `json:"rsi"`
	Bars   int      `json:"bars"`
	Detail string   `json:"detail"`
}

// Analysis is the deep programmatic read of one instrument (daily-based part).
type Analysis struct {
	Insights   Insights       `json:"insights"`
	Score      int            `json:"score"` // -100..100 composite (60% indicator votes, 40% insights)
	Bias       string         `json:"bias"`
	VoteScore  int            `json:"voteScore"`
	Buy        int            `json:"buy"`
	Sell       int            `json:"sell"`
	Neutral    int            `json:"neutral"`
	Votes      []Vote         `json:"votes"`
	Projection *Projection    `json:"projection,omitempty"`
	Analog     *Analog        `json:"analog,omitempty"`
	Profile    *VolumeProfile `json:"profile,omitempty"`
	Regime     Regime         `json:"regime"`
	Flow       Flow           `json:"flow"`
	Gaps       *GapStats      `json:"gaps,omitempty"`
}

func f2(v float64) float64 { return math.Round(v*100) / 100 }
func fptr(v float64) *float64 {
	v = f2(v)
	return &v
}

func vote(key, group, name, value string, v int, detail string) Vote {
	return Vote{Key: key, Group: group, Name: name, Value: value, Vote: v, Detail: detail}
}

// rsiSeries is Wilder RSI at every index (NaN until defined).
func rsiSeries(closes []float64, period int) []float64 {
	out := make([]float64, len(closes))
	for i := range out {
		out[i] = math.NaN()
	}
	if len(closes) <= period {
		return out
	}
	var gain, loss float64
	for i := 1; i <= period; i++ {
		d := closes[i] - closes[i-1]
		if d > 0 {
			gain += d
		} else {
			loss -= d
		}
	}
	gain /= float64(period)
	loss /= float64(period)
	val := func() float64 {
		if loss == 0 {
			if gain == 0 {
				return 50
			}
			return 100
		}
		return 100 - 100/(1+gain/loss)
	}
	out[period] = val()
	for i := period + 1; i < len(closes); i++ {
		d := closes[i] - closes[i-1]
		g, l := 0.0, 0.0
		if d > 0 {
			g = d
		} else {
			l = -d
		}
		gain = (gain*float64(period-1) + g) / float64(period)
		loss = (loss*float64(period-1) + l) / float64(period)
		out[i] = val()
	}
	return out
}

// TrendState reads one timeframe: EMA20 vs EMA50, close vs EMA20, MACD histogram sign.
func TrendState(tf string, c []domain.Candle) (TFTrend, bool) {
	cl := closesOf(c)
	if len(cl) < 55 {
		return TFTrend{}, false
	}
	e20, e50 := emaSeries(cl, 20), emaSeries(cl, 50)
	a, ok1 := lastOf(e20)
	b, ok2 := lastOf(e50)
	if !ok1 || !ok2 {
		return TFTrend{}, false
	}
	last := cl[len(cl)-1]
	score := 0
	if a > b {
		score++
	} else if a < b {
		score--
	}
	if last > a {
		score++
	} else if last < a {
		score--
	}
	_, _, h, okm := MACDLast(cl)
	if okm {
		if h > 0 {
			score++
		} else if h < 0 {
			score--
		}
	}
	dir := "flat"
	if score >= 2 {
		dir = "up"
	} else if score <= -2 {
		dir = "down"
	}
	t := TFTrend{TF: tf, Dir: dir, Score: score, Bars: len(c)}
	if r, ok := RSIWilder(cl, 14); ok {
		t.RSI = fptr(r)
	}
	t.Detail = fmt.Sprintf("EMA20 %.4g %s EMA50 %.4g · MACD hist %s", a, map[bool]string{true: ">", false: "<"}[a > b], b, signWord(h, okm))
	return t, true
}

func signWord(h float64, ok bool) string {
	if !ok {
		return "—"
	}
	if h > 0 {
		return "+"
	}
	if h < 0 {
		return "−"
	}
	return "0"
}

// ComputeAnalysis reads ascending daily candles (≥ MinInsightBars). stock enables gap statistics.
func ComputeAnalysis(c []domain.Candle, bench []domain.Candle, stock bool) (Analysis, bool) {
	in, ok := ComputeInsights(c, bench)
	if !ok {
		return Analysis{}, false
	}
	cl := closesOf(c)
	n := len(c)
	last := cl[n-1]
	a := Analysis{Insights: in}

	// ---- trend votes
	if v, ok := lastOf(emaSeries(cl, 20)); ok {
		a.Votes = append(a.Votes, vote("ema20", "trend", "EMA 20", fmt.Sprintf("%.4g", v), cmpVote(last, v), "Fiyat EMA20 "+aboveBelow(last, v)))
	}
	if s, ok := smaAt(cl, n-1, 50); ok {
		a.Votes = append(a.Votes, vote("sma50", "trend", "SMA 50", fmt.Sprintf("%.4g", s), cmpVote(last, s), "Fiyat SMA50 "+aboveBelow(last, s)))
	}
	if s, ok := smaAt(cl, n-1, 100); ok {
		a.Votes = append(a.Votes, vote("sma100", "trend", "SMA 100", fmt.Sprintf("%.4g", s), cmpVote(last, s), "Fiyat SMA100 "+aboveBelow(last, s)))
	}
	if s, ok := smaAt(cl, n-1, 200); ok {
		a.Votes = append(a.Votes, vote("sma200", "trend", "SMA 200", fmt.Sprintf("%.4g", s), cmpVote(last, s), "Fiyat SMA200 "+aboveBelow(last, s)))
	}
	s20, ok20 := smaAt(cl, n-1, 20)
	s50, ok50 := smaAt(cl, n-1, 50)
	s100, ok100 := smaAt(cl, n-1, 100)
	s200, ok200 := smaAt(cl, n-1, 200)
	if ok20 && ok50 && ok100 && ok200 {
		v := 0
		d := "Dizilim karışık"
		if s20 > s50 && s50 > s100 && s100 > s200 {
			v, d = 1, "20 > 50 > 100 > 200: tam yükseliş dizilimi"
		} else if s20 < s50 && s50 < s100 && s100 < s200 {
			v, d = -1, "20 < 50 < 100 < 200: tam düşüş dizilimi"
		}
		a.Votes = append(a.Votes, vote("maalign", "trend", "MA dizilimi", map[int]string{1: "boğa", -1: "ayı", 0: "karışık"}[v], v, d))
	}
	if adx, pdi, mdi, ok := ADXLast(c, 14); ok {
		v, d := 0, fmt.Sprintf("ADX %.1f: zayıf trend", adx)
		if adx >= 25 {
			v = 1
			if mdi > pdi {
				v = -1
			}
			d = fmt.Sprintf("ADX %.1f ≥ 25, +DI %.1f / −DI %.1f", adx, pdi, mdi)
		}
		a.Votes = append(a.Votes, vote("adx", "trend", "ADX / DI", fmt.Sprintf("%.1f", adx), v, d))
		a.Regime.ADX = fptr(adx)
	}
	if line, dir, ok := SupertrendLast(c, 10, 3); ok {
		a.Votes = append(a.Votes, vote("supertrend", "trend", "Supertrend (10,3)", fmt.Sprintf("%.4g", line), dir, map[int]string{1: "Yükseliş: fiyat destek çizgisinin üstünde", -1: "Düşüş: fiyat direnç çizgisinin altında"}[dir]))
	}
	if ich, ok := IchimokuLast(c); ok {
		top, bot := math.Max(ich.SpanA, ich.SpanB), math.Min(ich.SpanA, ich.SpanB)
		v, d := 0, "Fiyat bulutun içinde"
		if last > top {
			v, d = 1, "Fiyat bulutun üstünde"
		} else if last < bot {
			v, d = -1, "Fiyat bulutun altında"
		}
		d += fmt.Sprintf(" · Tenkan %.4g / Kijun %.4g", ich.Tenkan, ich.Kijun)
		a.Votes = append(a.Votes, vote("ichimoku", "trend", "Ichimoku", fmt.Sprintf("%.4g–%.4g", bot, top), v, d))
	}

	// ---- momentum votes
	if r, ok := RSIWilder(cl, 14); ok {
		v, d := 0, "Nötr bölge (30–70)"
		if r >= 70 {
			v, d = -1, "Aşırı alım (≥70): düzeltme riski"
		} else if r <= 30 {
			v, d = 1, "Aşırı satım (≤30): tepki ihtimali"
		}
		a.Votes = append(a.Votes, vote("rsi", "momentum", "RSI 14", fmt.Sprintf("%.1f", r), v, d))
	}
	if k, d, ok := StochRSILast(cl); ok {
		v, det := 0, "Nötr"
		if k < 20 && k > d {
			v, det = 1, "Dipte, %K %D'yi yukarı kesiyor"
		} else if k > 80 && k < d {
			v, det = -1, "Tepede, %K %D'yi aşağı kesiyor"
		}
		a.Votes = append(a.Votes, vote("stochrsi", "momentum", "StochRSI", fmt.Sprintf("%.0f / %.0f", k, d), v, det))
	}
	if m, s, h, ok := MACDLast(cl); ok {
		v := 0
		if h > 0 && m > s {
			v = 1
		} else if h < 0 {
			v = -1
		}
		a.Votes = append(a.Votes, vote("macd", "momentum", "MACD (12,26,9)", fmt.Sprintf("%.4g", h), v, fmt.Sprintf("MACD %.4g, sinyal %.4g, histogram %s", m, s, signWord(h, true))))
	}
	if n > 10 && cl[n-11] > 0 {
		roc := (last/cl[n-11] - 1) * 100
		v := 0
		if roc > 2 {
			v = 1
		} else if roc < -2 {
			v = -1
		}
		a.Votes = append(a.Votes, vote("roc10", "momentum", "ROC 10", fmt.Sprintf("%+.2f%%", roc), v, "10 bar fiyat değişimi"))
	}

	// ---- volume votes + flow
	obv := OBVSeries(c)
	if n > 21 {
		var avgVol float64
		for _, b := range c[n-20:] {
			avgVol += b.Volume
		}
		avgVol /= 20
		if avgVol > 0 {
			slope := (obv[n-1] - obv[n-21]) / (avgVol * 20) * 100
			a.Flow.OBVSlopePct = f2(slope)
			v := 0
			if slope > 10 {
				v = 1
			} else if slope < -10 {
				v = -1
			}
			a.Votes = append(a.Votes, vote("obv", "volume", "OBV (20 bar)", fmt.Sprintf("%+.0f%%", slope), v, "Hacim akışının 20 barlık eğimi (ort. günlük hacme göre)"))
		}
		// divergence: price makes a 20-bar extreme, OBV does not
		hiP, hiO, loP, loO := math.Inf(-1), math.Inf(-1), math.Inf(1), math.Inf(1)
		for i := n - 21; i < n-1; i++ {
			hiP, hiO = math.Max(hiP, cl[i]), math.Max(hiO, obv[i])
			loP, loO = math.Min(loP, cl[i]), math.Min(loO, obv[i])
		}
		if last > hiP && obv[n-1] < hiO {
			a.Flow.Divergence = "bearish"
		} else if last < loP && obv[n-1] > loO {
			a.Flow.Divergence = "bullish"
		}
	}
	if cmf, ok := CMFLast(c, 20); ok {
		v := 0
		if cmf > 0.1 {
			v = 1
		} else if cmf < -0.1 {
			v = -1
		}
		a.Flow.CMF20 = fptr(cmf)
		a.Votes = append(a.Votes, vote("cmf", "volume", "CMF 20", fmt.Sprintf("%+.2f", cmf), v, "Chaikin para akışı: >+0.10 alım, <−0.10 satım baskısı"))
	}
	a.Flow.RelVolume = in.Metrics.RelVolume

	for _, v := range a.Votes {
		switch {
		case v.Vote > 0:
			a.Buy++
		case v.Vote < 0:
			a.Sell++
		default:
			a.Neutral++
		}
	}
	if len(a.Votes) > 0 {
		a.VoteScore = int(math.Round(float64(a.Buy-a.Sell) / float64(len(a.Votes)) * 100))
	}
	a.Score = int(math.Round(0.6*float64(a.VoteScore) + 0.4*float64(in.Score)))
	a.Bias = biasLabel(a.Score)

	// ---- regime
	switch {
	case a.Regime.ADX != nil && *a.Regime.ADX >= 25 && a.Buy >= a.Sell:
		a.Regime.Trend = "trend-up"
	case a.Regime.ADX != nil && *a.Regime.ADX >= 25:
		a.Regime.Trend = "trend-down"
	default:
		a.Regime.Trend = "range"
	}
	a.Regime.Volatility = "normal"
	if p := in.Metrics.BBWidthPctile; p != nil {
		if *p <= 20 {
			a.Regime.Volatility = "sıkışma"
		} else if *p >= 80 {
			a.Regime.Volatility = "geniş"
		}
	}
	if st, ok := ComputeStats(c); ok && st.High52w > st.Low52w {
		a.Regime.RangePos = fptr((last - st.Low52w) / (st.High52w - st.Low52w) * 100)
	}

	a.Projection = projection(c)
	a.Analog = analog(cl)
	a.Profile = volumeProfile(c, 120, 24)
	if stock {
		a.Gaps = gapStats(c)
	}
	return a, true
}

func cmpVote(a, b float64) int {
	if a > b {
		return 1
	}
	if a < b {
		return -1
	}
	return 0
}

func aboveBelow(a, b float64) string {
	if a >= b {
		return fmt.Sprintf("üstünde (%+.1f%%)", (a/b-1)*100)
	}
	return fmt.Sprintf("altında (%+.1f%%)", (a/b-1)*100)
}

func projection(c []domain.Candle) *Projection {
	cl := closesOf(c)
	n := len(cl)
	rets := LogReturns(cl)
	if len(rets) < 30 {
		return nil
	}
	w := rets
	if len(w) > 60 {
		w = w[len(w)-60:]
	}
	var m float64
	for _, r := range w {
		m += r
	}
	m /= float64(len(w))
	var v float64
	for _, r := range w {
		v += (r - m) * (r - m)
	}
	sd := math.Sqrt(v / float64(len(w)-1))
	last := cl[n-1]
	p := &Projection{SigmaDailyPct: f2(sd * 100), Note: "Sürüklenmesiz (drift=0) log-normal koni; son 60 günlük gerçekleşen oynaklık. Yön tahmini değil, olasılıksal aralıktır."}
	for _, d := range []int{1, 5, 20} {
		s := sd * math.Sqrt(float64(d))
		p.Cones = append(p.Cones, Cone{Days: d,
			Lo68: f2(last * math.Exp(-s)), Hi68: f2(last * math.Exp(s)),
			Lo95: f2(last * math.Exp(-1.96*s)), Hi95: f2(last * math.Exp(1.96*s))})
	}
	// ATR targets
	if n > 15 {
		var s float64
		for i := n - 14; i < n; i++ {
			s += trueRange(c, i)
		}
		atr := s / 14
		for _, k := range []float64{1, 2, 3} {
			p.ATRTargets = append(p.ATRTargets,
				Target{Label: fmt.Sprintf("+%.0f ATR", k), Price: f2(last + k*atr), DistPct: f2(k * atr / last * 100)},
				Target{Label: fmt.Sprintf("−%.0f ATR", k), Price: f2(last - k*atr), DistPct: f2(-k * atr / last * 100)})
		}
	}
	// Fibonacci from the last 120-bar swing
	lb := 120
	if n < lb {
		lb = n
	}
	hiI, loI := n-lb, n-lb
	for i := n - lb; i < n; i++ {
		if c[i].High > c[hiI].High {
			hiI = i
		}
		if c[i].Low < c[loI].Low {
			loI = i
		}
	}
	hi, lo := c[hiI].High, c[loI].Low
	if hi > lo {
		rng := hi - lo
		add := func(label string, price float64) {
			p.FibTargets = append(p.FibTargets, Target{Label: label, Price: f2(price), DistPct: f2((price/last - 1) * 100)})
		}
		if loI < hiI { // up-leg: retracements below the high, extensions above
			for _, r := range []float64{0.382, 0.5, 0.618} {
				add(fmt.Sprintf("Fib %.3g geri çekilme", r), hi-r*rng)
			}
			add("Fib 1.272 uzantı", lo+1.272*rng)
			add("Fib 1.618 uzantı", lo+1.618*rng)
		} else { // down-leg
			for _, r := range []float64{0.382, 0.5, 0.618} {
				add(fmt.Sprintf("Fib %.3g tepki", r), lo+r*rng)
			}
			add("Fib 1.272 uzantı", hi-1.272*rng)
			add("Fib 1.618 uzantı", hi-1.618*rng)
		}
	}
	return p
}

func dist(h int, rets []float64) *Dist {
	if len(rets) == 0 {
		return nil
	}
	s := append([]float64(nil), rets...)
	sort.Float64s(s)
	var sum float64
	hit := 0
	for _, r := range s {
		sum += r
		if r > 0 {
			hit++
		}
	}
	q := func(p float64) float64 { return s[int(math.Round(p*float64(len(s)-1)))] }
	return &Dist{Horizon: h, Mean: f2(sum / float64(len(s))), Median: f2(q(0.5)), HitPct: f2(float64(hit) / float64(len(s)) * 100), P10: f2(q(0.1)), P90: f2(q(0.9))}
}

// analog finds past bars with a similar RSI (±7) and the same side of SMA50 / SMA50-vs-SMA200 and
// reports what followed. Overlapping samples are autocorrelated: treat as context, not probability.
func analog(cl []float64) *Analog {
	n := len(cl)
	if n < 260 {
		return nil
	}
	rsi := rsiSeries(cl, 14)
	s50 := sma(cl, 50) // index i corresponds to bar i+49
	s200 := sma(cl, 200)
	at := func(s []float64, win, i int) (float64, bool) {
		j := i - (win - 1)
		if j < 0 || j >= len(s) {
			return 0, false
		}
		return s[j], true
	}
	state := func(i int) (above50, bull bool, ok bool) {
		a, ok1 := at(s50, 50, i)
		b, ok2 := at(s200, 200, i)
		if !ok1 || !ok2 {
			return
		}
		return cl[i] > a, a > b, true
	}
	nowA, nowB, ok := state(n - 1)
	if !ok || math.IsNaN(rsi[n-1]) {
		return nil
	}
	var r5, r20 []float64
	count := 0
	for i := 200; i < n-6; i++ {
		if math.IsNaN(rsi[i]) || math.Abs(rsi[i]-rsi[n-1]) > 7 {
			continue
		}
		a, b, ok := state(i)
		if !ok || a != nowA || b != nowB {
			continue
		}
		count++
		r5 = append(r5, (cl[i+5]/cl[i]-1)*100)
		if i+20 < n {
			r20 = append(r20, (cl[i+20]/cl[i]-1)*100)
		}
	}
	if count < 20 {
		return nil
	}
	cond := fmt.Sprintf("RSI %.0f±7, fiyat SMA50 %s, SMA50 %s SMA200", rsi[n-1], map[bool]string{true: "üstünde", false: "altında"}[nowA], map[bool]string{true: ">", false: "<"}[nowB])
	return &Analog{Condition: cond, N: count, H5: dist(5, r5), H20: dist(20, r20),
		Note: "Geçmişte benzer durumlarda sonraki getiri dağılımı. Örnekler ardışık barlar olduğundan birbirine bağımlıdır; olasılık değil bağlamdır."}
}

func volumeProfile(c []domain.Candle, lookback, nb int) *VolumeProfile {
	if len(c) < 20 {
		return nil
	}
	if len(c) < lookback {
		lookback = len(c)
	}
	w := c[len(c)-lookback:]
	lo, hi := w[0].Low, w[0].High
	for _, b := range w {
		lo, hi = math.Min(lo, b.Low), math.Max(hi, b.High)
	}
	if hi <= lo {
		return nil
	}
	step := (hi - lo) / float64(nb)
	vols := make([]float64, nb)
	var total float64
	for _, b := range w {
		tp := (b.High + b.Low + b.Close) / 3
		i := int((tp - lo) / step)
		if i >= nb {
			i = nb - 1
		}
		vols[i] += b.Volume
		total += b.Volume
	}
	if total == 0 {
		return nil
	}
	poc := 0
	for i, v := range vols {
		if v > vols[poc] {
			poc = i
		}
	}
	l, r, acc := poc, poc, vols[poc]
	for acc < total*0.7 && (l > 0 || r < nb-1) {
		var lv, rv float64 = -1, -1
		if l > 0 {
			lv = vols[l-1]
		}
		if r < nb-1 {
			rv = vols[r+1]
		}
		if lv >= rv {
			l--
			acc += vols[l]
		} else {
			r++
			acc += vols[r]
		}
	}
	vp := &VolumeProfile{POC: f2(lo + (float64(poc)+0.5)*step), VAL: f2(lo + float64(l)*step), VAH: f2(lo + float64(r+1)*step)}
	for i, v := range vols {
		vp.Bins = append(vp.Bins, VolBin{Price: f2(lo + (float64(i)+0.5)*step), Volume: math.Round(v)})
	}
	return vp
}

func gapStats(c []domain.Candle) *GapStats {
	const thr = 0.3
	if len(c) < 60 {
		return nil
	}
	g := &GapStats{Days: len(c) - 1, Threshold: thr}
	var up, dn, mon struct {
		n, fill int
		sum     float64
	}
	for i := 1; i < len(c); i++ {
		pc := c[i-1].Close
		if pc <= 0 {
			continue
		}
		gp := (c[i].Open/pc - 1) * 100
		if i == len(c)-1 {
			g.LastGap = fptr(gp)
		}
		if math.Abs(gp) < thr {
			continue
		}
		isMon := time.Unix(c[i].Timestamp, 0).UTC().Weekday() == time.Monday
		if gp > 0 {
			up.n++
			up.sum += gp
			if c[i].Low <= pc {
				up.fill++
			}
		} else {
			dn.n++
			dn.sum += gp
			if c[i].High >= pc {
				dn.fill++
			}
		}
		if isMon {
			mon.n++
			mon.sum += gp
			if (gp > 0 && c[i].Low <= pc) || (gp < 0 && c[i].High >= pc) {
				mon.fill++
			}
		}
	}
	mk := func(s struct {
		n, fill int
		sum     float64
	}) GapSlice {
		if s.n == 0 {
			return GapSlice{}
		}
		return GapSlice{N: s.n, AvgPct: f2(s.sum / float64(s.n)), FillPct: f2(float64(s.fill) / float64(s.n) * 100)}
	}
	g.Up, g.Down, g.Monday = mk(up), mk(dn), mk(mon)
	return g
}
