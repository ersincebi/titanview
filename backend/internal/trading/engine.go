package trading

import (
	"context"
	"errors"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
)

// Live streams candle updates (the hub; works without a browser attached).
type Live interface {
	Watch(symbol, interval string, fn func(domain.LiveCandleMessage)) (cancel func())
}

// Prices returns the latest known price of a symbol (fallback when no live tick arrived yet).
type Prices interface {
	LastPrice(ctx context.Context, symbol string) (float64, error)
}

// Snapshot is what clients render.
type Snapshot struct {
	Account
	Summary Summary `json:"summary"`
	Version int64   `json:"version"`
}

// Message is one SSE payload: the events that just happened plus the new state.
type Message struct {
	Events   []Event  `json:"events"`
	Snapshot Snapshot `json:"snapshot"`
}

// Engine owns the paper account and fills orders on live prices.
type Engine struct {
	Store  *Store
	Live   Live
	Prices Prices
	Now    func() time.Time
	// Throttle bounds snapshot pushes caused only by price changes.
	Throttle time.Duration

	mu       sync.Mutex
	acc      Account
	last     map[string]float64
	watches  map[string]func()
	version  int64
	dirty    bool // prices moved since the last push
	lastPush time.Time

	subMu sync.Mutex
	subs  map[chan Message]struct{}
}

// NewEngine creates an engine; call Load before use.
func NewEngine(st *Store, live Live, prices Prices) *Engine {
	return &Engine{Store: st, Live: live, Prices: prices, Now: time.Now, Throttle: time.Second,
		last: map[string]float64{}, watches: map[string]func(){}, subs: map[chan Message]struct{}{}}
}

// Load reads the account and opens feeds for its symbols.
func (e *Engine) Load(ctx context.Context) error {
	a, err := e.Store.LoadAccount(ctx)
	if err != nil {
		return err
	}
	e.mu.Lock()
	e.acc = a
	for _, p := range a.Positions {
		if p.Last > 0 {
			e.last[p.Symbol] = p.Last
		}
	}
	e.syncLocked()
	e.mu.Unlock()
	return nil
}

// Run pushes throttled price-only snapshots until ctx ends.
func (e *Engine) Run(ctx context.Context) {
	t := time.NewTicker(e.Throttle)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			e.mu.Lock()
			for k, c := range e.watches {
				c()
				delete(e.watches, k)
			}
			e.mu.Unlock()
			return
		case <-t.C:
			e.mu.Lock()
			if e.dirty {
				e.dirty = false
				e.publishLocked(nil)
			}
			e.mu.Unlock()
		}
	}
}

// syncLocked watches exactly the symbols with working orders or open positions.
func (e *Engine) syncLocked() {
	if e.Live == nil {
		return
	}
	need := map[string]bool{}
	for _, s := range e.acc.Symbols() {
		need[s] = true
	}
	for s, cancel := range e.watches {
		if !need[s] {
			cancel()
			delete(e.watches, s)
		}
	}
	for s := range need {
		if _, ok := e.watches[s]; ok {
			continue
		}
		sym := s
		e.watches[sym] = e.Live.Watch(sym, "1m", func(m domain.LiveCandleMessage) {
			e.OnTick(sym, m.Candle.Close)
		})
	}
}

// Watched lists symbols with an open feed (tests, diagnostics).
func (e *Engine) Watched() []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	out := make([]string, 0, len(e.watches))
	for s := range e.watches {
		out = append(out, s)
	}
	return out
}

// OnTick applies a live price.
func (e *Engine) OnTick(sym string, price float64) {
	if !(price > 0) {
		return
	}
	sym = strings.ToUpper(sym)
	e.mu.Lock()
	defer e.mu.Unlock()
	e.last[sym] = price
	before := len(e.acc.Fills)
	evs := e.acc.OnPrice(sym, price, e.Now().Unix())
	if len(evs) == 0 {
		e.dirty = true
		return
	}
	e.commitLocked(context.Background(), evs, before)
}

// commitLocked persists, re-syncs feeds and publishes.
func (e *Engine) commitLocked(ctx context.Context, evs []Event, fillsBefore int) {
	newFills := []Fill{}
	if n := len(e.acc.Fills) - fillsBefore; n > 0 {
		if n > len(e.acc.Fills) {
			n = len(e.acc.Fills)
		}
		newFills = e.acc.Fills[:n]
	} else if fillsBefore >= MaxFills && len(evs) > 0 {
		// capped list: new fills are still at the front
		for _, ev := range evs {
			if ev.Kind == "filled" {
				for _, f := range e.acc.Fills {
					if f.OrderID == ev.OrderID {
						newFills = append(newFills, f)
						break
					}
				}
			}
		}
	}
	if err := e.Store.SaveAccount(ctx, e.acc, newFills); err != nil {
		log.Printf("trading: save: %v", err)
	}
	e.syncLocked()
	e.publishLocked(evs)
}

func (e *Engine) snapshotLocked() Snapshot {
	e.version++
	b := e.acc
	// copy slices so callers can't race with the engine
	b.Orders = append([]Order{}, e.acc.Orders...)
	b.Positions = append([]Position{}, e.acc.Positions...)
	b.Fills = append([]Fill{}, e.acc.Fills...)
	b.Closed = append([]Order{}, e.acc.Closed...)
	return Snapshot{Account: b, Summary: e.acc.Summarize(), Version: e.version}
}

