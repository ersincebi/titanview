package alerts

import (
	"math"
	"sort"

	"github.com/ersincebi/titanview/backend/internal/domain"
)

// PlotSource resolves indicator plot values (the engine runs the script study once per frame).
type PlotSource interface {
	PlotValue(s *Study, plot string, i int) (float64, bool)
}

// Frame is the candle window an alert is evaluated on.
type Frame struct {
	Candles []domain.Candle
	// Closed reports whether the last candle is final (the next bar has started or the feed said so).
	Closed bool
	// Step is the bar length in seconds (extrapolation of drawing lines into the future).
	Step  int64
	Plots PlotSource
}

// LastClosed returns the index of the newest closed candle (-1 when none).
func (f *Frame) LastClosed() int {
	n := len(f.Candles)
	if f.Closed {
		return n - 1
	}
	return n - 2
}

// State is the per-alert evaluation memory kept by the engine (not persisted: a restart re-arms crossings).
type State struct {
	HasPrev       bool
	Prev          Sample
	LastClosedBar int64 // bar time last evaluated in "once per bar close" mode
	LastFiredBar  int64 // bar time of the last firing
	LastFiredAt   int64 // unix ms of the last firing
	Recent        []int64
	// Script bookkeeping
	ScriptFired map[string]int64 // alert() frequency bucket → bar time it last fired
	LastFill  int64            // time of the newest strategy fill already notified
	FillsSeen int              // fills at LastFill already notified
	Primed    bool             // first script run only records fills, never notifies history
}

// Sample is the operand values at one point in time.
type Sample struct {
	L, R, Up, Lo float64
	OK           bool
}

// FieldValue returns a candle field (close by default).
func FieldValue(c domain.Candle, field string) float64 {
	switch field {
	case "open":
		return c.Open
	case "high":
		return c.High
	case "low":
		return c.Low
	case "hl2":
		return (c.High + c.Low) / 2
	case "hlc3":
		return (c.High + c.Low + c.Close) / 3
	case "ohlc4":
		return (c.Open + c.High + c.Low + c.Close) / 4
	case "volume":
		return c.Volume
	default:
		return c.Close
	}
}

// BarIndex maps a unix time onto the (fractional) bar index of the frame, extrapolating with step outside it.
// Drawings are straight in bar-index space, so this is how the chart itself places them across session gaps.
func BarIndex(c []domain.Candle, t, step int64) float64 {
	n := len(c)
	if n == 0 {
		return math.NaN()
	}
	if step <= 0 {
		step = 60
	}
	if t <= c[0].Timestamp {
		return float64(t-c[0].Timestamp) / float64(step)
	}
	if t >= c[n-1].Timestamp {
		return float64(n-1) + float64(t-c[n-1].Timestamp)/float64(step)
	}
	j := sort.Search(n, func(k int) bool { return c[k].Timestamp > t }) // c[j-1] <= t < c[j]
	a, b := c[j-1].Timestamp, c[j].Timestamp
	return float64(j-1) + float64(t-a)/float64(b-a)
}

// LineValue returns the line's price at bar index i (NaN outside a non-extended segment or for vertical lines).
func LineValue(l *Line, c []domain.Candle, step int64, i int) float64 {
	xa := BarIndex(c, l.A.Time, step)
	xb := BarIndex(c, l.B.Time, step)
	if math.IsNaN(xa) || math.IsNaN(xb) {
		return math.NaN()
	}
	x := float64(i)
	const eps = 1e-9
	lo, hi := math.Min(xa, xb), math.Max(xa, xb)
	if (!l.ExtendLeft && x < lo-eps) || (!l.ExtendRight && x > hi+eps) {
		return math.NaN()
	}
	if math.Abs(xb-xa) < eps {
		if l.A.Price == l.B.Price {
			return l.A.Price
		}
		return math.NaN()
	}
	return l.A.Price + (l.B.Price-l.A.Price)*(x-xa)/(xb-xa)
}

// OperandValue resolves one operand at bar index i.
func OperandValue(o *Operand, f *Frame, i int) float64 {
	if o == nil || i < 0 || i >= len(f.Candles) {
		return math.NaN()
	}
	switch o.Kind {
	case "price":
		return FieldValue(f.Candles[i], o.Field)
	case "value":
		return o.Value
	case "plot":
		if f.Plots == nil {
			return math.NaN()
		}
		if v, ok := f.Plots.PlotValue(o.Study, o.Plot, i); ok {
			return v
		}
		return math.NaN()
	case "line":
		if o.Line == nil {
			return math.NaN()
		}
		return LineValue(o.Line, f.Candles, f.Step, i)
	}
	return math.NaN()
}

// SampleAt reads every operand of a condition alert at bar i.
func SampleAt(a *Alert, f *Frame, i int) Sample {
	s := Sample{L: OperandValue(&a.Source, f, i), R: math.NaN(), Up: math.NaN(), Lo: math.NaN()}
	switch {
	case isChannel(a.Condition):
		u, l := OperandValue(a.Upper, f, i), OperandValue(a.Lower, f, i)
		s.Up, s.Lo = math.Max(u, l), math.Min(u, l)
		s.OK = finite(s.L) && finite(u) && finite(l)
	case isMoving(a.Condition):
		s.OK = finite(s.L)
	default:
		s.R = OperandValue(a.Target, f, i)
		s.OK = finite(s.L) && finite(s.R)
	}
	return s
}

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

