// Package analytics holds pure market math used by the terminal layer (no I/O).
package analytics

import (
	"math"
	"sort"

	"github.com/ersincebi/titanview/backend/internal/domain"
)

// MinOverlap is the minimum number of paired returns needed for a correlation.
const MinOverlap = 20

// LogReturns returns ln(c[i]/c[i-1]); non-positive closes yield no return for that step.
func LogReturns(closes []float64) []float64 {
	out := make([]float64, 0, len(closes))
	for i := 1; i < len(closes); i++ {
		if closes[i] > 0 && closes[i-1] > 0 {
			out = append(out, math.Log(closes[i]/closes[i-1]))
		}
	}
	return out
}

// Pearson returns the correlation of equal-length series; ok=false when undefined (len<2, zero variance).
func Pearson(a, b []float64) (float64, bool) {
	n := len(a)
	if n < 2 || n != len(b) {
		return 0, false
	}
	var ma, mb float64
	for i := 0; i < n; i++ {
		ma += a[i]
		mb += b[i]
	}
	ma /= float64(n)
	mb /= float64(n)
	var sab, saa, sbb float64
	for i := 0; i < n; i++ {
		da, db := a[i]-ma, b[i]-mb
		sab += da * db
		saa += da * da
		sbb += db * db
	}
	if saa == 0 || sbb == 0 {
		return 0, false
	}
	r := sab / math.Sqrt(saa*sbb)
	return math.Max(-1, math.Min(1, r)), true
}

// alignedReturns pairs log returns of two candle series over days both have, using consecutive common days.
func alignedReturns(a, b []domain.Candle) (ra, rb []float64) {
	mb := make(map[int64]float64, len(b))
	for _, c := range b {
		mb[c.Timestamp/86400] = c.Close
	}
	var prevA, prevB float64
	for _, c := range a {
		cb, ok := mb[c.Timestamp/86400]
		if !ok {
			continue
		}
		if prevA > 0 && prevB > 0 && c.Close > 0 && cb > 0 {
			ra = append(ra, math.Log(c.Close/prevA))
			rb = append(rb, math.Log(cb/prevB))
		}
		prevA, prevB = c.Close, cb
	}
	return
}

// CorrelationMatrix computes pairwise Pearson over day-aligned log returns.
// Cells are nil when fewer than MinOverlap paired returns exist or variance is zero.
func CorrelationMatrix(symbols []string, series map[string][]domain.Candle) [][]*float64 {
	n := len(symbols)
	m := make([][]*float64, n)
	for i := range m {
		m[i] = make([]*float64, n)
	}
	for i := 0; i < n; i++ {
		for j := i; j < n; j++ {
			var cell *float64
			if i == j {
				if len(series[symbols[i]]) >= 2 {
					one := 1.0
					cell = &one
				}
			} else {
				ra, rb := alignedReturns(series[symbols[i]], series[symbols[j]])
				if len(ra) >= MinOverlap {
					if r, ok := Pearson(ra, rb); ok {
						r = math.Round(r*1000) / 1000
						cell = &r
					}
				}
			}
			m[i][j] = cell
			m[j][i] = cell
		}
	}
	return m
}

// Beta of asset vs benchmark (cov/var of aligned log returns); ok=false when undefined.
func Beta(asset, bench []domain.Candle) (float64, bool) {
	ra, rb := alignedReturns(asset, bench)
	if len(ra) < MinOverlap {
		return 0, false
	}
	var ma, mb float64
	for i := range ra {
		ma += ra[i]
		mb += rb[i]
	}
	ma /= float64(len(ra))
	mb /= float64(len(rb))
	var cov, vb float64
	for i := range ra {
		cov += (ra[i] - ma) * (rb[i] - mb)
		vb += (rb[i] - mb) * (rb[i] - mb)
	}
	if vb == 0 {
		return 0, false
	}
	return cov / vb, true
}

