package analytics

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
)

// Signal is one rule-based observation. Weight is its contribution to the composite score
// (signed, before scaling); Detail always shows the numbers behind the rule.
type Signal struct {
	Key    string  `json:"key"`
	Label  string  `json:"label"`
	Tone   string  `json:"tone"` // bull | bear | warn | neutral
	Detail string  `json:"detail"`
	Weight float64 `json:"weight"`
}

// Level is a support/resistance price cluster.
type Level struct {
	Price   float64 `json:"price"`
	Touches int     `json:"touches"`
	DistPct float64 `json:"distPct"` // signed % from last close
}

// SeasonCell is the historical average daily (weekday) or monthly return for one bucket.
type SeasonCell struct {
	AvgPct float64 `json:"avgPct"`
	HitPct float64 `json:"hitPct"` // % of observations that were positive
	N      int     `json:"n"`
}

// Metrics are the raw numbers behind the signals (nil = not enough history).
type Metrics struct {
	RSI14         *float64 `json:"rsi14"`
	SMA50         *float64 `json:"sma50"`
	SMA200        *float64 `json:"sma200"`
	Z20           *float64 `json:"z20"`
	BBWidthPctile *float64 `json:"bbWidthPctile"`
	ATRPctile     *float64 `json:"atrPctile"`
	RelVolume     *float64 `json:"relVolume"`
	Momentum121   *float64 `json:"momentum121"`
	RelStrength3M *float64 `json:"relStrength3m"`
	VaR95         *float64 `json:"var95Pct"`
	DrawdownPct   float64  `json:"drawdownPct"`
	DaysSincePeak int      `json:"daysSincePeak"`
	Streak        int      `json:"streak"` // +n up closes in a row, -n down closes
}

// Insights is the full programmatic read of one instrument's daily history.
type Insights struct {
	Bars       int           `json:"bars"`
	Last       float64       `json:"last"`
	Score      int           `json:"score"` // -100..100
	Bias       string        `json:"bias"`
	Tags       []string      `json:"tags"`
	Signals    []Signal      `json:"signals"`
	Metrics    Metrics       `json:"metrics"`
	Support    []Level       `json:"support"`
	Resistance []Level       `json:"resistance"`
	Weekday    []*SeasonCell `json:"weekday,omitempty"` // index 0=Sunday
	Month      []*SeasonCell `json:"month,omitempty"`   // index 0=January
}

// MinInsightBars is the shortest history that still yields a (partial) read.
const MinInsightBars = 30

func fp(v float64) *float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return nil
	}
	r := round2(v)
	return &r
}

func smaAt(c []float64, end, n int) (float64, bool) { // mean of c[end-n+1..end]
	if n <= 0 || end+1 < n {
		return 0, false
	}
	var s float64
	for i := end - n + 1; i <= end; i++ {
		s += c[i]
	}
	return s / float64(n), true
}

func stdAt(c []float64, end, n int) (mean, sd float64, ok bool) {
	m, ok := smaAt(c, end, n)
	if !ok {
		return 0, 0, false
	}
	var s float64
	for i := end - n + 1; i <= end; i++ {
		s += (c[i] - m) * (c[i] - m)
	}
	return m, math.Sqrt(s / float64(n)), true
}

// RSIWilder returns the last Wilder RSI(period); ok=false with too little data.
func RSIWilder(closes []float64, period int) (float64, bool) {
	if period < 1 || len(closes) <= period {
		return 0, false
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
	}
	if loss == 0 {
		if gain == 0 {
			return 50, true
		}
		return 100, true
	}
	return 100 - 100/(1+gain/loss), true
}

// percentileRank returns the % of window values <= v.
func percentileRank(window []float64, v float64) float64 {
	if len(window) == 0 {
		return 0
	}
	n := 0
	for _, x := range window {
		if x <= v {
			n++
		}
	}
	return float64(n) / float64(len(window)) * 100
}

