package alerts

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
	"github.com/ersincebi/titanview/backend/internal/scriptjs"
)

type fakeHistory struct {
	mu   sync.Mutex
	data map[string][]domain.Candle
	err  error
}

func (h *fakeHistory) Candles(_ context.Context, sym, tf string, bars int) ([]domain.Candle, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.err != nil {
		return nil, h.err
	}
	cs := h.data[sym+"|"+tf]
	if len(cs) > bars {
		cs = cs[len(cs)-bars:]
	}
	return append([]domain.Candle(nil), cs...), nil
}

type fakeLive struct {
	mu  sync.Mutex
	fns map[string]func(domain.LiveCandleMessage)
}

func (l *fakeLive) Watch(sym, tf string, fn func(domain.LiveCandleMessage)) func() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.fns == nil {
		l.fns = map[string]func(domain.LiveCandleMessage){}
	}
	l.fns[sym+"|"+tf] = fn
	return func() {
		l.mu.Lock()
		delete(l.fns, sym+"|"+tf)
		l.mu.Unlock()
	}
}

func (l *fakeLive) push(sym, tf string, c domain.Candle, closed bool) {
	l.mu.Lock()
	fn := l.fns[sym+"|"+tf]
	l.mu.Unlock()
	if fn != nil {
		fn(domain.LiveCandleMessage{Symbol: sym, Interval: tf, Candle: c, IsClosed: closed})
	}
}

func (l *fakeLive) watching() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.fns)
}

type harness struct {
	t     *testing.T
	e     *Engine
	h     *fakeHistory
	l     *fakeLive
	now   time.Time
	feed  <-chan LogEntry
	hooks chan string
}

// series: test-only minute bars ending one minute before now.
func series(now time.Time, vals ...float64) []domain.Candle {
	end := now.Truncate(time.Minute).Unix()
	out := make([]domain.Candle, len(vals))
	for i, v := range vals {
		ts := end - int64(len(vals)-1-i)*60
		out[i] = domain.Candle{Timestamp: ts, Open: v, High: v + 0.5, Low: v - 0.5, Close: v, Volume: 100}
	}
	return out
}

func newHarness(t *testing.T, base []domain.Candle) *harness {
	st := testStore(t)
	n := NewNotifier(st)
	n.RetryDelay = time.Millisecond
	bus := NewBroadcaster()
	h := &fakeHistory{data: map[string][]domain.Candle{"BTCUSDT|1m": base}}
	l := &fakeLive{}
	e := NewEngine(st, n, bus, h, l, scriptjs.NewPool(1))
	hz := &harness{t: t, e: e, h: h, l: l, hooks: make(chan string, 64)}
	hz.now = time.Unix(base[len(base)-1].Timestamp+30, 0) // mid-bar of the last (forming) candle
	e.Now = func() time.Time { return hz.now }
	e.PeriodicEval = time.Hour
	hz.feed, _ = bus.Subscribe()
	t.Cleanup(e.Wait)
	return hz
}

func (hz *harness) create(a Alert) Alert {
	hz.t.Helper()
	out, err := hz.e.Create(context.Background(), a)
	if err != nil {
		hz.t.Fatal(err)
	}
	return out
}

func (hz *harness) step() { hz.e.Step(context.Background()) }

func (hz *harness) tick(c domain.Candle, closed bool) {
	// like the hub: every streamed candle is also upserted into the cache the history reads
	hz.h.mu.Lock()
	cs := hz.h.data["BTCUSDT|1m"]
	if n := len(cs); n > 0 && cs[n-1].Timestamp == c.Timestamp {
		cs = append(cs[:n-1:n-1], c)
	} else {
		cs = append(cs[:len(cs):len(cs)], c)
	}
	hz.h.data["BTCUSDT|1m"] = cs
	hz.h.mu.Unlock()
	hz.l.push("BTCUSDT", "1m", c, closed)
	hz.step()
}

func (hz *harness) fired() []LogEntry {
	var out []LogEntry
	for {
		select {
		case e := <-hz.feed:
			if len(e.Deliveries) == 0 { // first publish of each firing
				out = append(out, e)
			}
		default:
			return out
		}
	}
}

func bar(ts int64, v float64) domain.Candle {
	return domain.Candle{Timestamp: ts, Open: v, High: v, Low: v, Close: v, Volume: 1}
}

