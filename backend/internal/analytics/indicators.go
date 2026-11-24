package analytics

import (
	"math"

	"github.com/ersincebi/titanview/backend/internal/domain"
)

func closesOf(c []domain.Candle) []float64 {
	out := make([]float64, len(c))
	for i := range c {
		out[i] = c[i].Close
	}
	return out
}

// emaSeries returns the EMA of v (seeded with the SMA of the first n values); NaN before the seed.
func emaSeries(v []float64, n int) []float64 {
	out := make([]float64, len(v))
	for i := range out {
		out[i] = math.NaN()
	}
	if n < 1 || len(v) < n {
		return out
	}
	var sum float64
	for i := 0; i < n; i++ {
		sum += v[i]
	}
	out[n-1] = sum / float64(n)
	k := 2.0 / float64(n+1)
	for i := n; i < len(v); i++ {
		out[i] = v[i]*k + out[i-1]*(1-k)
	}
	return out
}

func lastOf(s []float64) (float64, bool) {
	if len(s) == 0 {
		return 0, false
	}
	v := s[len(s)-1]
	return v, !math.IsNaN(v)
}

// MACDLast returns the last MACD(12,26,9) line, signal and histogram.
func MACDLast(closes []float64) (macd, signal, hist float64, ok bool) {
	if len(closes) < 35 {
		return
	}
	e12, e26 := emaSeries(closes, 12), emaSeries(closes, 26)
	line := make([]float64, 0, len(closes))
	for i := range closes {
		if !math.IsNaN(e26[i]) {
			line = append(line, e12[i]-e26[i])
		}
	}
	sig := emaSeries(line, 9)
	m, ok1 := lastOf(line)
	s, ok2 := lastOf(sig)
	if !ok1 || !ok2 {
		return
	}
	return m, s, m - s, true
}

// ADXLast returns Wilder ADX(14) with +DI/-DI.
func ADXLast(c []domain.Candle, period int) (adx, plusDI, minusDI float64, ok bool) {
	n := len(c)
	if n < period*2+1 {
		return
	}
	var trS, pS, mS float64
	for i := 1; i <= period; i++ {
		trS += trueRange(c, i)
		up, dn := c[i].High-c[i-1].High, c[i-1].Low-c[i].Low
		if up > dn && up > 0 {
			pS += up
		}
		if dn > up && dn > 0 {
			mS += dn
		}
	}
	dx := func() float64 {
		if trS == 0 {
			return 0
		}
		p, m := 100*pS/trS, 100*mS/trS
		plusDI, minusDI = p, m
		if p+m == 0 {
			return 0
		}
		return 100 * math.Abs(p-m) / (p + m)
	}
	var dxs []float64
	dxs = append(dxs, dx())
	fp := float64(period)
	for i := period + 1; i < n; i++ {
		up, dn := c[i].High-c[i-1].High, c[i-1].Low-c[i].Low
		var pm, mm float64
		if up > dn && up > 0 {
			pm = up
		}
		if dn > up && dn > 0 {
			mm = dn
		}
		trS = trS - trS/fp + trueRange(c, i)
		pS = pS - pS/fp + pm
		mS = mS - mS/fp + mm
		dxs = append(dxs, dx())
	}
	if len(dxs) < period {
		return
	}
	a := 0.0
	for i := 0; i < period; i++ {
		a += dxs[i]
	}
	a /= fp
	for i := period; i < len(dxs); i++ {
		a = (a*(fp-1) + dxs[i]) / fp
	}
	return a, plusDI, minusDI, true
}

// SupertrendLast returns the Supertrend(period, mult) line and direction (+1 up / -1 down).
func SupertrendLast(c []domain.Candle, period int, mult float64) (line float64, dir int, ok bool) {
	n := len(c)
	if n < period+2 {
		return
	}
	atr := make([]float64, n)
	var s float64
	for i := 1; i <= period; i++ {
		s += trueRange(c, i)
	}
	atr[period] = s / float64(period)
	for i := period + 1; i < n; i++ {
		atr[i] = (atr[i-1]*float64(period-1) + trueRange(c, i)) / float64(period)
	}
	var fu, fl float64
	dir = 1
	for i := period; i < n; i++ {
		hl2 := (c[i].High + c[i].Low) / 2
		bu, bl := hl2+mult*atr[i], hl2-mult*atr[i]
		if i == period {
			fu, fl = bu, bl
			continue
		}
		pc := c[i-1].Close
		if bu < fu || pc > fu {
			fu = bu
		}
		if bl > fl || pc < fl {
			fl = bl
		}
		if dir == 1 && c[i].Close < fl {
			dir = -1
		} else if dir == -1 && c[i].Close > fu {
			dir = 1
		}
	}
	if dir == 1 {
		return fl, 1, true
	}
	return fu, -1, true
}