func trueRange(c []domain.Candle, i int) float64 {
	tr := c[i].High - c[i].Low
	if i > 0 {
		tr = math.Max(tr, math.Abs(c[i].High-c[i-1].Close))
		tr = math.Max(tr, math.Abs(c[i].Low-c[i-1].Close))
	}
	return tr
}

// pivotLevels clusters swing highs/lows (window w) within tolPct and returns the nearest
// supports below and resistances above the last close (most-touched first within 3 nearest).
func pivotLevels(c []domain.Candle, lookback, w int, tolPct float64) (support, resistance []Level) {
	n := len(c)
	if n < 2*w+3 {
		return nil, nil
	}
	start := n - lookback
	if start < w {
		start = w
	}
	var pts []float64
	for i := start; i < n-w; i++ {
		isHigh, isLow := true, true
		for j := i - w; j <= i+w; j++ {
			if j == i {
				continue
			}
			if c[j].High >= c[i].High {
				isHigh = false
			}
			if c[j].Low <= c[i].Low {
				isLow = false
			}
		}
		if isHigh {
			pts = append(pts, c[i].High)
		}
		if isLow {
			pts = append(pts, c[i].Low)
		}
	}
	sort.Float64s(pts)
	type cl struct {
		sum   float64
		count int
	}
	var clusters []cl
	for _, p := range pts {
		if k := len(clusters) - 1; k >= 0 {
			mean := clusters[k].sum / float64(clusters[k].count)
			if mean > 0 && math.Abs(p/mean-1)*100 <= tolPct {
				clusters[k].sum += p
				clusters[k].count++
				continue
			}
		}
		clusters = append(clusters, cl{sum: p, count: 1})
	}
	last := c[n-1].Close
	for _, k := range clusters {
		price := k.sum / float64(k.count)
		lv := Level{Price: round2(price), Touches: k.count, DistPct: round2((price/last - 1) * 100)}
		if price < last {
			support = append(support, lv)
		} else {
			resistance = append(resistance, lv)
		}
	}
	// nearest first
	sort.Slice(support, func(i, j int) bool { return support[i].Price > support[j].Price })
	sort.Slice(resistance, func(i, j int) bool { return resistance[i].Price < resistance[j].Price })
	if len(support) > 3 {
		support = support[:3]
	}
	if len(resistance) > 3 {
		resistance = resistance[:3]
	}
	return support, resistance
}

// seasonality needs >= ~2 years of dailies; returns nil slices otherwise.
func seasonality(c []domain.Candle) (weekday, month []*SeasonCell) {
	if len(c) < 500 {
		return nil, nil
	}
	type acc struct {
		sum  float64
		pos  int
		n    int
		anyN bool
	}
	var wd [7]acc
	type ym struct{ y, m int }
	monthRet := map[ym]float64{}
	for i := 1; i < len(c); i++ {
		if c[i].Close <= 0 || c[i-1].Close <= 0 {
			continue
		}
		r := c[i].Close/c[i-1].Close - 1
		t := time.Unix(c[i].Timestamp, 0).UTC()
		d := int(t.Weekday())
		wd[d].sum += r
		wd[d].n++
		if r > 0 {
			wd[d].pos++
		}
		k := ym{t.Year(), int(t.Month()) - 1}
		monthRet[k] = (1+monthRet[k])*(1+r) - 1
	}
	weekday = make([]*SeasonCell, 7)
	for d := range wd {
		if wd[d].n >= 30 {
			weekday[d] = &SeasonCell{AvgPct: round2(wd[d].sum / float64(wd[d].n) * 100), HitPct: round2(float64(wd[d].pos) / float64(wd[d].n) * 100), N: wd[d].n}
		}
	}
	var mm [12]acc
	for k, r := range monthRet {
		mm[k.m].sum += r
		mm[k.m].n++
		if r > 0 {
			mm[k.m].pos++
		}
	}
	month = make([]*SeasonCell, 12)
	for m := range mm {
		if mm[m].n >= 2 {
			month[m] = &SeasonCell{AvgPct: round2(mm[m].sum / float64(mm[m].n) * 100), HitPct: round2(float64(mm[m].pos) / float64(mm[m].n) * 100), N: mm[m].n}
		}
	}
	return weekday, month
}