func TestEnginePriceCrossingLiveWebhookAndOnce(t *testing.T) {
	base := series(time.Unix(1_800_000_000, 0), 100, 101, 102, 103)
	hz := newHarness(t, base)
	var hookBody []string
	var mu sync.Mutex
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		mu.Lock()
		hookBody = append(hookBody, string(b))
		mu.Unlock()
	}))
	defer srv.Close()
	a := hz.create(Alert{Name: "BTC 105", Symbol: "btcusdt", Interval: "1m", Condition: CondCrossingUp, Target: val(105),
		Trigger: TrigOnce, Message: "{{ticker}} {{close}} üstünde", Notify: Notify{App: true, Webhook: srv.URL}})
	if hz.l.watching() != 1 {
		t.Fatal("engine must watch the live feed")
	}
	hz.step() // loads history, primes the previous sample (103)
	if len(hz.fired()) != 0 {
		t.Fatal("no firing on load")
	}
	last := base[len(base)-1].Timestamp
	hz.tick(bar(last, 104), false)
	hz.tick(bar(last, 106), false)
	f := hz.fired()
	if len(f) != 1 || f[0].Message != "BTCUSDT 106 üstünde" || f[0].Price != 106 || f[0].AlertID != a.ID {
		t.Fatalf("fired: %+v", f)
	}
	hz.e.Wait()
	mu.Lock()
	if len(hookBody) != 1 || hookBody[0] != "BTCUSDT 106 üstünde" {
		t.Fatalf("webhook: %v", hookBody)
	}
	mu.Unlock()
	got, _ := hz.e.Get(a.ID)
	if got.Status != StatusTriggered || got.FireCount != 1 {
		t.Fatalf("once alert after firing: %+v", got)
	}
	if hz.l.watching() != 0 {
		t.Fatal("feed must close when no active alert needs it")
	}
	log, _ := hz.e.Store.Log(context.Background(), 0, 10)
	if len(log) != 1 || len(log[0].Deliveries) != 1 || !log[0].Deliveries[0].OK {
		t.Fatalf("log deliveries: %+v", log)
	}
	// restart → active again, crossing needs a fresh cross (history now holds the live bar, as the hub stores it)
	if _, err := hz.e.SetActive(context.Background(), a.ID, true); err != nil {
		t.Fatal(err)
	}
	hz.step()
	hz.tick(bar(last, 107), false)
	if len(hz.fired()) != 0 {
		t.Fatal("restart must not fire without a new cross")
	}
}

func TestEngineBarCloseAndPerBar(t *testing.T) {
	base := series(time.Unix(1_800_000_000, 0), 100, 100, 100)
	hz := newHarness(t, base)
	hz.create(Alert{Symbol: "BTCUSDT", Interval: "1m", Condition: CondGreaterThan, Target: val(101), Trigger: TrigOncePerBarClose})
	pb := hz.create(Alert{Symbol: "BTCUSDT", Interval: "1m", Condition: CondGreaterThan, Target: val(101), Trigger: TrigOncePerBar})
	hz.step()
	last := base[len(base)-1].Timestamp
	hz.tick(bar(last, 102), false)
	hz.tick(bar(last, 103), false)
	f := hz.fired()
	if len(f) != 1 || f[0].AlertID != pb.ID {
		t.Fatalf("intrabar: only once-per-bar fires once: %+v", f)
	}
	hz.now = hz.now.Add(time.Minute)
	hz.tick(bar(last+60, 104), false) // new bar: previous one closed
	f = hz.fired()
	if len(f) != 2 {
		t.Fatalf("new bar: bar-close alert (bar %d) + per-bar alert: %+v", last, f)
	}
	for _, e := range f {
		if e.AlertID != pb.ID && (e.BarTime != last || e.Price != 103) {
			t.Fatalf("bar close entry: %+v", e)
		}
	}
	hz.tick(bar(last+60, 104), true) // closed flag for the new bar
	if f = hz.fired(); len(f) != 1 || f[0].BarTime != last+60 {
		t.Fatalf("closed flag: %+v", f)
	}
}

