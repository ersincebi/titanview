package alerts

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
	"github.com/ersincebi/titanview/backend/internal/scriptjs"
)

// History loads the most recent bars for a symbol/interval (SQLite cache + upstream).
type History interface {
	Candles(ctx context.Context, symbol, interval string, bars int) ([]domain.Candle, error)
}

// Live streams candle updates (the hub; works without any browser attached).
type Live interface {
	Watch(symbol, interval string, fn func(domain.LiveCandleMessage)) (cancel func())
}

// ScriptRunner executes TitanScript (scriptjs.Pool in production).
type ScriptRunner interface {
	Run(in scriptjs.Input, timeout time.Duration) (*scriptjs.Output, error)
}

// Engine evaluates every active alert on live data and fires notifications.
type Engine struct {
	Store    *Store
	Notifier *Notifier
	Bus      *Broadcaster
	History  History
	Live     Live
	Script   ScriptRunner
	// Scripts lists saved scripts for `import` resolution (optional).
	Scripts func(ctx context.Context) []scriptjs.Script

	Now          func() time.Time
	Bars         int           // candle window per group
	Tick         time.Duration // evaluation loop period
	Refresh      time.Duration // history re-read period (heals gaps, BIST polling)
	ScriptTimeout  time.Duration
	PeriodicEval time.Duration // evaluate even without ticks (expiry, closed sessions)

	mu     sync.Mutex
	alerts map[string]*Alert
	states map[string]*State
	groups map[string]*group

	deliveries sync.WaitGroup
}

type group struct {
	symbol, interval string
	step             int64
	delay            int64 // data delay in seconds (BIST 15 min)
	candles          []domain.Candle
	closedThrough    int64 // newest bar time known to be final
	liveLast         int64 // newest bar time received from the live feed (history never overwrites it)
	version          int64
	dirty            bool
	loaded           time.Time
	evaluated        time.Time
	cancel           func()
}

// NewEngine wires an engine with defaults.
func NewEngine(st *Store, n *Notifier, bus *Broadcaster, h History, live Live, runner ScriptRunner) *Engine {
	return &Engine{
		Store: st, Notifier: n, Bus: bus, History: h, Live: live, Script: runner,
		Now:          time.Now,
		Bars:         600,
		Tick:         time.Second,
		Refresh:      2 * time.Minute,
		ScriptTimeout:  10 * time.Second,
		PeriodicEval: 15 * time.Second,
		alerts:       map[string]*Alert{},
		states:       map[string]*State{},
		groups:       map[string]*group{},
	}
}

func groupKey(sym, tf string) string { return sym + "|" + tf }

// Load reads stored alerts and subscribes to their feeds.
func (e *Engine) Load(ctx context.Context) error {
	list, err := e.Store.List(ctx)
	if err != nil {
		return err
	}
	e.mu.Lock()
	for i := range list {
		a := list[i]
		e.alerts[a.ID] = &a
		e.states[a.ID] = &State{}
	}
	e.syncLocked()
	e.mu.Unlock()
	return nil
}

// Run loads alerts and evaluates until ctx ends.
func (e *Engine) Run(ctx context.Context) {
	if err := e.Load(ctx); err != nil {
		log.Printf("alerts: load: %v", err)
	}
	t := time.NewTicker(e.Tick)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			e.mu.Lock()
			for k, g := range e.groups {
				g.cancel()
				delete(e.groups, k)
			}
			e.mu.Unlock()
			return
		case <-t.C:
			e.Step(ctx)
		}
	}
}

// Wait blocks until in-flight external deliveries finish (tests, shutdown).
func (e *Engine) Wait() { e.deliveries.Wait() }

