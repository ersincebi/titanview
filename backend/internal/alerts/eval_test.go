package alerts

import (
	"math"
	"strings"
	"testing"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
	"github.com/ersincebi/titanview/backend/internal/scriptjs"
)

// closes builds a test-only candle series from close prices (60 s bars).
func closes(vals ...float64) []domain.Candle {
	out := make([]domain.Candle, len(vals))
	for i, v := range vals {
		out[i] = domain.Candle{Timestamp: 1_000_000 + int64(i)*60, Open: v, High: v + 1, Low: v - 1, Close: v, Volume: 10 * float64(i+1)}
	}
	return out
}

func val(v float64) *Operand { return &Operand{Kind: "value", Value: v} }

func condAlert(cond string, target *Operand) *Alert {
	return &Alert{Symbol: "BTCUSDT", Interval: "1m", Source: Operand{Kind: "price"}, Condition: cond, Target: target, Trigger: TrigOncePerBar}
}

// stepBars evaluates the alert as if each bar arrived live (one tick per bar) and returns firing indexes.
func stepBars(a *Alert, cs []domain.Candle) []int {
	st := &State{}
	var fired []int
	for n := 1; n <= len(cs); n++ {
		f := &Frame{Candles: cs[:n], Step: 60}
		if i := EvalCondition(a, f, st); i >= 0 {
			fired = append(fired, i)
		}
	}
	return fired
}