func TestEngineScriptAlertConditionAndPlotOperand(t *testing.T) {
	base := series(time.Unix(1_800_000_000, 0), 10, 11, 12, 13, 14, 15, 16, 17, 18, 19)
	hz := newHarness(t, base)
	code := `//@version=6
indicator("Eşik")
m = ta.sma(close, 3)
plot(m, "MA3")
alertcondition(close > 25, "Yukarı", "{{ticker}} kapanış {{close}} MA {{plot_0}}")`
	study := &Study{Name: "Eşik", Code: code}
	pa := hz.create(Alert{Symbol: "BTCUSDT", Interval: "1m", Kind: KindScript, Study: study, ScriptEvent: ScriptAlertCondition, ConditionTitle: "Yukarı", Trigger: TrigOncePerBar})
	op := hz.create(Alert{Symbol: "BTCUSDT", Interval: "1m", Source: Operand{Kind: "plot", Study: study, Plot: "MA3"}, Condition: CondCrossingUp, Target: val(20), Trigger: TrigOncePerBar})
	hz.step()
	if f := hz.fired(); len(f) != 0 {
		t.Fatalf("nothing yet: %+v", f)
	}
	last := base[len(base)-1].Timestamp
	hz.tick(bar(last, 30), false) // MA3 = (17+18+30)/3 = 21.67 → crosses 20; close 30 > 25
	f := hz.fired()
	if len(f) != 2 {
		t.Fatalf("both alerts: %+v", f)
	}
	byID := map[string]LogEntry{f[0].AlertID: f[0], f[1].AlertID: f[1]}
	if m := byID[pa.ID].Message; m != "BTCUSDT kapanış 30 MA 21.66666667" {
		t.Fatalf("alertcondition message: %q", m)
	}
	if m := byID[op.ID].Message; m != "Eşik MA3 Yukarı kesişim 20" {
		t.Fatalf("plot default message: %q", m)
	}
	hz.tick(bar(last, 31), false)
	if f = hz.fired(); len(f) != 0 {
		t.Fatalf("once per bar: %+v", f)
	}
}

func TestEngineScriptAlertConditionBarClose(t *testing.T) {
	base := series(time.Unix(1_800_000_000, 0), 10, 11, 12)
	hz := newHarness(t, base)
	code := "//@version=6\nindicator(\"c\")\nalertcondition(close > 20, \"Büyük\")"
	hz.create(Alert{Symbol: "BTCUSDT", Interval: "1m", Kind: KindScript, Study: &Study{Name: "c", Code: code}, ScriptEvent: ScriptAlertCondition, ConditionTitle: "Büyük", Trigger: TrigOncePerBarClose})
	hz.step()
	last := base[len(base)-1].Timestamp
	hz.tick(bar(last, 25), false)
	if f := hz.fired(); len(f) != 0 {
		t.Fatalf("forming bar must not fire: %+v", f)
	}
	hz.now = hz.now.Add(time.Minute)
	hz.tick(bar(last+60, 5), false)
	f := hz.fired()
	if len(f) != 1 || f[0].BarTime != last || f[0].Message != "Büyük" {
		t.Fatalf("closed bar alertcondition: %+v", f)
	}
}

func TestEngineStrategyFillsAndAlertCalls(t *testing.T) {
	base := series(time.Unix(1_800_000_000, 0), 10, 10, 10, 10, 10)
	hz := newHarness(t, base)
	code := `//@version=6
strategy("Kır", overlay=true)
if close > 15 and strategy.position_size == 0
    strategy.entry("L", strategy.long, qty=2)
if close < 8 and strategy.position_size > 0
    strategy.close("L")
if close > 15
    alert("yüksek " + str.tostring(close), alert.freq_once_per_bar)`
	study := &Study{Name: "Kır", Code: code}
	fills := hz.create(Alert{Symbol: "BTCUSDT", Interval: "1m", Kind: KindScript, Study: study, ScriptEvent: ScriptOrderFills, Trigger: TrigOncePerBar,
		Message: "{{strategy.order.action}} {{strategy.order.contracts}} @ {{strategy.order.price}} poz={{strategy.position_size}} {{strategy.market_position}}"})
	calls := hz.create(Alert{Symbol: "BTCUSDT", Interval: "1m", Kind: KindScript, Study: study, ScriptEvent: ScriptAlertCalls, Trigger: TrigOncePerBar})
	hz.step()
	last := base[len(base)-1].Timestamp
	hz.tick(bar(last, 20), false) // signal on the forming bar; alert() once per bar
	f := hz.fired()
	if len(f) != 1 || f[0].AlertID != calls.ID || f[0].Message != "yüksek 20" {
		t.Fatalf("alert() call: %+v", f)
	}
	hz.tick(bar(last, 21), false)
	if f = hz.fired(); len(f) != 0 {
		t.Fatalf("alert() once per bar: %+v", f)
	}
	hz.now = hz.now.Add(time.Minute)
	hz.tick(bar(last+60, 7), false) // entry fills at this bar's open (7); close < 8 → exit next bar
	f = hz.fired()
	if len(f) != 1 || f[0].AlertID != fills.ID || f[0].Message != "buy 2 @ 7 poz=2 long" {
		t.Fatalf("entry fill: %+v", f)
	}
	hz.now = hz.now.Add(time.Minute)
	hz.tick(bar(last+120, 9), false)
	f = hz.fired()
	if len(f) != 1 || f[0].Message != "sell 2 @ 9 poz=0 flat" {
		t.Fatalf("exit fill: %+v", f)
	}
	hz.tick(bar(last+120, 9.5), false)
	if f = hz.fired(); len(f) != 0 {
		t.Fatalf("fills notified once: %+v", f)
	}
}