// syncLocked opens feeds for groups that have active alerts and closes unused ones.
func (e *Engine) syncLocked() {
	need := map[string]*Alert{}
	for _, a := range e.alerts {
		if a.Status == StatusActive {
			need[groupKey(a.Symbol, a.Interval)] = a
		}
	}
	for k, g := range e.groups {
		if _, ok := need[k]; !ok {
			g.cancel()
			delete(e.groups, k)
		}
	}
	for k, a := range need {
		if _, ok := e.groups[k]; ok {
			continue
		}
		info := domain.ResolveSymbolInfo(a.Symbol)
		g := &group{symbol: a.Symbol, interval: a.Interval, step: domain.TimeframeSeconds(a.Interval), delay: int64(info.DelayMinutes) * 60, cancel: func() {}}
		e.groups[k] = g
		if e.Live != nil {
			key := k
			g.cancel = e.Live.Watch(a.Symbol, a.Interval, func(m domain.LiveCandleMessage) { e.onLive(key, m) })
		}
	}
}

// onLive merges a streamed candle into its group.
func (e *Engine) onLive(key string, m domain.LiveCandleMessage) {
	e.mu.Lock()
	defer e.mu.Unlock()
	g := e.groups[key]
	if g == nil || m.Candle.Timestamp <= 0 {
		return
	}
	g.merge([]domain.Candle{m.Candle}, e.Bars)
	if m.Candle.Timestamp > g.liveLast {
		g.liveLast = m.Candle.Timestamp
	}
	if m.IsClosed && m.Candle.Timestamp > g.closedThrough {
		g.closedThrough = m.Candle.Timestamp
	}
	g.dirty = true
}

// merge upserts candles by time, keeping the newest `keep` bars; a newer bar closes the previous ones.
func (g *group) merge(cs []domain.Candle, keep int) {
	changed := false
	for _, c := range cs {
		n := len(g.candles)
		switch {
		case n == 0 || c.Timestamp > g.candles[n-1].Timestamp:
			if n > 0 && g.candles[n-1].Timestamp > g.closedThrough {
				g.closedThrough = g.candles[n-1].Timestamp
			}
			g.candles = append(g.candles, c)
			changed = true
		default:
			i := sort.Search(n, func(k int) bool { return g.candles[k].Timestamp >= c.Timestamp })
			if i < n && g.candles[i].Timestamp == c.Timestamp {
				if g.candles[i] != c {
					g.candles[i] = c
					changed = true
				}
			} else {
				g.candles = append(g.candles, domain.Candle{})
				copy(g.candles[i+1:], g.candles[i:])
				g.candles[i] = c
				changed = true
			}
		}
	}
	if len(g.candles) > keep {
		g.candles = append([]domain.Candle(nil), g.candles[len(g.candles)-keep:]...)
	}
	if changed {
		g.version++
	}
}

type job struct {
	key    string
	g      *group
	frame  []domain.Candle
	closed bool
	alerts []Alert
	// script caches study outputs for this evaluation pass (one run per study per pass)
	script map[string]*scriptjs.Output
}

// Step loads stale histories and evaluates groups that changed (or are due a periodic look).
func (e *Engine) Step(ctx context.Context) {
	now := e.Now()
	e.mu.Lock()
	var loads []*group
	for _, g := range e.groups {
		if g.loaded.IsZero() || now.Sub(g.loaded) >= e.Refresh {
			g.loaded = now
			loads = append(loads, g)
		}
	}
	e.mu.Unlock()
	for _, g := range loads {
		cs, err := e.History.Candles(ctx, g.symbol, g.interval, e.Bars)
		if err != nil {
			log.Printf("alerts: history %s %s: %v", g.symbol, g.interval, err)
			continue
		}
		e.mu.Lock()
		if g.liveLast > 0 {
			// the cache may lag the stream by a few seconds: keep the live tail
			keep := cs[:0:0]
			for _, c := range cs {
				if c.Timestamp < g.liveLast {
					keep = append(keep, c)
				}
			}
			cs = keep
		}
		g.merge(cs, e.Bars)
		g.dirty = true
		e.mu.Unlock()
	}

	e.mu.Lock()
	var jobs []job
	for k, g := range e.groups {
		if len(g.candles) == 0 || (!g.dirty && now.Sub(g.evaluated) < e.PeriodicEval) {
			continue
		}
		g.dirty, g.evaluated = false, now
		last := g.candles[len(g.candles)-1]
		closed := last.Timestamp <= g.closedThrough ||
			// a session that went quiet: the bar is over once its end (plus feed delay) is well past
			now.Unix() > last.Timestamp+g.step+g.delay+90
		j := job{key: k, g: g, frame: append([]domain.Candle(nil), g.candles...), closed: closed, script: map[string]*scriptjs.Output{}}
		for _, a := range e.alerts {
			if a.Status == StatusActive && groupKey(a.Symbol, a.Interval) == k {
				j.alerts = append(j.alerts, *a)
			}
		}
		jobs = append(jobs, j)
	}
	e.mu.Unlock()

	for _, j := range jobs {
		sort.Slice(j.alerts, func(a, b int) bool { return j.alerts[a].CreatedAt < j.alerts[b].CreatedAt })
		for i := range j.alerts {
			e.evalAlert(ctx, j, &j.alerts[i], now)
		}
	}
}