// Stats is the DES-style summary of a daily series. Pointers are nil when history is too short.
type Stats struct {
	Last        float64  `json:"last"`
	Change1D    *float64 `json:"change1d"`
	Change1W    *float64 `json:"change1w"`
	Change1M    *float64 `json:"change1m"`
	Change3M    *float64 `json:"change3m"`
	ChangeYTD   *float64 `json:"changeYtd"`
	Change1Y    *float64 `json:"change1y"`
	High52w     float64  `json:"high52w"`
	Low52w      float64  `json:"low52w"`
	FromHigh    float64  `json:"fromHighPct"` // % below 52w high (<=0)
	VolAnnual   *float64 `json:"volAnnualPct"`
	MaxDrawdown float64  `json:"maxDrawdownPct"` // <=0
	ATR14Pct    *float64 `json:"atr14Pct"`
	Bars        int      `json:"bars"`
}

func pctBack(c []domain.Candle, bars int) *float64 {
	n := len(c)
	if n <= bars || c[n-1-bars].Close <= 0 {
		return nil
	}
	v := round2((c[n-1].Close/c[n-1-bars].Close - 1) * 100)
	return &v
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

// ComputeStats summarizes daily candles (ascending). Returns ok=false when empty.
func ComputeStats(c []domain.Candle) (Stats, bool) {
	n := len(c)
	if n == 0 {
		return Stats{}, false
	}
	sort.SliceStable(c, func(i, j int) bool { return c[i].Timestamp < c[j].Timestamp })
	st := Stats{Last: c[n-1].Close, Bars: n}
	st.Change1D = pctBack(c, 1)
	st.Change1W = pctBack(c, 5)
	st.Change1M = pctBack(c, 21)
	st.Change3M = pctBack(c, 63)
	st.Change1Y = pctBack(c, 252)

	// YTD: last close of previous calendar year (UTC) as base.
	lastYear := yearOf(c[n-1].Timestamp)
	for i := n - 1; i >= 0; i-- {
		if yearOf(c[i].Timestamp) < lastYear {
			if c[i].Close > 0 {
				v := round2((c[n-1].Close/c[i].Close - 1) * 100)
				st.ChangeYTD = &v
			}
			break
		}
	}

	w := c
	if n > 252 {
		w = c[n-252:]
	}
	st.High52w, st.Low52w = w[0].High, w[0].Low
	for _, x := range w {
		st.High52w = math.Max(st.High52w, x.High)
		st.Low52w = math.Min(st.Low52w, x.Low)
	}
	if st.High52w > 0 {
		st.FromHigh = round2((st.Last/st.High52w - 1) * 100)
	}

	closes := make([]float64, n)
	for i, x := range c {
		closes[i] = x.Close
	}
	if rets := LogReturns(closes); len(rets) >= 20 {
		var m float64
		for _, r := range rets {
			m += r
		}
		m /= float64(len(rets))
		var s float64
		for _, r := range rets {
			s += (r - m) * (r - m)
		}
		v := round2(math.Sqrt(s/float64(len(rets)-1)) * math.Sqrt(252) * 100)
		st.VolAnnual = &v
	}

	peak := closes[0]
	for _, x := range closes {
		peak = math.Max(peak, x)
		if peak > 0 {
			st.MaxDrawdown = math.Min(st.MaxDrawdown, (x/peak-1)*100)
		}
	}
	st.MaxDrawdown = round2(st.MaxDrawdown)

	if n > 14 && st.Last > 0 {
		var sum float64
		for i := n - 14; i < n; i++ {
			tr := c[i].High - c[i].Low
			tr = math.Max(tr, math.Abs(c[i].High-c[i-1].Close))
			tr = math.Max(tr, math.Abs(c[i].Low-c[i-1].Close))
			sum += tr
		}
		v := round2(sum / 14 / st.Last * 100)
		st.ATR14Pct = &v
	}
	return st, true
}

func yearOf(ts int64) int {
	// days since epoch -> civil year (UTC)
	z := ts/86400 + 719468
	era := z / 146097
	doe := z - era*146097
	yoe := (doe - doe/1460 + doe/36524 - doe/146096) / 365
	y := yoe + era*400
	doy := doe - (365*yoe + yoe/4 - yoe/100)
	mp := (5*doy + 2) / 153
	if mp >= 10 {
		y++
	}
	return int(y)
}