func TestEngineErrorsExpiryRateLimitAndCRUD(t *testing.T) {
	base := series(time.Unix(1_800_000_000, 0), 1, 2, 3)
	hz := newHarness(t, base)
	ctx := context.Background()
	bad := hz.create(Alert{Symbol: "BTCUSDT", Interval: "1m", Kind: KindScript, Study: &Study{Code: "indicator(\"x\")\nplot("}, ScriptEvent: ScriptAlertCalls})
	exp := hz.create(Alert{Symbol: "BTCUSDT", Interval: "1m", Condition: CondGreaterThan, Target: val(0), ExpiresAt: hz.now.Unix() + 1})
	spam := hz.create(Alert{Symbol: "BTCUSDT", Interval: "1m", Kind: KindScript, Study: &Study{Code: "//@version=6\nindicator(\"s\")\nalert(\"t \" + str.tostring(close), alert.freq_all)"}, ScriptEvent: ScriptAlertCalls})
	hz.step()
	if a, _ := hz.e.Get(bad.ID); a.Status != StatusError || !strings.HasPrefix(a.StatusMsg, "Betik: ") {
		t.Fatalf("script error status: %+v", a)
	}
	if a, _ := hz.e.Get(exp.ID); a.Status != StatusTriggered {
		t.Fatalf("greater-than fires at once: %+v", a)
	}
	// expiry
	exp2 := hz.create(Alert{Symbol: "BTCUSDT", Interval: "1m", Condition: CondGreaterThan, Target: val(1e9), ExpiresAt: hz.now.Unix() + 1})
	hz.now = hz.now.Add(2 * time.Second)
	hz.e.PeriodicEval = 0
	hz.step()
	if a, _ := hz.e.Get(exp2.ID); a.Status != StatusExpired {
		t.Fatalf("expired: %+v", a)
	}
	// alert.freq_all fires on every update until the 15-in-3-minutes limit stops it
	last := base[len(base)-1].Timestamp
	for i := 0; i < 20; i++ {
		hz.tick(bar(last, 3+float64(i)), false)
	}
	if a, _ := hz.e.Get(spam.ID); a.Status != StatusStopped || a.FireCount != 16 {
		t.Fatalf("rate limit: %+v", a)
	}
	// CRUD
	cl, err := hz.e.Clone(ctx, spam.ID)
	if err != nil || cl.ID == spam.ID || cl.Status != StatusActive {
		t.Fatalf("clone %v %+v", err, cl)
	}
	named, _ := hz.e.Update(ctx, cl.ID, Alert{Name: "ad", Symbol: "BTCUSDT", Interval: "1m", Condition: CondLessThan, Target: val(0)})
	if named.Name != "ad" || named.CreatedAt != cl.CreatedAt {
		t.Fatalf("update %+v", named)
	}
	if c2, _ := hz.e.Clone(ctx, named.ID); c2.Name != "ad (kopya)" {
		t.Fatalf("clone name %q", c2.Name)
	}
	if _, err := hz.e.Update(ctx, "nope", named); !errors.Is(err, ErrNotFound) {
		t.Fatal("update unknown")
	}
	if _, err := hz.e.Update(ctx, named.ID, Alert{}); err == nil {
		t.Fatal("update invalid")
	}
	if _, err := hz.e.SetActive(ctx, "nope", true); !errors.Is(err, ErrNotFound) {
		t.Fatal("setactive unknown")
	}
	if _, err := hz.e.Clone(ctx, "nope"); !errors.Is(err, ErrNotFound) {
		t.Fatal("clone unknown")
	}
	if _, err := hz.e.Create(ctx, Alert{}); err == nil {
		t.Fatal("create invalid")
	}
	if n, _ := hz.e.Bulk(ctx, "stop_all"); n == 0 {
		t.Fatal("stop_all")
	}
	if hz.l.watching() != 0 {
		t.Fatal("no feed after stop_all")
	}
	if n, _ := hz.e.Bulk(ctx, "restart_all"); n == 0 || len(hz.e.Groups()) != 1 {
		t.Fatal("restart_all")
	}
	if a, _ := hz.e.Get(exp2.ID); a.Status != StatusActive || a.ExpiresAt != 0 {
		t.Fatalf("restarted expired alert becomes open-ended: %+v", a)
	}
	if _, err := hz.e.Bulk(ctx, "zzz"); err == nil {
		t.Fatal("unknown bulk")
	}
	_, _ = hz.e.SetActive(ctx, bad.ID, false)
	if n, _ := hz.e.Bulk(ctx, "delete_inactive"); n != 1 {
		t.Fatalf("delete_inactive %d", n)
	}
	// persisted alerts reload into a new engine (server restart)
	e2 := NewEngine(hz.e.Store, nil, nil, hz.h, &fakeLive{}, scriptjs.NewPool(1))
	if err := e2.Load(ctx); err != nil || len(e2.List()) != len(hz.e.List()) {
		t.Fatalf("reload %v %d vs %d", err, len(e2.List()), len(hz.e.List()))
	}
	if n, _ := hz.e.Bulk(ctx, "delete_all"); n == 0 || len(hz.e.List()) != 0 {
		t.Fatal("delete_all")
	}
	if err := hz.e.Delete(ctx, "nope"); !errors.Is(err, ErrNotFound) {
		t.Fatal("delete unknown")
	}
}