// scriptTimeframe maps an API interval onto script timeframe.period.
func scriptTimeframe(tf string) string {
	sec := domain.TimeframeSeconds(tf)
	switch {
	case sec >= 604800:
		return "W"
	case sec >= 86400:
		return "D"
	default:
		return strconv.FormatInt(sec/60, 10)
	}
}

// mintick estimates the price increment from the decimals the data actually uses (like the UI).
func mintick(cs []domain.Candle) float64 {
	dec := 0
	start := len(cs) - 60
	if start < 0 {
		start = 0
	}
	for _, c := range cs[start:] {
		for _, v := range []float64{c.Open, c.High, c.Low, c.Close} {
			s := strings.TrimRight(strconv.FormatFloat(v, 'f', 8, 64), "0")
			if i := strings.IndexByte(s, '.'); i >= 0 && len(s)-i-1 > dec {
				dec = len(s) - i - 1
			}
		}
	}
	return math.Pow(10, -float64(dec))
}

func studyKey(s *Study, closedOnly bool) string {
	h := sha256.New()
	h.Write([]byte(s.Code))
	in, _ := json.Marshal(s.Inputs)
	h.Write(in)
	return fmt.Sprintf("%x|%v", h.Sum(nil)[:12], closedOnly)
}

// runStudy executes a study on the frame (cached per data version), fetching other symbols on demand.
func (e *Engine) runStudy(ctx context.Context, j job, s *Study, frame []domain.Candle, closedOnly bool) (*scriptjs.Output, error) {
	key := studyKey(s, closedOnly)
	if out, ok := j.script[key]; ok {
		if !out.OK {
			return out, fmt.Errorf("%s", out.Error)
		}
		return out, nil
	}
	in := scriptjs.Input{
		Code: s.Code, Candles: frame, Symbol: j.g.symbol, Timeframe: scriptTimeframe(j.g.interval),
		Mintick: mintick(frame), Inputs: s.Inputs,
	}
	if e.Scripts != nil && strings.Contains(s.Code, "import ") {
		in.Scripts = e.Scripts(ctx)
	}
	out, err := e.Script.Run(in, e.ScriptTimeout)
	if err == nil && len(out.MissingSymbols) > 0 {
		in.SymbolCandles = map[string][]domain.Candle{}
		for _, sym := range out.MissingSymbols {
			if cs, herr := e.History.Candles(ctx, sym, j.g.interval, e.Bars); herr == nil {
				in.SymbolCandles[sym] = cs
			}
		}
		out, err = e.Script.Run(in, e.ScriptTimeout)
	}
	if err != nil {
		return nil, err
	}
	if j.script != nil {
		j.script[key] = out
	}
	if !out.OK {
		return out, fmt.Errorf("%s", out.Error)
	}
	return out, nil
}

// plotSource adapts script outputs to PlotSource.
type plotSource struct {
	e     *Engine
	ctx   context.Context
	j     job
	frame []domain.Candle
	err   error
}

func (p *plotSource) PlotValue(s *Study, plot string, i int) (float64, bool) {
	out, err := p.e.runStudy(p.ctx, p.j, s, p.frame, false)
	if err != nil {
		if p.err == nil {
			p.err = err
		}
		return 0, false
	}
	return out.PlotValue(plot, i)
}