func eqInts(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestConditionsCrossingsAndLevels(t *testing.T) {
	cs := closes(90, 95, 101, 99, 103, 97)
	cases := []struct {
		cond string
		want []int
	}{
		{CondCrossingUp, []int{2, 4}},
		{CondCrossingDown, []int{3, 5}},
		{CondCrossing, []int{2, 3, 4, 5}},
		{CondGreaterThan, []int{2, 4}},
		{CondLessThan, []int{0, 1, 3, 5}},
	}
	for _, c := range cases {
		if got := stepBars(condAlert(c.cond, val(100)), cs); !eqInts(got, c.want) {
			t.Errorf("%s: got %v want %v", c.cond, got, c.want)
		}
	}
	// a crossing never fires on the very first look (no previous sample)
	if got := stepBars(condAlert(CondCrossingUp, val(100)), closes(150)); len(got) != 0 {
		t.Fatalf("first sample fired: %v", got)
	}
	// Varsayılan: reaching the level exactly is a crossing (BTC "reaches exactly $100,000")...
	if got := stepBars(condAlert(CondCrossingUp, val(100)), closes(99, 100, 99)); !eqInts(got, []int{1}) {
		t.Fatalf("touch must fire: %v", got)
	}
	// ...leaving from the level is not a new crossing up
	if got := stepBars(condAlert(CondCrossingUp, val(100)), closes(100, 101, 102)); len(got) != 0 {
		t.Fatalf("from level: %v", got)
	}
	if got := stepBars(condAlert(CondCrossing, val(100)), closes(101, 100, 100, 99)); !eqInts(got, []int{1}) {
		t.Fatalf("crossing down to level: %v", got)
	}
	// greater than needs a surpass, not a touch
	if got := stepBars(condAlert(CondGreaterThan, val(100)), closes(100)); len(got) != 0 {
		t.Fatalf("greater on touch: %v", got)
	}
}

func TestChannelConditions(t *testing.T) {
	cs := closes(80, 95, 105, 120, 110, 70, 90)
	mk := func(c string) *Alert {
		a := condAlert(c, nil)
		a.Upper, a.Lower = val(90), val(110) // swapped on purpose: min/max are normalised
		return a
	}
	cases := map[string][]int{
		CondEnteringChannel: {1, 4, 6}, // 110 and 90 reach the bounds
		CondExitingChannel:  {3, 5},
		CondInsideChannel:   {1, 2},    // boundaries (110, 90) are not strictly inside
		CondOutsideChannel:  {0, 3, 5}, // ...nor strictly outside
	}
	for c, want := range cases {
		if got := stepBars(mk(c), cs); !eqInts(got, want) {
			t.Errorf("%s: got %v want %v", c, got, want)
		}
	}
}

func TestMovingConditions(t *testing.T) {
	cs := closes(100, 101, 104, 103, 99, 95)
	mk := func(c string, amt float64, bars int) *Alert {
		a := condAlert(c, nil)
		a.Amount, a.Bars = amt, bars
		return a
	}
	if got := stepBars(mk(CondMovingUp, 3, 2), cs); !eqInts(got, []int{2}) {
		t.Fatalf("moving up: %v", got)
	}
	if got := stepBars(mk(CondMovingDown, 4, 2), cs); !eqInts(got, []int{4, 5}) {
		t.Fatalf("moving down: %v", got)
	}
	if got := stepBars(mk(CondMovingUpPct, 4.5, 2), cs); len(got) != 0 {
		t.Fatalf("moving up %%: %v", got)
	}
	if got := stepBars(mk(CondMovingUpPct, 3, 2), cs); !eqInts(got, []int{2}) {
		t.Fatalf("moving up 3%%: %v", got)
	}
	if got := stepBars(mk(CondMovingDownPct, 7.5, 3), cs); !eqInts(got, []int{5}) {
		t.Fatalf("moving down %%: %v", got)
	}
}

func TestBarCloseTrigger(t *testing.T) {
	a := condAlert(CondCrossingUp, val(100))
	a.Trigger = TrigOncePerBarClose
	st := &State{}
	cs := closes(90, 99, 105)
	// bar 2 is still forming: crossing intrabar is ignored in bar-close mode
	if i := EvalCondition(a, &Frame{Candles: cs, Step: 60}, st); i != -1 {
		t.Fatalf("forming bar fired: %d", i)
	}
	// bar 2 closes
	if i := EvalCondition(a, &Frame{Candles: cs, Step: 60, Closed: true}, st); i != 2 {
		t.Fatalf("closed bar not fired: %d", i)
	}
	// same closed bar is only evaluated once
	if i := EvalCondition(a, &Frame{Candles: cs, Step: 60, Closed: true}, st); i != -1 {
		t.Fatalf("closed bar fired twice: %d", i)
	}
	// bars that closed before the alert was created/edited never fire
	b := condAlert(CondCrossingUp, val(100))
	b.Trigger, b.UpdatedAt = TrigOncePerBarClose, (cs[2].Timestamp+600)*1000
	if i := EvalCondition(b, &Frame{Candles: cs, Step: 60, Closed: true}, &State{}); i != -1 {
		t.Fatalf("pre-creation bar fired: %d", i)
	}
	if (&Frame{Candles: cs[:1]}).LastClosed() != -1 || EvalCondition(a, &Frame{}, st) != -1 {
		t.Fatal("empty/one-bar frames")
	}
}

func TestGateAndRateLimit(t *testing.T) {
	st := &State{}
	a := &Alert{Trigger: TrigOncePerBar}
	if !Gate(a, st, 100, 1000) || Gate(a, st, 100, 2000) || !Gate(a, st, 160, 3000) {
		t.Fatal("once per bar")
	}
	m := &Alert{Trigger: TrigOncePerMinute}
	st = &State{}
	if !Gate(m, st, 1, 0+1) || Gate(m, st, 2, 59_000) || !Gate(m, st, 3, 61_002) {
		t.Fatal("once per minute")
	}
	o := &Alert{Trigger: TrigOnce}
	if !Gate(o, &State{}, 1, 1) {
		t.Fatal("once")
	}
	st = &State{}
	for i := 0; i < 15; i++ {
		if RateLimit(st, int64(i)*1000) {
			t.Fatalf("limited at %d", i)
		}
	}
	if !RateLimit(st, 16_000) {
		t.Fatal("16th firing within 3 min must stop the alert")
	}
	st = &State{Recent: []int64{0, 1, 2}}
	if RateLimit(st, 10*60_000) || len(st.Recent) != 1 {
		t.Fatal("old firings expire")
	}
}

func TestBarIndexAndLines(t *testing.T) {
	// a session gap: bars at 0,60,120 then 1000,1060 (gap between index 2 and 3)
	cs := []domain.Candle{{Timestamp: 0}, {Timestamp: 60}, {Timestamp: 120}, {Timestamp: 1000}, {Timestamp: 1060}}
	for _, c := range []struct {
		t    int64
		want float64
	}{{-60, -1}, {0, 0}, {90, 1.5}, {560, 2.5}, {1060, 4}, {1180, 6}} {
		if got := BarIndex(cs, c.t, 60); math.Abs(got-c.want) > 1e-9 {
			t.Errorf("BarIndex(%d)=%v want %v", c.t, got, c.want)
		}
	}
	if !math.IsNaN(BarIndex(nil, 5, 60)) || BarIndex(cs[:1], 120, 0) != 2 {
		t.Fatal("BarIndex edge cases")
	}
	// line from bar 0 @100 to bar 4 @140: +10 per bar in index space despite the time gap
	l := &Line{A: Point{0, 100}, B: Point{1060, 140}}
	if v := LineValue(l, cs, 60, 3); math.Abs(v-130) > 1e-9 {
		t.Fatalf("line@3=%v", v)
	}
	if !math.IsNaN(LineValue(l, cs, 60, 6)) {
		t.Fatal("segment must not extend")
	}
	l.ExtendRight = true
	if v := LineValue(l, cs, 60, 6); math.Abs(v-160) > 1e-9 {
		t.Fatalf("extended line@6=%v", v)
	}
	// horizontal line drawn as a single time anchor
	h := &Line{A: Point{60, 50}, B: Point{60, 50}, ExtendLeft: true, ExtendRight: true}
	if LineValue(h, cs, 60, 4) != 50 {
		t.Fatal("hline")
	}
	if !math.IsNaN(LineValue(&Line{A: Point{60, 1}, B: Point{60, 2}}, cs, 60, 1)) {
		t.Fatal("vertical line is NaN")
	}
}

func TestDrawingTrendlineAlert(t *testing.T) {
	// rising trend line 100 → 105 over 5 bars; price crosses it upward at bar 4
	cs := closes(90, 95, 98, 102, 110)
	a := condAlert(CondCrossingUp, &Operand{Kind: "line", Line: &Line{A: Point{cs[0].Timestamp, 100}, B: Point{cs[4].Timestamp, 104}, ExtendRight: true}})
	if got := stepBars(a, cs); !eqInts(got, []int{4}) {
		t.Fatalf("trend line cross: %v", got)
	}
	// channel from two parallel lines
	ch := condAlert(CondExitingChannel, nil)
	ch.Upper = &Operand{Kind: "line", Line: &Line{A: Point{cs[0].Timestamp, 100}, B: Point{cs[1].Timestamp, 101}, ExtendRight: true}}
	ch.Lower = &Operand{Kind: "line", Line: &Line{A: Point{cs[0].Timestamp, 92}, B: Point{cs[1].Timestamp, 93}, ExtendRight: true}}
	if got := stepBars(ch, cs); !eqInts(got, []int{4}) {
		t.Fatalf("channel exit: %v", got)
	}
}

type fakePlots map[string][]float64

func (f fakePlots) PlotValue(_ *Study, plot string, i int) (float64, bool) {
	v, ok := f[plot]
	if !ok || i >= len(v) || math.IsNaN(v[i]) {
		return 0, false
	}
	return v[i], true
}

func TestOperandKinds(t *testing.T) {
	cs := closes(10, 20)
	f := &Frame{Candles: cs, Step: 60, Plots: fakePlots{"RSI": {math.NaN(), 71}}}
	for field, want := range map[string]float64{"": 20, "open": 20, "high": 21, "low": 19, "hl2": 20, "hlc3": 20, "ohlc4": 20, "volume": 20} {
		if v := OperandValue(&Operand{Kind: "price", Field: field}, f, 1); v != want {
			t.Errorf("field %q = %v", field, v)
		}
	}
	if v := OperandValue(&Operand{Kind: "plot", Plot: "RSI", Study: &Study{}}, f, 1); v != 71 {
		t.Fatal("plot")
	}
	if !math.IsNaN(OperandValue(&Operand{Kind: "plot", Plot: "RSI"}, f, 0)) || !math.IsNaN(OperandValue(&Operand{Kind: "plot", Plot: "RSI"}, &Frame{Candles: cs}, 1)) {
		t.Fatal("na plot")
	}
	if !math.IsNaN(OperandValue(nil, f, 0)) || !math.IsNaN(OperandValue(&Operand{Kind: "x"}, f, 0)) || !math.IsNaN(OperandValue(&Operand{Kind: "line"}, f, 0)) || !math.IsNaN(OperandValue(val(1), f, 9)) {
		t.Fatal("invalid operands are NaN")
	}
	// RSI > 70 on an indicator plot
	a := &Alert{Source: Operand{Kind: "plot", Plot: "RSI"}, Condition: CondGreaterThan, Target: val(70), Trigger: TrigOncePerBar}
	if EvalCondition(a, f, &State{}) != 1 {
		t.Fatal("plot alert")
	}
}

func TestNormalizeValidation(t *testing.T) {
	ok := Alert{Symbol: " btcusdt ", Interval: "1H", Condition: CondCrossing, Target: val(1)}
	if err := ok.Normalize(); err != nil || ok.Symbol != "BTCUSDT" || ok.Interval != "1h" || ok.Trigger != TrigOnce || ok.Kind != KindCondition || ok.Source.Kind != "price" {
		t.Fatalf("normalize: %v %+v", err, ok)
	}
	study := &Study{Name: "RSI", Code: "indicator('x')"}
	bad := []Alert{
		{},
		{Symbol: "X", Interval: "7q", Condition: CondCrossing, Target: val(1)},
		{Symbol: "X", Condition: CondCrossing},
		{Symbol: "X", Condition: "nope", Target: val(1)},
		{Symbol: "X", Condition: CondCrossing, Target: val(1), Trigger: "sometimes"},
		{Symbol: "X", Condition: CondCrossing, Target: val(1), Notify: Notify{Webhook: "ftp://x"}},
		{Symbol: "X", Condition: CondEnteringChannel, Upper: val(1)},
		{Symbol: "X", Condition: CondEnteringChannel, Upper: val(1), Lower: &Operand{Kind: "line"}},
		{Symbol: "X", Condition: CondMovingUp, Amount: 0, Bars: 1},
		{Symbol: "X", Condition: CondMovingUp, Amount: 1, Bars: 0},
		{Symbol: "X", Condition: CondCrossing, Target: &Operand{Kind: "price", Field: "vwap"}},
		{Symbol: "X", Condition: CondCrossing, Target: &Operand{Kind: "value", Value: math.NaN()}},
		{Symbol: "X", Condition: CondCrossing, Target: &Operand{Kind: "plot", Study: study}},
		{Symbol: "X", Condition: CondCrossing, Target: &Operand{Kind: "plot", Plot: "a"}},
		{Symbol: "X", Condition: CondCrossing, Target: &Operand{Kind: "line", Line: &Line{}}},
		{Symbol: "X", Condition: CondCrossing, Target: &Operand{Kind: "zzz"}},
		{Symbol: "X", Source: Operand{Kind: "value"}, Condition: CondCrossing, Target: val(1)},
		{Symbol: "X", Kind: KindScript},
		{Symbol: "X", Kind: KindScript, Study: study, ScriptEvent: "x"},
		{Symbol: "X", Kind: KindScript, Study: study, ScriptEvent: ScriptAlertCondition},
		{Symbol: "X", Kind: "other"},
		{Symbol: "X", Kind: KindScript, Study: &Study{Code: strings.Repeat("a", maxCodeBytes+1)}, ScriptEvent: ScriptAlertCalls},
		{Symbol: "X", Name: strings.Repeat("n", 121), Condition: CondCrossing, Target: val(1)},
	}
	for i, b := range bad {
		if err := b.Normalize(); err == nil {
			t.Errorf("case %d must fail: %+v", i, b)
		}
	}
	good := []Alert{
		{Symbol: "X", Kind: KindScript, Study: study, ScriptEvent: ScriptAlertCondition, ConditionTitle: "Al"},
		{Symbol: "X", Kind: KindScript, Study: study, ScriptEvent: ScriptOrderFills},
		{Symbol: "X", Condition: CondMovingDownPct, Amount: 2, Bars: 5, Notify: Notify{Webhook: "https://example.com/h"}},
		{Symbol: "X", Condition: CondInsideChannel, Upper: val(1), Lower: &Operand{Kind: "line", Line: &Line{A: Point{1, 1}, B: Point{2, 2}}}},
		{Symbol: "X", Source: Operand{Kind: "plot", Study: study, Plot: "RSI"}, Condition: CondLessThan, Target: &Operand{Kind: "plot", Study: study, Plot: "MA"}},
	}
	for i, g := range good {
		if err := g.Normalize(); err != nil {
			t.Errorf("good case %d: %v", i, err)
		}
	}
	if n := len(good[4].Studies()); n != 2 {
		t.Fatalf("studies: %d", n)
	}
	if n := len(good[0].Studies()); n != 1 {
		t.Fatalf("script studies: %d", n)
	}
}

func TestTemplateRender(t *testing.T) {
	out := &scriptjs.Output{Plots: []scriptjs.Plot{{ID: "p0", Title: "RSI", Values: []*float64{ptr(71.25)}}}}
	c := TemplateCtx{
		Symbol: "THYAO.IS", Interval: "15m", Now: time.Date(2026, 11, 22, 10, 0, 0, 0, time.UTC),
		Candle: domain.Candle{Timestamp: 1_700_000_000, Open: 1, High: 2.5, Low: 0.5, Close: 2.10000001, Volume: 1234},
		Script: out, BarIndex: 0,
		Fill: &scriptjs.Fill{Action: "buy", Qty: 3, Price: 280.5, ID: "L", Comment: "giriş", PositionSize: 3},
	}
	msg := Render(`{{ticker}} {{exchange}} {{symbol}} {{interval}} o={{open}} h={{high}} l={{low}} c={{close}} v={{volume}} {{time}} {{timenow}} {{plot_0}} {{plot("RSI")}} {{plot_7}} {{strategy.order.action}} {{strategy.order.contracts}} {{strategy.order.price}} {{strategy.order.id}} {{strategy.order.comment}} {{strategy.position_size}} {{strategy.market_position}} {{unknown}}`, c)
	want := `THYAO BIST THYAO.IS 15m o=1 h=2.5 l=0.5 c=2.10000001 v=1234 2023-11-14T22:13:20Z 2026-11-22T10:00:00Z 71.25 71.25 NaN buy 3 280.5 L giriş 3 long {{unknown}}`
	if msg != want {
		t.Fatalf("render:\n got %s\nwant %s", msg, want)
	}
	if exchangeOf("BTCUSDT") != "BINANCE" || exchangeOf("AAPL") != "US" {
		t.Fatalf("exchange %s %s", exchangeOf("BTCUSDT"), exchangeOf("AAPL"))
	}
	for size, want := range map[float64]string{-1: "short", 0: "flat"} {
		c.Fill.PositionSize = size
		if got := Render("{{strategy.market_position}}", c); got != want {
			t.Fatalf("market position %v: %s", size, got)
		}
	}
	if FormatNumber(65000) != "65000" || FormatNumber(0.00012) != "0.00012" {
		t.Fatal("FormatNumber")
	}
}

func ptr(v float64) *float64 { return &v }

func TestDefaultMessage(t *testing.T) {
	study := &Study{Name: "RSI", Code: "x"}
	cases := map[string]*Alert{
		"{{ticker}} Yukarı kesişim 65000":            condAlert(CondCrossingUp, val(65000)),
		"{{ticker}} Kanala giriyor":                  {Condition: CondEnteringChannel},
		"{{ticker}} Yukarı hareket % 2% / 5 bar":     {Condition: CondMovingUpPct, Amount: 2, Bars: 5},
		"{{ticker}} Aşağı hareket 10 / 3 bar":        {Condition: CondMovingDown, Amount: 10, Bars: 3},
		"RSI RSI Büyüktür RSI MA":                    {Source: Operand{Kind: "plot", Study: study, Plot: "RSI"}, Condition: CondGreaterThan, Target: &Operand{Kind: "plot", Study: study, Plot: "MA"}},
		"{{ticker}} Kesişim çizgi":                   {Condition: CondCrossing, Target: &Operand{Kind: "line"}},
		"{{ticker}} Küçüktür open":                   {Condition: CondLessThan, Target: &Operand{Kind: "price", Field: "open"}},
	}
	for want, a := range cases {
		if got := DefaultMessage(a); got != want {
			t.Errorf("got %q want %q", got, want)
		}
	}
}