func hhll(c []domain.Candle, end, n int) (hi, lo float64, ok bool) {
	if end+1 < n || end >= len(c) {
		return
	}
	hi, lo = c[end].High, c[end].Low
	for i := end - n + 1; i <= end; i++ {
		hi = math.Max(hi, c[i].High)
		lo = math.Min(lo, c[i].Low)
	}
	return hi, lo, true
}

// IchimokuState is the last tenkan/kijun and the cloud (spans projected 26 bars ahead, so the cloud
// "now" is the one computed 26 bars ago).
type IchimokuState struct {
	Tenkan, Kijun, SpanA, SpanB float64
}

func IchimokuLast(c []domain.Candle) (IchimokuState, bool) {
	n := len(c)
	if n < 52+26 {
		return IchimokuState{}, false
	}
	mid := func(end, p int) float64 {
		h, l, _ := hhll(c, end, p)
		return (h + l) / 2
	}
	st := IchimokuState{Tenkan: mid(n-1, 9), Kijun: mid(n-1, 26)}
	e := n - 1 - 26
	st.SpanA = (mid(e, 9) + mid(e, 26)) / 2
	st.SpanB = mid(e, 52)
	return st, true
}

// StochRSILast returns %K and %D (14,14,3,3) on a 0..100 scale.
func StochRSILast(closes []float64) (k, d float64, ok bool) {
	const p = 14
	if len(closes) < p*3+6 {
		return
	}
	var rsis []float64
	for i := p + 1; i <= len(closes); i++ {
		r, ok2 := RSIWilder(closes[:i], p)
		if !ok2 {
			continue
		}
		rsis = append(rsis, r)
	}
	if len(rsis) < p+5 {
		return
	}
	raw := make([]float64, 0, len(rsis))
	for i := p - 1; i < len(rsis); i++ {
		lo, hi := rsis[i], rsis[i]
		for j := i - p + 1; j <= i; j++ {
			lo, hi = math.Min(lo, rsis[j]), math.Max(hi, rsis[j])
		}
		if hi == lo {
			raw = append(raw, 50)
		} else {
			raw = append(raw, 100*(rsis[i]-lo)/(hi-lo))
		}
	}
	ks := sma(raw, 3)
	ds := sma(ks, 3)
	if len(ks) == 0 || len(ds) == 0 {
		return
	}
	return ks[len(ks)-1], ds[len(ds)-1], true
}

func sma(v []float64, n int) []float64 {
	if len(v) < n {
		return nil
	}
	out := make([]float64, 0, len(v)-n+1)
	var s float64
	for i, x := range v {
		s += x
		if i >= n {
			s -= v[i-n]
		}
		if i >= n-1 {
			out = append(out, s/float64(n))
		}
	}
	return out
}

// OBVSeries is on-balance volume.
func OBVSeries(c []domain.Candle) []float64 {
	out := make([]float64, len(c))
	for i := 1; i < len(c); i++ {
		out[i] = out[i-1]
		switch {
		case c[i].Close > c[i-1].Close:
			out[i] += c[i].Volume
		case c[i].Close < c[i-1].Close:
			out[i] -= c[i].Volume
		}
	}
	return out
}

// CMFLast is Chaikin Money Flow over n bars (-1..1).
func CMFLast(c []domain.Candle, n int) (float64, bool) {
	if len(c) < n {
		return 0, false
	}
	var mfv, vol float64
	for _, b := range c[len(c)-n:] {
		rng := b.High - b.Low
		if rng > 0 {
			mfv += ((b.Close - b.Low) - (b.High - b.Close)) / rng * b.Volume
		}
		vol += b.Volume
	}
	if vol == 0 {
		return 0, false
	}
	return mfv / vol, true
}