func (e *Engine) state(id string) *State {
	e.mu.Lock()
	defer e.mu.Unlock()
	st := e.states[id]
	if st == nil {
		st = &State{}
		e.states[id] = st
	}
	return st
}

func (e *Engine) evalAlert(ctx context.Context, j job, a *Alert, now time.Time) {
	if a.ExpiresAt > 0 && now.Unix() >= a.ExpiresAt {
		e.setStatus(ctx, a.ID, a.UpdatedAt, StatusExpired, "Süresi doldu")
		return
	}
	st := e.state(a.ID)
	nowMs := now.UnixMilli()
	if a.Kind == KindScript {
		e.evalScript(ctx, j, a, st, now)
		return
	}
	ps := &plotSource{e: e, ctx: ctx, j: j, frame: j.frame}
	f := &Frame{Candles: j.frame, Closed: j.closed, Step: j.g.step, Plots: ps}
	idx := EvalCondition(a, f, st)
	if ps.err != nil {
		e.setStatus(ctx, a.ID, a.UpdatedAt, StatusError, "Betik: "+ps.err.Error())
		return
	}
	if idx < 0 || !Gate(a, st, j.frame[idx].Timestamp, nowMs) {
		return
	}
	var out *scriptjs.Output
	for _, s := range a.Studies() {
		out, _ = e.runStudy(ctx, j, s, j.frame, false)
		break
	}
	msg := a.Message
	if strings.TrimSpace(msg) == "" {
		msg = DefaultMessage(a)
	}
	tc := TemplateCtx{Symbol: a.Symbol, Interval: a.Interval, Candle: j.frame[idx], Now: now, Script: out, BarIndex: idx}
	e.fire(ctx, a, st, Render(msg, tc), j.frame[idx], now)
}

// evalScript handles alertcondition / alert() / strategy fill alerts.
func (e *Engine) evalScript(ctx context.Context, j job, a *Alert, st *State, now time.Time) {
	nowMs := now.UnixMilli()
	frame := j.frame
	closedOnly := a.Trigger == TrigOncePerBarClose && a.ScriptEvent == ScriptAlertCondition
	if closedOnly {
		c := len(frame) - 1
		if !j.closed {
			c--
		}
		if c < 1 || frame[c].Timestamp <= st.LastClosedBar {
			return
		}
		first := st.LastClosedBar == 0
		st.LastClosedBar = frame[c].Timestamp
		if first && (frame[c].Timestamp+j.g.step)*1000 <= a.UpdatedAt {
			return
		}
		frame = frame[:c+1]
	}
	out, err := e.runStudy(ctx, j, a.Study, frame, closedOnly)
	if err != nil {
		e.setStatus(ctx, a.ID, a.UpdatedAt, StatusError, "Betik: "+err.Error())
		return
	}
	last := len(frame) - 1
	bar := frame[last]
	tc := TemplateCtx{Symbol: a.Symbol, Interval: a.Interval, Candle: bar, Now: now, Script: out, BarIndex: last}

	switch a.ScriptEvent {
	case ScriptAlertCondition:
		for _, al := range out.Alerts {
			if al.Kind == "alertcondition" && al.Title == a.ConditionTitle {
				if !Gate(a, st, bar.Timestamp, nowMs) {
					return
				}
				msg := a.Message
				if strings.TrimSpace(msg) == "" {
					msg = al.Message
				}
				e.fire(ctx, a, st, Render(msg, tc), bar, now)
				return
			}
		}
	case ScriptAlertCalls, ScriptOrderFills, ScriptOrderFillsAlerts:
		if a.ScriptEvent != ScriptAlertCalls {
			e.scriptFills(ctx, a, st, out, tc, now)
		}
		if a.ScriptEvent != ScriptOrderFills {
			e.scriptCalls(ctx, j, a, st, out, tc, now)
		}
		st.Primed = true
	}
}

