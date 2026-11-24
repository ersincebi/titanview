package scriptjs

import (
	"math"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
)

// testCandles: deterministic sine walk (test-only fixture, never served).
func testCandles(n int, start int64, step int64) []domain.Candle {
	out := make([]domain.Candle, n)
	for i := 0; i < n; i++ {
		c := 100 + 10*math.Sin(float64(i)/7) + float64(i)*0.05
		o := c - 0.4*math.Cos(float64(i)/3)
		out[i] = domain.Candle{Timestamp: start + int64(i)*step, Open: o, High: math.Max(o, c) + 0.5, Low: math.Min(o, c) - 0.5, Close: c, Volume: 1000 + float64(i)}
	}
	return out
}

func mustRunner(t *testing.T) *Runner {
	t.Helper()
	r, err := NewRunner()
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestRunIndicatorPlotsAndAlertCondition(t *testing.T) {
	r := mustRunner(t)
	code := `//@version=6
indicator("RSI test")
r = ta.rsi(close, 14)
plot(r, "RSI")
plot(ta.sma(close, 5), "SMA5")
alertcondition(r > 0, "RSI pozitif", "RSI {{plot_0}} @ {{close}}")
alertcondition(r > 1000, "Asla", "yok")`
	c := testCandles(200, 1_700_000_000, 900)
	out, err := r.Run(Input{Code: code, Candles: c, Symbol: "BTCUSDT", Timeframe: "15"}, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if !out.OK {
		t.Fatalf("not ok: %s", out.Error)
	}
	if len(out.Plots) != 2 || out.Plots[0].Title != "RSI" || len(out.Plots[0].Values) != 200 {
		t.Fatalf("plots: %+v", out.Plots)
	}
	if v, ok := out.PlotValue("RSI", 199); !ok || v <= 0 || v >= 100 {
		t.Fatalf("rsi last = %v %v", v, ok)
	}
	if _, ok := out.PlotValue("RSI", 3); ok {
		t.Fatal("RSI warm-up bars must be na")
	}
	if v, ok := out.PlotValue("plot_1", 199); !ok || math.Abs(v-sma(c, 5)) > 1e-9 {
		t.Fatalf("sma via plot_1 = %v want %v", v, sma(c, 5))
	}
	if out.FindPlot("nope") != nil {
		t.Fatal("unknown plot must be nil")
	}
	if len(out.AlertConditions) != 2 || out.AlertConditions[0].Title != "RSI pozitif" || out.AlertConditions[1].Message != "yok" {
		t.Fatalf("conditions: %+v", out.AlertConditions)
	}
	if len(out.Alerts) != 1 || out.Alerts[0].Kind != "alertcondition" || out.Alerts[0].Title != "RSI pozitif" || out.Alerts[0].Time != c[199].Timestamp {
		t.Fatalf("alerts: %+v", out.Alerts)
	}
}

func sma(c []domain.Candle, n int) float64 {
	s := 0.0
	for _, x := range c[len(c)-n:] {
		s += x.Close
	}
	return s / float64(n)
}

func TestRunStrategyFillsAndAlertFreq(t *testing.T) {
	r := mustRunner(t)
	code := `//@version=6
strategy("Cross", overlay=true)
f = ta.sma(close, 5)
s = ta.sma(close, 20)
if ta.crossover(f, s)
    strategy.entry("L", strategy.long)
if ta.crossunder(f, s)
    strategy.close("L")
alert("son bar " + str.tostring(close), alert.freq_all)`
	out, err := r.Run(Input{Code: code, Candles: testCandles(300, 1_700_000_000, 3600), Timeframe: "60"}, 5*time.Second)
	if err != nil || !out.OK {
		t.Fatalf("err=%v out=%+v", err, out)
	}
	if !out.IsStrategy || len(out.Fills) < 2 {
		t.Fatalf("fills: %+v", out.Fills)
	}
	if out.Fills[0].Action != "buy" || out.Fills[0].PositionSize <= 0 || out.Fills[1].Action != "sell" || out.Fills[1].PositionSize != 0 {
		t.Fatalf("fill order: %+v", out.Fills[:2])
	}
	if len(out.Alerts) != 1 || out.Alerts[0].Kind != "alert" || out.Alerts[0].Freq != "all" || !strings.HasPrefix(out.Alerts[0].Message, "son bar ") {
		t.Fatalf("alerts: %+v", out.Alerts)
	}
}

func TestRunErrorsAndTimeout(t *testing.T) {
	r := mustRunner(t)
	out, err := r.Run(Input{Code: "indicator(\"x\")\nplot(", Candles: testCandles(10, 0, 60)}, time.Second)
	if err != nil || out.OK || out.Error == "" {
		t.Fatalf("syntax error expected: %v %+v", err, out)
	}
	out, err = r.Run(Input{Code: "indicator(\"x\")\nplot(close)", Candles: nil}, time.Second)
	if err != nil || out.OK {
		t.Fatalf("empty candles must fail: %v %+v", err, out)
	}
	_, err = r.Run(Input{Code: "//@version=6\nindicator(\"loop\")\nvar x = 0\nwhile true\n    x += 1\nplot(x)", Candles: testCandles(5, 0, 60)}, 300*time.Millisecond)
	if err == nil {
		// the VM's own loop guard may stop it first; either way it must not hang
		t.Log("loop stopped by VM guard")
	}
	// the runner stays usable after an interrupt
	out, err = r.Run(Input{Code: "indicator(\"ok\")\nplot(close)", Candles: testCandles(5, 0, 60)}, time.Second)
	if err != nil || !out.OK {
		t.Fatalf("runner unusable after interrupt: %v %+v", err, out)
	}
}

func TestIntlPolyfillSessions(t *testing.T) {
	r := mustRunner(t)
	// 2024-01-02 07:00 UTC = 10:00 Europe/Istanbul: inside the BIST session 1000-1800
	code := `//@version=6
indicator("tz")
plot(hour(time, "Europe/Istanbul"), "h")
plot(na(time(timeframe.period, "1000-1800", "Europe/Istanbul")) ? 0 : 1, "in")`
	start := time.Date(2024, 1, 2, 6, 0, 0, 0, time.UTC).Unix()
	out, err := r.Run(Input{Code: code, Candles: testCandles(4, start, 3600), Timeframe: "60"}, 2*time.Second)
	if err != nil || !out.OK {
		t.Fatalf("%v %+v", err, out)
	}
	want := []float64{9, 10, 11, 12}
	for i, w := range want {
		if v, _ := out.PlotValue("h", i); v != w {
			t.Fatalf("hour[%d]=%v want %v", i, v, w)
		}
	}
	if v, _ := out.PlotValue("in", 0); v != 0 {
		t.Fatal("09:00 must be outside session")
	}
	if v, _ := out.PlotValue("in", 1); v != 1 {
		t.Fatal("10:00 must be inside session")
	}
	if !tzValid("Europe/Istanbul") || tzValid("Mars/Base") {
		t.Fatal("tzValid")
	}
	if p := tzParts("Nope/Zone", 0); p[3]["value"] != "1970" {
		t.Fatalf("invalid zone falls back to UTC: %v", p)
	}
}

func TestPoolConcurrent(t *testing.T) {
	p := NewPool(2)
	c := testCandles(120, 0, 60)
	var wg sync.WaitGroup
	errs := make(chan error, 6)
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			out, err := p.Run(Input{Code: "indicator(\"p\")\nplot(ta.ema(close, 9))", Candles: c}, 5*time.Second)
			if err == nil && !out.OK {
				err = errString(out.Error)
			}
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if p.n > 2 {
		t.Fatalf("pool grew past size: %d", p.n)
	}
	if NewPool(0).sz != 1 {
		t.Fatal("min pool size 1")
	}
}

func TestPhase24MagnifierAndHotTaFallback(t *testing.T) {
	r := mustRunner(t)
	// goja'da WebAssembly yok: sıcak ta.* (sma/ema/rma/wma/stdev/dev/linreg/cci/highest/lowest) TS'ye temiz düşer.
	taCode := `//@version=6
indicator("hot")
plot(ta.dev(close, 10), "dev")
plot(ta.linreg(close, 10, 0), "lr")
plot(ta.cci(close, 10), "cci")
plot(ta.stdev(close, 10), "sd")`
	out, err := r.Run(Input{Code: taCode, Candles: testCandles(60, 1_700_000_000, 3600), Timeframe: "60"}, 5*time.Second)
	if err != nil || !out.OK {
		t.Fatalf("hot ta fallback failed: err=%v out=%+v", err, out)
	}
	for _, name := range []string{"dev", "lr", "cci", "sd"} {
		if _, ok := out.PlotValue(name, 59); !ok {
			t.Fatalf("missing plot value for %s", name)
		}
	}

	// Bar büyüteci: bar 2 içinde TP (108) ve SL (92) birlikte; büyüteçsiz TP, alt mumlar önce düşüş gösterirse SL.
	const t0 = int64(1_700_000_000)
	const h = int64(3600)
	main := []domain.Candle{
		{Timestamp: t0, Open: 100, High: 101, Low: 99, Close: 100, Volume: 1},
		{Timestamp: t0 + h, Open: 100, High: 101, Low: 99, Close: 100, Volume: 1},
		{Timestamp: t0 + 2*h, Open: 100, High: 110, Low: 90, Close: 105, Volume: 1},
		{Timestamp: t0 + 3*h, Open: 105, High: 106, Low: 104, Close: 105, Volume: 1},
	}
	sub := []domain.Candle{
		{Timestamp: t0 + 2*h, Open: 100, High: 101, Low: 90, Close: 91, Volume: 1},
		{Timestamp: t0 + 2*h + 1800, Open: 91, High: 110, Low: 91, Close: 105, Volume: 1},
	}
	strat := `//@version=5
strategy("mag", overlay=true)
if bar_index == 0
    strategy.entry("L", strategy.long)
strategy.exit("X", "L", limit=108, stop=92)`
	noMag, err := r.Run(Input{Code: strat, Candles: main, Mintick: 1}, 5*time.Second)
	if err != nil || !noMag.OK || len(noMag.Fills) < 2 {
		t.Fatalf("noMag: err=%v out=%+v", err, noMag)
	}
	withMag, err := r.Run(Input{Code: strat, Candles: main, MagnifierCandles: sub, Mintick: 1}, 5*time.Second)
	if err != nil || !withMag.OK || len(withMag.Fills) < 2 {
		t.Fatalf("withMag: err=%v out=%+v", err, withMag)
	}
	if noMag.Fills[1].Price != 108 || withMag.Fills[1].Price != 92 {
		t.Fatalf("magnifier fill mismatch: noMag=%v withMag=%v", noMag.Fills[1].Price, withMag.Fills[1].Price)
	}
}

type errString string

func (e errString) Error() string { return string(e) }