func (e *Engine) publishLocked(evs []Event) {
	if evs == nil {
		evs = []Event{}
	}
	msg := Message{Events: evs, Snapshot: e.snapshotLocked()}
	e.lastPush = e.Now()
	e.subMu.Lock()
	for ch := range e.subs {
		select {
		case ch <- msg:
		default: // slow listener: it will catch up with the next snapshot
		}
	}
	e.subMu.Unlock()
}

// Subscribe registers an SSE listener.
func (e *Engine) Subscribe() (<-chan Message, func()) {
	ch := make(chan Message, 16)
	e.subMu.Lock()
	e.subs[ch] = struct{}{}
	e.subMu.Unlock()
	return ch, func() {
		e.subMu.Lock()
		if _, ok := e.subs[ch]; ok {
			delete(e.subs, ch)
			close(ch)
		}
		e.subMu.Unlock()
	}
}

// Snapshot returns the current state.
func (e *Engine) Snapshot() Snapshot {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.snapshotLocked()
}

// priceLocked returns the newest known price, asking Prices when no tick arrived yet.
// It releases the lock while fetching.
func (e *Engine) priceLocked(ctx context.Context, sym string) float64 {
	if p := e.last[sym]; p > 0 {
		return p
	}
	if e.Prices == nil {
		return 0
	}
	e.mu.Unlock()
	p, err := e.Prices.LastPrice(ctx, sym)
	e.mu.Lock()
	if err != nil || !(p > 0) {
		return e.last[sym]
	}
	if e.last[sym] <= 0 {
		e.last[sym] = p
	}
	return e.last[sym]
}

// mutate runs fn under the lock with the symbol's price and commits its events.
func (e *Engine) mutate(ctx context.Context, sym string, fn func(last float64, now int64) ([]Event, error)) ([]Event, error) {
	sym = strings.ToUpper(strings.TrimSpace(sym))
	e.mu.Lock()
	defer e.mu.Unlock()
	last := 0.0
	if sym != "" {
		last = e.priceLocked(ctx, sym)
	}
	before := len(e.acc.Fills)
	evs, err := fn(last, e.Now().Unix())
	if err != nil {
		if len(evs) > 0 {
			e.commitLocked(ctx, evs, before)
		}
		return evs, err
	}
	e.commitLocked(ctx, evs, before)
	return evs, nil
}

// Place submits a new order.
func (e *Engine) Place(ctx context.Context, r OrderRequest) (Order, []Event, error) {
	var out Order
	evs, err := e.mutate(ctx, r.Symbol, func(last float64, now int64) ([]Event, error) {
		o, evs, err := e.acc.Place(r, last, now)
		out = o
		return evs, err
	})
	return out, evs, err
}

// Modify changes a working order.
func (e *Engine) Modify(ctx context.Context, id string, p OrderPatch) (Order, []Event, error) {
	e.mu.Lock()
	_, o := e.acc.order(id)
	sym := ""
	if o != nil {
		sym = o.Symbol
	}
	e.mu.Unlock()
	if sym == "" {
		return Order{}, nil, ErrNotFound
	}
	var out Order
	evs, err := e.mutate(ctx, sym, func(last float64, now int64) ([]Event, error) {
		o, evs, err := e.acc.ModifyOrder(id, p, last, now)
		out = o
		return evs, err
	})
	return out, evs, err
}

// Cancel cancels a working order.
func (e *Engine) Cancel(ctx context.Context, id string) ([]Event, error) {
	return e.mutate(ctx, "", func(_ float64, now int64) ([]Event, error) { return e.acc.Cancel(id, now) })
}

// ClosePosition closes a position at market.
func (e *Engine) ClosePosition(ctx context.Context, sym string) ([]Event, error) {
	return e.mutate(ctx, sym, func(last float64, now int64) ([]Event, error) {
		if !(last > 0) {
			return nil, ErrNoPrice
		}
		return e.acc.ClosePosition(sym, last, now)
	})
}

// ReversePosition flips a position at market.
func (e *Engine) ReversePosition(ctx context.Context, sym string) ([]Event, error) {
	return e.mutate(ctx, sym, func(last float64, now int64) ([]Event, error) {
		if !(last > 0) {
			return nil, ErrNoPrice
		}
		return e.acc.ReversePosition(sym, last, now)
	})
}

// SetBrackets sets the position TP/SL.
func (e *Engine) SetBrackets(ctx context.Context, sym string, tp, sl float64) ([]Event, error) {
	return e.mutate(ctx, sym, func(last float64, now int64) ([]Event, error) {
		if p := e.acc.Position(strings.ToUpper(strings.TrimSpace(sym))); p != nil && last > 0 {
			p.Last = last
		}
		return e.acc.SetBrackets(sym, tp, sl, now)
	})
}

// Reset starts a new account.
func (e *Engine) Reset(ctx context.Context, initial, commissionPct float64) error {
	if initial < 0 || initial > 1e12 || commissionPct < 0 || commissionPct > 10 {
		return errors.New("başlangıç bakiyesi 0–1e12, komisyon 0–10 arası olmalı")
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.acc = NewAccount(initial, commissionPct)
	if err := e.Store.ClearFills(ctx); err != nil {
		return err
	}
	e.commitLocked(ctx, []Event{{Kind: "reset", Message: "Paper hesabı sıfırlandı", Time: e.Now().Unix()}}, 0)
	return nil
}