// scriptFills notifies strategy order fills newer than the last one seen (the first run only primes).
func (e *Engine) scriptFills(ctx context.Context, a *Alert, st *State, out *scriptjs.Output, tc TemplateCtx, now time.Time) {
	var fresh []scriptjs.Fill
	newest, seen := st.LastFill, 0
	for _, f := range out.Fills {
		if f.Time > newest {
			newest, seen = f.Time, 0
		}
		if f.Time == newest {
			seen++
		}
		if f.Time > st.LastFill || (f.Time == st.LastFill && seen > st.FillsSeen) {
			fresh = append(fresh, f)
		}
	}
	primed := st.Primed
	st.LastFill, st.FillsSeen = newest, seen
	if !primed {
		return
	}
	for i := range fresh {
		f := fresh[i]
		msg := a.Message
		if strings.TrimSpace(msg) == "" {
			msg = "{{strategy.order.action}} {{strategy.order.contracts}} @ {{strategy.order.price}} — {{ticker}} ({{strategy.order.id}})"
		}
		c := tc
		c.Fill = &f
		e.fire(ctx, a, st, Render(msg, c), tc.Candle, now)
	}
}

// scriptCalls notifies alert() calls honouring each call's own freq.
func (e *Engine) scriptCalls(ctx context.Context, j job, a *Alert, st *State, out *scriptjs.Output, tc TemplateCtx, now time.Time) {
	if st.ScriptFired == nil {
		st.ScriptFired = map[string]int64{}
	}
	bt := tc.Candle.Timestamp
	for _, al := range out.Alerts {
		if al.Kind != "alert" {
			continue
		}
		switch al.Freq {
		case "all":
		case "once_per_bar_close":
			// the forming bar may still change: only the run on a closed bar counts
			if !j.closed || st.ScriptFired["close|"+al.Message] == bt {
				continue
			}
			st.ScriptFired["close|"+al.Message] = bt
		default: // once_per_bar: only the first alert() call of a bar notifies
			if st.ScriptFired["bar"] == bt {
				continue
			}
			st.ScriptFired["bar"] = bt
		}
		if !st.Primed && al.Freq != "all" {
			continue // created mid-bar: the current bar's calls were already due before the alert existed
		}
		e.fire(ctx, a, st, al.Message, tc.Candle, now)
	}
	if len(st.ScriptFired) > 256 {
		st.ScriptFired = map[string]int64{}
	}
}

// fire records a firing, updates the alert and hands external channels to a goroutine.
func (e *Engine) fire(ctx context.Context, a *Alert, st *State, msg string, bar domain.Candle, now time.Time) {
	nowMs := now.UnixMilli()
	e.mu.Lock()
	live := e.alerts[a.ID]
	if live == nil || live.UpdatedAt != a.UpdatedAt || live.Status != StatusActive {
		e.mu.Unlock()
		return // edited/stopped/deleted meanwhile
	}
	live.FireCount++
	live.LastFiredAt = nowMs
	// alert() calls and order fills follow the script's own frequency; "Only once" applies to conditions
	if a.Trigger == TrigOnce && (a.Kind != KindScript || a.ScriptEvent == ScriptAlertCondition) {
		live.Status, live.StatusMsg = StatusTriggered, "Tetiklendi"
	}
	if RateLimit(st, nowMs) {
		live.Status, live.StatusMsg = StatusStopped, "Çok sık tetiklendi (3 dakikada 15'ten fazla) — durduruldu"
	}
	snapshot := *live
	if snapshot.Status != StatusActive {
		e.syncLocked()
	}
	e.mu.Unlock()
	if err := e.Store.Put(ctx, snapshot); err != nil {
		log.Printf("alerts: save %s: %v", a.ID, err)
	}
	entry := LogEntry{
		AlertID: a.ID, Name: a.Name, Symbol: a.Symbol, Interval: a.Interval,
		Time: nowMs, BarTime: bar.Timestamp, Price: bar.Close, Message: msg, Notify: a.Notify,
	}
	entry, err := e.Store.AppendLog(ctx, entry)
	if err != nil {
		log.Printf("alerts: log %s: %v", a.ID, err)
		return
	}
	if e.Bus != nil {
		e.Bus.Publish(entry)
	}
	if e.Notifier == nil || (a.Notify.Webhook == "" && !a.Notify.Telegram && !a.Notify.Push) {
		return
	}
	e.deliveries.Add(1)
	go func() {
		defer e.deliveries.Done()
		dctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		entry.Deliveries = e.Notifier.Deliver(dctx, entry)
		if err := e.Store.UpdateLog(dctx, entry); err != nil {
			log.Printf("alerts: log update: %v", err)
		}
		if e.Bus != nil {
			e.Bus.Publish(entry)
		}
	}()
}