func biasLabel(score int) string {
	switch {
	case score >= 40:
		return "Güçlü yükseliş eğilimi"
	case score >= 15:
		return "Yükseliş eğilimi"
	case score > -15:
		return "Yatay / kararsız"
	case score > -40:
		return "Düşüş eğilimi"
	}
	return "Güçlü düşüş eğilimi"
}

// ComputeInsights reads ascending daily candles; bench (optional, ascending) enables relative strength.
// Pure function: same input, same output. Returns ok=false below MinInsightBars.
func ComputeInsights(c []domain.Candle, bench []domain.Candle) (Insights, bool) {
	n := len(c)
	if n < MinInsightBars {
		return Insights{}, false
	}
	sort.SliceStable(c, func(i, j int) bool { return c[i].Timestamp < c[j].Timestamp })
	closes := make([]float64, n)
	for i, x := range c {
		closes[i] = x.Close
	}
	last := closes[n-1]
	in := Insights{Bars: n, Last: last, Tags: []string{}, Signals: []Signal{}}
	var sum float64
	add := func(key, label, tone, detail string, w float64) {
		in.Signals = append(in.Signals, Signal{Key: key, Label: label, Tone: tone, Detail: detail, Weight: w})
		sum += w
	}
	tag := func(t string) { in.Tags = append(in.Tags, t) }

	sma50, ok50 := smaAt(closes, n-1, 50)
	sma200, ok200 := smaAt(closes, n-1, 200)
	if ok50 {
		in.Metrics.SMA50 = fp(sma50)
	}
	if ok200 {
		in.Metrics.SMA200 = fp(sma200)
	}

	// --- trend ---
	uptrend, downtrend := false, false
	switch {
	case ok200 && ok50 && last > sma50 && sma50 > sma200:
		uptrend = true
		add("trend", "Güçlü yükseliş trendi", "bull", fmt.Sprintf("Fiyat > SMA50 (%.2f) > SMA200 (%.2f)", sma50, sma200), 30)
		tag("uptrend")
	case ok200 && ok50 && last < sma50 && sma50 < sma200:
		downtrend = true
		add("trend", "Güçlü düşüş trendi", "bear", fmt.Sprintf("Fiyat < SMA50 (%.2f) < SMA200 (%.2f)", sma50, sma200), -30)
		tag("downtrend")
	case ok200 && last > sma200:
		uptrend = true
		add("trend", "Uzun vadeli trend yukarı", "bull", fmt.Sprintf("Fiyat SMA200 (%.2f) üzerinde ama kısa vade karışık", sma200), 12)
		tag("uptrend")
	case ok200 && last < sma200:
		downtrend = true
		add("trend", "Uzun vadeli trend aşağı", "bear", fmt.Sprintf("Fiyat SMA200 (%.2f) altında ama kısa vade karışık", sma200), -12)
		tag("downtrend")
	case ok50 && last > sma50:
		uptrend = true
		add("trend", "Kısa vadeli trend yukarı", "bull", fmt.Sprintf("Fiyat SMA50 (%.2f) üzerinde (SMA200 için yeterli veri yok)", sma50), 15)
	case ok50 && last < sma50:
		downtrend = true
		add("trend", "Kısa vadeli trend aşağı", "bear", fmt.Sprintf("Fiyat SMA50 (%.2f) altında (SMA200 için yeterli veri yok)", sma50), -15)
	}
	// golden / death cross within the last 10 bars
	if n >= 210 {
		for back := 0; back < 10; back++ {
			i := n - 1 - back
			a1, _ := smaAt(closes, i, 50)
			b1, _ := smaAt(closes, i, 200)
			a0, _ := smaAt(closes, i-1, 50)
			b0, _ := smaAt(closes, i-1, 200)
			if a0 <= b0 && a1 > b1 {
				add("cross", "Altın kesişim (yakın)", "bull", fmt.Sprintf("SMA50, SMA200'ü %d bar önce yukarı kesti", back), 6)
				break
			}
			if a0 >= b0 && a1 < b1 {
				add("cross", "Ölüm kesişimi (yakın)", "bear", fmt.Sprintf("SMA50, SMA200'ü %d bar önce aşağı kesti", back), -6)
				break
			}
		}
	}

	// --- momentum 12-1 (falls back to 3 months) ---
	switch {
	case n > 252 && closes[n-1-252] > 0 && closes[n-1-21] > 0:
		m := (closes[n-1-21]/closes[n-1-252] - 1) * 100
		in.Metrics.Momentum121 = fp(m)
		if m > 10 {
			add("momentum", "Güçlü 12-1 ay momentumu", "bull", fmt.Sprintf("Son 21 gün hariç 1 yıllık getiri %+.1f%%", m), 10)
		} else if m < -10 {
			add("momentum", "Zayıf 12-1 ay momentumu", "bear", fmt.Sprintf("Son 21 gün hariç 1 yıllık getiri %+.1f%%", m), -10)
		}
	case n > 63 && closes[n-1-63] > 0:
		m := (last/closes[n-1-63] - 1) * 100
		if m > 10 {
			add("momentum", "Güçlü 3 aylık momentum", "bull", fmt.Sprintf("3 aylık getiri %+.1f%%", m), 8)
		} else if m < -10 {
			add("momentum", "Zayıf 3 aylık momentum", "bear", fmt.Sprintf("3 aylık getiri %+.1f%%", m), -8)
		}
	}

	// --- relative strength vs benchmark (3M, aligned by day) ---
	if len(bench) > 63 && n > 63 {
		bm := make(map[int64]float64, len(bench))
		for _, b := range bench {
			bm[b.Timestamp/86400] = b.Close
		}
		ref := c[n-1-63].Timestamp / 86400
		bNow, okN := bm[c[n-1].Timestamp/86400]
		var bThen float64
		okT := false
		for d := ref; d >= ref-4 && !okT; d-- { // tolerate a holiday
			if v, ok := bm[d]; ok {
				bThen, okT = v, true
			}
		}
		if okN && okT && bThen > 0 && closes[n-1-63] > 0 {
			ex := ((last/closes[n-1-63] - 1) - (bNow/bThen - 1)) * 100
			in.Metrics.RelStrength3M = fp(ex)
			if ex > 5 {
				add("rs", "Endeksten güçlü", "bull", fmt.Sprintf("3 ayda benchmark'a göre %+.1f puan fazla getiri", ex), 8)
			} else if ex < -5 {
				add("rs", "Endeksten zayıf", "bear", fmt.Sprintf("3 ayda benchmark'a göre %+.1f puan düşük getiri", ex), -8)
			}
		}
	}

	// --- breakout / breakdown of the prior 20-bar range ---
	var hi20, lo20 float64
	rel := math.NaN()
	if n > 21 {
		hi20, lo20 = closes[n-21], closes[n-21]
		for i := n - 21; i < n-1; i++ { // closing-basis range: wicks do not count as a breakout
			hi20 = math.Max(hi20, closes[i])
			lo20 = math.Min(lo20, closes[i])
		}
		if vm, ok := volMean(c, n-2, 20); ok && vm > 0 {
			rel = c[n-1].Volume / vm
			in.Metrics.RelVolume = fp(rel)
		}
		switch {
		case last > hi20:
			w := 12.0
			d := fmt.Sprintf("Kapanış %.2f, önceki 20 kapanışın tepesi %.2f", last, hi20)
			if !math.IsNaN(rel) && rel > 1.2 {
				w += 4
				d += fmt.Sprintf(" · hacim %.1fx ile teyitli", rel)
			}
			add("breakout", "20 günlük tepe kırılımı", "bull", d, w)
			tag("breakout")
		case last < lo20:
			add("breakdown", "20 günlük dip kırılımı", "bear", fmt.Sprintf("Kapanış %.2f, önceki 20 kapanışın dibi %.2f", last, lo20), -12)
			tag("breakdown")
		}
	}

	// --- RSI ---
	if rsi, ok := RSIWilder(closes, 14); ok {
		in.Metrics.RSI14 = fp(rsi)
		switch {
		case rsi >= 70:
			add("rsi", "RSI aşırı alım", "warn", fmt.Sprintf("RSI(14) %.1f — güçlü trendde uzayabilir, kâr alma riski artar", rsi), -4)
			tag("overbought")
		case rsi <= 30:
			w := 4.0
			note := "tepki yükselişi ihtimali"
			if downtrend {
				w, note = 0, "düşüş trendinde aşırı satım uzayabilir"
			}
			add("rsi", "RSI aşırı satım", "warn", fmt.Sprintf("RSI(14) %.1f — %s", rsi, note), w)
			tag("oversold")
		case rsi <= 40 && uptrend:
			add("pullback", "Yükseliş trendinde geri çekilme", "bull", fmt.Sprintf("RSI(14) %.1f; trend yukarıyken zayıflamış fiyat (geri çekilme alım adayı)", rsi), 6)
			tag("pullback")
		}
	}

	// --- Bollinger bandwidth squeeze ---
	if n >= 140 {
		bw := make([]float64, 0, 120)
		for i := n - 120; i < n; i++ {
			m, sd, ok := stdAt(closes, i, 20)
			if ok && m > 0 {
				bw = append(bw, 4*sd/m)
			}
		}
		if len(bw) > 60 {
			p := percentileRank(bw, bw[len(bw)-1])
			in.Metrics.BBWidthPctile = fp(p)
			if p <= 10 {
				add("squeeze", "Bollinger sıkışması", "warn", fmt.Sprintf("Band genişliği son 120 barın en düşük %%%.0f diliminde — oynaklık patlaması yaklaşıyor olabilir, yön belirsiz", p), 0)
				tag("squeeze")
			}
		}
	}

	// --- volatility regime (ATR% percentile over ~1y) ---
	if n >= 60 {
		var series []float64
		from := n - 250
		if from < 14 {
			from = 14
		}
		for i := from; i < n; i++ {
			var s float64
			for j := i - 13; j <= i; j++ {
				s += trueRange(c, j)
			}
			if closes[i] > 0 {
				series = append(series, s/14/closes[i]*100)
			}
		}
		if len(series) > 30 {
			p := percentileRank(series, series[len(series)-1])
			in.Metrics.ATRPctile = fp(p)
			if p >= 90 {
				add("volreg", "Yüksek oynaklık rejimi", "warn", fmt.Sprintf("ATR%% kendi 1 yıllık dağılımının %%%.0f diliminde — pozisyonu küçült, stopu genişlet", p), 0)
			} else if p <= 15 {
				add("volreg", "Düşük oynaklık rejimi", "neutral", fmt.Sprintf("ATR%% kendi 1 yıllık dağılımının %%%.0f diliminde — sakin dönem, genişleme riski", p), 0)
			}
		}
	}

	// --- mean reversion z-score ---
	if m, sd, ok := stdAt(closes, n-1, 20); ok && sd > 0 {
		z := (last - m) / sd
		in.Metrics.Z20 = fp(z)
		if z >= 2 {
			add("z", "Ortalamadan aşırı uzak (üst)", "warn", fmt.Sprintf("20g ortalamanın %.1f standart sapma üstünde", z), -3)
		} else if z <= -2 {
			add("z", "Ortalamadan aşırı uzak (alt)", "warn", fmt.Sprintf("20g ortalamanın %.1f standart sapma altında", -z), 3)
		}
	}

	// --- volume spike + OBV divergence ---
	if !math.IsNaN(rel) && rel >= 2.5 {
		add("volspike", "Hacim patlaması", "warn", fmt.Sprintf("Son bar hacmi 20g ortalamanın %.1f katı", rel), 0)
		tag("volspike")
	}
	if n > 41 {
		obv := make([]float64, n)
		for i := 1; i < n; i++ {
			obv[i] = obv[i-1]
			switch {
			case closes[i] > closes[i-1]:
				obv[i] += c[i].Volume
			case closes[i] < closes[i-1]:
				obv[i] -= c[i].Volume
			}
		}
		hasVol := false
		for _, x := range c[n-40:] {
			if x.Volume > 0 {
				hasVol = true
				break
			}
		}
		if hasVol {
			dPrice := last/closes[n-21] - 1
			dObv := obv[n-1] - obv[n-21]
			if dPrice > 0.03 && dObv < 0 {
				add("obv", "Negatif ıraksama (OBV)", "bear", fmt.Sprintf("Fiyat 20 günde %+.1f%% yükseldi ama hacim akışı (OBV) düştü — yükseliş zayıf", dPrice*100), -8)
			} else if dPrice < -0.03 && dObv > 0 {
				add("obv", "Pozitif ıraksama (OBV)", "bull", fmt.Sprintf("Fiyat 20 günde %+.1f%% düştü ama hacim akışı (OBV) yükseldi — satış baskısı azalıyor olabilir", dPrice*100), 8)
			}
		}
	}

	// --- drawdown state ---
	peak, peakIdx := closes[0], 0
	for i, x := range closes {
		if x >= peak {
			peak, peakIdx = x, i
		}
	}
	if peak > 0 {
		in.Metrics.DrawdownPct = round2((last/peak - 1) * 100)
		in.Metrics.DaysSincePeak = n - 1 - peakIdx
		if in.Metrics.DrawdownPct <= -25 {
			add("dd", "Derin düşüş içinde", "warn", fmt.Sprintf("Zirveden %.1f%% aşağıda, zirve %d bar önce", in.Metrics.DrawdownPct, in.Metrics.DaysSincePeak), 0)
			tag("weakening")
		}
	}

	// --- streak ---
	streak := 0
	for i := n - 1; i > 0; i-- {
		d := closes[i] - closes[i-1]
		if d > 0 && streak >= 0 {
			streak++
		} else if d < 0 && streak <= 0 {
			streak--
		} else {
			break
		}
	}
	in.Metrics.Streak = streak
	if streak >= 5 || streak <= -5 {
		tone, label := "warn", "Üst üste yükselen kapanışlar"
		if streak < 0 {
			label = "Üst üste düşen kapanışlar"
		}
		add("streak", label, tone, fmt.Sprintf("%d gün aynı yönde kapanış", abs(streak)), 0)
	}

	// --- VaR95 (historical, 1 day) ---
	if rets := LogReturns(closes); len(rets) >= 60 {
		s := append([]float64(nil), rets...)
		sort.Float64s(s)
		idx := int(math.Floor(0.05 * float64(len(s))))
		in.Metrics.VaR95 = fp((math.Exp(s[idx]) - 1) * 100)
	}

	// weakening: any downtrend reading
	if downtrend {
		in.Tags = appendUnique(in.Tags, "weakening")
	}

	in.Support, in.Resistance = pivotLevels(c, 120, 4, 1.5)
	in.Weekday, in.Month = seasonality(c)

	score := int(math.Round(math.Max(-100, math.Min(100, sum*1.25))))
	in.Score = score
	in.Bias = biasLabel(score)
	return in, true
}

func volMean(c []domain.Candle, end, n int) (float64, bool) {
	if end+1 < n {
		return 0, false
	}
	var s float64
	for i := end - n + 1; i <= end; i++ {
		s += c[i].Volume
	}
	return s / float64(n), true
}

func abs(i int) int {
	if i < 0 {
		return -i
	}
	return i
}

func appendUnique(list []string, v string) []string {
	for _, x := range list {
		if x == v {
			return list
		}
	}
	return append(list, v)
}