// edgeCondition reports conditions that need a previous sample (they fire on a change, not a state).
func edgeCondition(c string) bool {
	switch c {
	case CondCrossing, CondCrossingUp, CondCrossingDown, CondEnteringChannel, CondExitingChannel:
		return true
	}
	return false
}

// ConditionMet evaluates the condition between prev and cur (cur at bar i, used for moving lookbacks).
func ConditionMet(a *Alert, f *Frame, prev Sample, havePrev bool, cur Sample, i int) bool {
	if !cur.OK {
		return false
	}
	if edgeCondition(a.Condition) && (!havePrev || !prev.OK) {
		return false
	}
	// "Crossing" fires when the value reaches the level (touch counts), "Greater/Less than"
	// only when it surpasses it; "Inside/Outside channel" need a strict breach, entering/exiting a reach.
	reached := func(s Sample) bool { return s.L >= s.Lo && s.L <= s.Up }
	switch a.Condition {
	case CondCrossingUp:
		return cur.L >= cur.R && prev.L < prev.R
	case CondCrossingDown:
		return cur.L <= cur.R && prev.L > prev.R
	case CondCrossing:
		return (cur.L >= cur.R && prev.L < prev.R) || (cur.L <= cur.R && prev.L > prev.R)
	case CondGreaterThan:
		return cur.L > cur.R
	case CondLessThan:
		return cur.L < cur.R
	case CondEnteringChannel:
		return !reached(prev) && reached(cur)
	case CondExitingChannel:
		return reached(prev) && !reached(cur)
	case CondInsideChannel:
		return cur.L > cur.Lo && cur.L < cur.Up
	case CondOutsideChannel:
		return cur.L < cur.Lo || cur.L > cur.Up
	case CondMovingUp, CondMovingDown, CondMovingUpPct, CondMovingDownPct:
		j := i - a.Bars
		if j < 0 {
			return false
		}
		base := OperandValue(&a.Source, f, j)
		if !finite(base) {
			return false
		}
		d := cur.L - base
		switch a.Condition {
		case CondMovingUp:
			return d >= a.Amount
		case CondMovingDown:
			return -d >= a.Amount
		case CondMovingUpPct:
			return base != 0 && d/math.Abs(base)*100 >= a.Amount
		default:
			return base != 0 && -d/math.Abs(base)*100 >= a.Amount
		}
	}
	return false
}

// EvalCondition evaluates a condition alert on the frame and returns the bar index that fired (or -1).
// It updates st (previous sample, last closed bar) but not the firing bookkeeping (see Gate).
func EvalCondition(a *Alert, f *Frame, st *State) int {
	n := len(f.Candles)
	if n == 0 {
		return -1
	}
	if a.Trigger == TrigOncePerBarClose {
		c := f.LastClosed()
		if c < 1 {
			return -1
		}
		bt := f.Candles[c].Timestamp
		if bt <= st.LastClosedBar {
			return -1
		}
		first := st.LastClosedBar == 0
		st.LastClosedBar = bt
		// never fire for a bar that closed before the alert existed (first look after create/restart)
		if first && (bt+f.Step)*1000 <= a.UpdatedAt {
			return -1
		}
		prev, cur := SampleAt(a, f, c-1), SampleAt(a, f, c)
		if ConditionMet(a, f, prev, true, cur, c) {
			return c
		}
		return -1
	}
	i := n - 1
	cur := SampleAt(a, f, i)
	prev, have := st.Prev, st.HasPrev
	if cur.OK {
		st.Prev, st.HasPrev = cur, true
	}
	if ConditionMet(a, f, prev, have, cur, i) {
		return i
	}
	return -1
}

// Gate applies the trigger frequency to a condition hit at bar time bt; true means notify now.
func Gate(a *Alert, st *State, bt, nowMs int64) bool {
	switch a.Trigger {
	case TrigOncePerBar:
		if st.LastFiredBar == bt && st.LastFiredAt != 0 {
			return false
		}
	case TrigOncePerMinute:
		if st.LastFiredAt != 0 && nowMs-st.LastFiredAt < 60_000 {
			return false
		}
	}
	st.LastFiredBar, st.LastFiredAt = bt, nowMs
	return true
}

// RateLimit records a firing and reports whether the alert exceeded the per-window rate limit
// (more than 15 firings within 3 minutes stops the alert).
func RateLimit(st *State, nowMs int64) bool {
	const window, limit = 3 * 60_000, 15
	keep := st.Recent[:0]
	for _, t := range st.Recent {
		if nowMs-t < window {
			keep = append(keep, t)
		}
	}
	st.Recent = append(keep, nowMs)
	return len(st.Recent) > limit
}