func (e *Engine) setStatus(ctx context.Context, id string, version int64, status, msg string) {
	e.mu.Lock()
	a := e.alerts[id]
	if a == nil || a.UpdatedAt != version || (a.Status == status && a.StatusMsg == msg) {
		e.mu.Unlock()
		return
	}
	a.Status, a.StatusMsg = status, msg
	snap := *a
	e.syncLocked()
	e.mu.Unlock()
	if err := e.Store.Put(ctx, snap); err != nil {
		log.Printf("alerts: save %s: %v", id, err)
	}
}

// DefaultMessage is Default auto message ("BTCUSDT Crossing 65000").
func DefaultMessage(a *Alert) string {
	src := "{{ticker}}"
	if a.Source.Kind == "plot" && a.Source.Study != nil {
		src = a.Source.Study.Name + " " + a.Source.Plot
	}
	label := ConditionLabels[a.Condition]
	switch {
	case isChannel(a.Condition):
		return fmt.Sprintf("%s %s", src, label)
	case isMoving(a.Condition):
		unit := ""
		if a.Condition == CondMovingUpPct || a.Condition == CondMovingDownPct {
			unit = "%"
		}
		return fmt.Sprintf("%s %s %s%s / %d bar", src, label, FormatNumber(a.Amount), unit, a.Bars)
	}
	tgt := ""
	if a.Target != nil {
		switch a.Target.Kind {
		case "value":
			tgt = FormatNumber(a.Target.Value)
		case "plot":
			if a.Target.Study != nil {
				tgt = a.Target.Study.Name + " " + a.Target.Plot
			}
		case "line":
			tgt = "çizgi"
		case "price":
			tgt = a.Target.Field
		}
	}
	return strings.TrimSpace(fmt.Sprintf("%s %s %s", src, label, tgt))
}

// ConditionLabels are the Turkish labels (same as the UI).
var ConditionLabels = map[string]string{
	CondCrossing: "Kesişim", CondCrossingUp: "Yukarı kesişim", CondCrossingDown: "Aşağı kesişim",
	CondGreaterThan: "Büyüktür", CondLessThan: "Küçüktür",
	CondEnteringChannel: "Kanala giriyor", CondExitingChannel: "Kanaldan çıkıyor",
	CondInsideChannel: "Kanalın içinde", CondOutsideChannel: "Kanalın dışında",
	CondMovingUp: "Yukarı hareket", CondMovingDown: "Aşağı hareket",
	CondMovingUpPct: "Yukarı hareket %", CondMovingDownPct: "Aşağı hareket %",
}

// ---------------------------------------------------------------- CRUD (API)

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return "al_" + hex.EncodeToString(b)
}