func TestEngineHistoryErrorsOtherSymbolsAndRun(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	base := series(now, 1, 2, 3, 4)
	hz := newHarness(t, base)
	hz.h.data["ETHUSDT|1m"] = series(now, 50, 60, 70, 80)
	code := `//@version=6
indicator("Oran")
e = request.security("ETHUSDT", timeframe.period, close)
alertcondition(e > 75, "ETH", "ETH {{plot_0}}")
plot(e, "eth")`
	hz.create(Alert{Symbol: "BTCUSDT", Interval: "1m", Kind: KindScript, Study: &Study{Code: code}, ScriptEvent: ScriptAlertCondition, ConditionTitle: "ETH", Trigger: TrigOncePerBar})
	hz.step()
	f := hz.fired()
	if len(f) != 1 || f[0].Message != "ETH 80" {
		t.Fatalf("request.security other symbol: %+v", f)
	}
	// history error is logged, nothing fires, and Run exits on cancel
	hz2 := newHarness(t, base)
	hz2.h.err = errors.New("upstream down")
	hz2.create(Alert{Symbol: "BTCUSDT", Interval: "1m", Condition: CondGreaterThan, Target: val(0)})
	hz2.e.Tick = time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { hz2.e.Run(ctx); close(done) }()
	time.Sleep(20 * time.Millisecond)
	cancel()
	<-done
	if len(hz2.fired()) != 0 || len(hz2.e.Groups()) != 0 {
		t.Fatal("history error / shutdown")
	}
}

func TestGroupMergeAndHelpers(t *testing.T) {
	g := &group{}
	g.merge([]domain.Candle{bar(120, 1), bar(60, 2), bar(180, 3)}, 10)
	if len(g.candles) != 3 || g.candles[0].Timestamp != 60 || g.candles[2].Timestamp != 180 {
		t.Fatalf("sorted insert: %+v", g.candles)
	}
	if g.closedThrough != 120 {
		t.Fatalf("closedThrough %d", g.closedThrough)
	}
	v := g.version
	g.merge([]domain.Candle{bar(180, 3)}, 10)
	if g.version != v {
		t.Fatal("identical candle must not bump version")
	}
	g.merge([]domain.Candle{bar(240, 4), bar(300, 5)}, 3)
	if len(g.candles) != 3 || g.candles[0].Timestamp != 180 {
		t.Fatalf("trim: %+v", g.candles)
	}
	for tf, want := range map[string]string{"1m": "1", "15m": "15", "4h": "240", "1d": "D", "1w": "W"} {
		if got := scriptTimeframe(tf); got != want {
			t.Errorf("scriptTimeframe(%s)=%s", tf, got)
		}
	}
	if mt := mintick([]domain.Candle{{Open: 1.25, High: 1.5, Low: 1, Close: 1.125}}); mt != 0.001 {
		t.Fatalf("mintick %v", mt)
	}
	b, _ := json.Marshal(ConditionLabels)
	if len(ConditionLabels) != len(AllConditions) || len(b) == 0 {
		t.Fatal("labels for every condition")
	}
}