// List returns all alerts (newest first).
func (e *Engine) List() []Alert {
	e.mu.Lock()
	defer e.mu.Unlock()
	out := make([]Alert, 0, len(e.alerts))
	for _, a := range e.alerts {
		out = append(out, *a)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CreatedAt != out[j].CreatedAt {
			return out[i].CreatedAt > out[j].CreatedAt
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// Get returns one alert.
func (e *Engine) Get(id string) (Alert, bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	a, ok := e.alerts[id]
	if !ok {
		return Alert{}, false
	}
	return *a, true
}

func (e *Engine) stamp() int64 {
	ms := e.Now().UnixMilli()
	// UpdatedAt doubles as the version: keep it strictly increasing per process
	e.mu.Lock()
	for _, a := range e.alerts {
		if a.UpdatedAt >= ms {
			ms = a.UpdatedAt + 1
		}
	}
	e.mu.Unlock()
	return ms
}

func (e *Engine) save(ctx context.Context, a Alert) (Alert, error) {
	if err := e.Store.Put(ctx, a); err != nil {
		return Alert{}, err
	}
	e.mu.Lock()
	cp := a
	e.alerts[a.ID] = &cp
	e.states[a.ID] = &State{}
	e.syncLocked()
	e.mu.Unlock()
	return a, nil
}

// Create validates and stores a new active alert.
func (e *Engine) Create(ctx context.Context, a Alert) (Alert, error) {
	if err := a.Normalize(); err != nil {
		return Alert{}, err
	}
	ts := e.stamp()
	a.ID, a.CreatedAt, a.UpdatedAt = newID(), ts, ts
	a.Status, a.StatusMsg, a.FireCount, a.LastFiredAt = StatusActive, "", 0, 0
	return e.save(ctx, a)
}

// Update replaces an alert's definition and restarts it (editing restarts the alert).
func (e *Engine) Update(ctx context.Context, id string, a Alert) (Alert, error) {
	old, ok := e.Get(id)
	if !ok {
		return Alert{}, ErrNotFound
	}
	if err := a.Normalize(); err != nil {
		return Alert{}, err
	}
	a.ID, a.CreatedAt, a.FireCount, a.LastFiredAt = id, old.CreatedAt, old.FireCount, old.LastFiredAt
	a.UpdatedAt = e.stamp()
	a.Status, a.StatusMsg = StatusActive, ""
	return e.save(ctx, a)
}

// Delete removes an alert.
func (e *Engine) Delete(ctx context.Context, id string) error {
	if err := e.Store.Delete(ctx, id); err != nil {
		return err
	}
	e.mu.Lock()
	delete(e.alerts, id)
	delete(e.states, id)
	e.syncLocked()
	e.mu.Unlock()
	return nil
}

// SetActive stops or restarts an alert.
func (e *Engine) SetActive(ctx context.Context, id string, active bool) (Alert, error) {
	a, ok := e.Get(id)
	if !ok {
		return Alert{}, ErrNotFound
	}
	a.UpdatedAt = e.stamp()
	if active {
		a.Status, a.StatusMsg = StatusActive, ""
		if a.ExpiresAt > 0 && a.ExpiresAt <= e.Now().Unix() {
			a.ExpiresAt = 0 // restarting an expired alert makes it open-ended (asks for a new date)
		}
	} else {
		a.Status, a.StatusMsg = StatusStopped, "Durduruldu"
	}
	return e.save(ctx, a)
}

// Clone copies an alert (stopped copies start active on clone).
func (e *Engine) Clone(ctx context.Context, id string) (Alert, error) {
	a, ok := e.Get(id)
	if !ok {
		return Alert{}, ErrNotFound
	}
	if a.Name != "" {
		a.Name += " (kopya)"
	}
	return e.Create(ctx, a)
}

// Bulk applies an action to every alert: stop_all | restart_all | delete_all | delete_inactive.
func (e *Engine) Bulk(ctx context.Context, action string) (int, error) {
	n := 0
	for _, a := range e.List() {
		var err error
		switch action {
		case "stop_all":
			if a.Status != StatusActive {
				continue
			}
			_, err = e.SetActive(ctx, a.ID, false)
		case "restart_all":
			if a.Status == StatusActive {
				continue
			}
			_, err = e.SetActive(ctx, a.ID, true)
		case "delete_all":
			err = e.Delete(ctx, a.ID)
		case "delete_inactive":
			if a.Status == StatusActive {
				continue
			}
			err = e.Delete(ctx, a.ID)
		default:
			return 0, fmt.Errorf("unknown action %q", action)
		}
		if err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

// Groups reports the live feeds the engine holds open (diagnostics).
func (e *Engine) Groups() []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	out := make([]string, 0, len(e.groups))
	for k := range e.groups {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
