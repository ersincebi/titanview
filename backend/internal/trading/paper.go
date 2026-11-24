// Package trading implements the server-side paper trading engine (all standard order
// types, brackets, netting positions) and a confirmed, signed Binance spot order client.
package trading

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
)

// Order types, sides and statuses (JSON values shared with the frontend).
const (
	TypeMarket    = "market"
	TypeLimit     = "limit"
	TypeStop      = "stop"
	TypeStopLimit = "stop_limit"

	SideBuy  = "buy"
	SideSell = "sell"

	StatusWorking   = "working"
	StatusFilled    = "filled"
	StatusCancelled = "cancelled"
	StatusRejected  = "rejected"

	RoleEntry = "entry"
	RoleTP    = "tp"
	RoleSL    = "sl"
)

// DefaultInitialBalance is the default paper account balance.
const DefaultInitialBalance = 100000.0

// MaxFills bounds the in-document fill history (older fills stay only in trading_fills).
const MaxFills = 500

// eps absorbs float noise when comparing quantities.
const eps = 1e-9

// Order is one paper order. Prices that do not apply to the type are 0.
type Order struct {
	ID         string  `json:"id"`
	Symbol     string  `json:"symbol"`
	Side       string  `json:"side"`
	Type       string  `json:"type"`
	Qty        float64 `json:"qty"`
	LimitPrice float64 `json:"limitPrice,omitempty"`
	StopPrice  float64 `json:"stopPrice,omitempty"`
	TakeProfit float64 `json:"takeProfit,omitempty"` // bracket attached to an entry order
	StopLoss   float64 `json:"stopLoss,omitempty"`
	Role       string  `json:"role"`
	ParentID   string  `json:"parentId,omitempty"`
	OcoGroup   string  `json:"ocoGroup,omitempty"`
	ReduceOnly bool    `json:"reduceOnly,omitempty"`
	Triggered  bool    `json:"triggered,omitempty"` // stop-limit: stop hit, now a limit
	Status     string  `json:"status"`
	Reason     string  `json:"reason,omitempty"`
	CreatedAt  int64   `json:"createdAt"`
	UpdatedAt  int64   `json:"updatedAt"`
	FilledAt   int64   `json:"filledAt,omitempty"`
	FillPrice  float64 `json:"fillPrice,omitempty"`
}

// Position is the net (signed) holding of one symbol.
type Position struct {
	Symbol   string  `json:"symbol"`
	Qty      float64 `json:"qty"` // >0 long, <0 short
	AvgPrice float64 `json:"avgPrice"`
	Last     float64 `json:"last"`
	OpenedAt int64   `json:"openedAt"`
	Realized float64 `json:"realized"` // realized P&L since the position opened
}

// Fill is one execution.
type Fill struct {
	ID         string  `json:"id"`
	OrderID    string  `json:"orderId"`
	Symbol     string  `json:"symbol"`
	Side       string  `json:"side"`
	Type       string  `json:"type"`
	Role       string  `json:"role"`
	Qty        float64 `json:"qty"`
	Price      float64 `json:"price"`
	Commission float64 `json:"commission"`
	Realized   float64 `json:"realized"` // P&L realized by this fill (before commission)
	Time       int64   `json:"time"`
}

// Account is the whole paper state, persisted as one JSON document.
type Account struct {
	InitialBalance float64    `json:"initialBalance"`
	Balance        float64    `json:"balance"` // cash: initial + realized - commissions
	CommissionPct  float64    `json:"commissionPct"`
	Orders         []Order    `json:"orders"`    // working orders only
	Positions      []Position `json:"positions"` // non-zero only
	Fills          []Fill     `json:"fills"`     // newest first, capped
	Closed         []Order    `json:"closed"`    // recently finished orders (filled/cancelled/rejected), newest first
	Seq            int64      `json:"seq"`
}

// NewAccount returns an empty account.
func NewAccount(initial, commissionPct float64) Account {
	if !(initial > 0) {
		initial = DefaultInitialBalance
	}
	if commissionPct < 0 || math.IsNaN(commissionPct) {
		commissionPct = 0
	}
	return Account{InitialBalance: initial, Balance: initial, CommissionPct: commissionPct, Orders: []Order{}, Positions: []Position{}, Fills: []Fill{}, Closed: []Order{}}
}

// OrderRequest is what a client submits.
type OrderRequest struct {
	Symbol     string  `json:"symbol"`
	Side       string  `json:"side"`
	Type       string  `json:"type"`
	Qty        float64 `json:"qty"`
	LimitPrice float64 `json:"limitPrice"`
	StopPrice  float64 `json:"stopPrice"`
	TakeProfit float64 `json:"takeProfit"`
	StopLoss   float64 `json:"stopLoss"`
	ReduceOnly bool    `json:"reduceOnly"`
}

// OrderPatch modifies a working order; zero fields are left unchanged, negative TP/SL removes them.
type OrderPatch struct {
	Qty        float64 `json:"qty"`
	LimitPrice float64 `json:"limitPrice"`
	StopPrice  float64 `json:"stopPrice"`
	TakeProfit float64 `json:"takeProfit"`
	StopLoss   float64 `json:"stopLoss"`
}

// Event describes what changed (pushed to SSE listeners).
type Event struct {
	Kind    string `json:"kind"` // placed | filled | cancelled | rejected | modified | reset
	OrderID string `json:"orderId,omitempty"`
	Symbol  string `json:"symbol,omitempty"`
	Message string `json:"message"`
	Time    int64  `json:"time"`
}

// Validation errors.
var (
	ErrNotFound = errors.New("emir bulunamadı")
	ErrNoPrice  = errors.New("sembol için güncel fiyat yok")
)

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

// roundQty trims float noise from quantities (10 decimals covers every exchange step size).
func roundQty(v float64) float64 { return math.Round(v*1e10) / 1e10 }

func opposite(side string) string {
	if side == SideBuy {
		return SideSell
	}
	return SideBuy
}

func sideSign(side string) float64 {
	if side == SideBuy {
		return 1
	}
	return -1
}

func (a *Account) nextID(prefix string) string {
	a.Seq++
	return fmt.Sprintf("%s%d", prefix, a.Seq)
}

// Position returns a pointer to the symbol's position (nil when flat).
func (a *Account) Position(sym string) *Position {
	for i := range a.Positions {
		if a.Positions[i].Symbol == sym {
			return &a.Positions[i]
		}
	}
	return nil
}

func (a *Account) order(id string) (int, *Order) {
	for i := range a.Orders {
		if a.Orders[i].ID == id {
			return i, &a.Orders[i]
		}
	}
	return -1, nil
}

// Unrealized is open P&L of one position at its last price.
func (p Position) Unrealized() float64 { return (p.Last - p.AvgPrice) * p.Qty }

// Summary is the account account summary header.
type Summary struct {
	Balance        float64 `json:"balance"`
	Equity         float64 `json:"equity"`
	Unrealized     float64 `json:"unrealized"`
	Realized       float64 `json:"realized"`
	MarginUsed     float64 `json:"marginUsed"`
	Available      float64 `json:"available"`
	InitialBalance float64 `json:"initialBalance"`
}

// Summarize computes balances.
func (a *Account) Summarize() Summary {
	var u, used float64
	for _, p := range a.Positions {
		u += p.Unrealized()
		used += math.Abs(p.Qty) * p.Last
	}
	eq := a.Balance + u
	return Summary{
		Balance: a.Balance, Equity: eq, Unrealized: u, Realized: a.Balance - a.InitialBalance,
		MarginUsed: used, Available: eq - used, InitialBalance: a.InitialBalance,
	}
}

func normalizeReq(r *OrderRequest) error {
	r.Symbol = strings.ToUpper(strings.TrimSpace(r.Symbol))
	r.Side = strings.ToLower(strings.TrimSpace(r.Side))
	r.Type = strings.ToLower(strings.TrimSpace(r.Type))
	if r.Symbol == "" || len(r.Symbol) > 40 {
		return errors.New("sembol gerekli")
	}
	if r.Side != SideBuy && r.Side != SideSell {
		return errors.New("yön buy veya sell olmalı")
	}
	switch r.Type {
	case TypeMarket, TypeLimit, TypeStop, TypeStopLimit:
	default:
		return errors.New("emir türü market, limit, stop veya stop_limit olmalı")
	}
	for _, v := range []float64{r.Qty, r.LimitPrice, r.StopPrice, r.TakeProfit, r.StopLoss} {
		if !finite(v) || v < 0 {
			return errors.New("geçersiz sayı")
		}
	}
	if !(r.Qty > 0) {
		return errors.New("adet sıfırdan büyük olmalı")
	}
	if (r.Type == TypeLimit || r.Type == TypeStopLimit) && !(r.LimitPrice > 0) {
		return errors.New("limit fiyatı gerekli")
	}
	if (r.Type == TypeStop || r.Type == TypeStopLimit) && !(r.StopPrice > 0) {
		return errors.New("stop fiyatı gerekli")
	}
	return nil
}

// refPrice is the price at which the entry is expected to fill (for bracket validation).
func refPrice(r OrderRequest, last float64) float64 {
	switch r.Type {
	case TypeLimit, TypeStopLimit:
		return r.LimitPrice
	case TypeStop:
		return r.StopPrice
	}
	return last
}

func validateBracket(side string, entry, tp, sl float64) error {
	if side == SideBuy {
		if tp > 0 && tp <= entry {
			return errors.New("alışta kâr al fiyatı giriş fiyatının üzerinde olmalı")
		}
		if sl > 0 && sl >= entry {
			return errors.New("alışta zarar durdur fiyatı giriş fiyatının altında olmalı")
		}
	} else {
		if tp > 0 && tp >= entry {
			return errors.New("satışta kâr al fiyatı giriş fiyatının altında olmalı")
		}
		if sl > 0 && sl <= entry {
			return errors.New("satışta zarar durdur fiyatı giriş fiyatının üzerinde olmalı")
		}
	}
	return nil
}

func validateStop(side string, stop, last float64) error {
	if last <= 0 {
		return nil
	}
	if side == SideBuy && stop <= last {
		return fmt.Errorf("alış stop fiyatı piyasanın (%.8g) üzerinde olmalı", last)
	}
	if side == SideSell && stop >= last {
		return fmt.Errorf("satış stop fiyatı piyasanın (%.8g) altında olmalı", last)
	}
	return nil
}

// Place validates and adds an order, then matches it against last (if > 0).
// Market orders need last > 0. Returns the stored order and events.
func (a *Account) Place(r OrderRequest, last float64, now int64) (Order, []Event, error) {
	if err := normalizeReq(&r); err != nil {
		return Order{}, nil, err
	}
	if r.Type == TypeMarket && !(last > 0) {
		return Order{}, nil, ErrNoPrice
	}
	if r.Type == TypeStop || r.Type == TypeStopLimit {
		if err := validateStop(r.Side, r.StopPrice, last); err != nil {
			return Order{}, nil, err
		}
	}
	if err := validateBracket(r.Side, refPrice(r, last), r.TakeProfit, r.StopLoss); err != nil {
		return Order{}, nil, err
	}
	if r.ReduceOnly {
		p := a.Position(r.Symbol)
		if p == nil || sideSign(r.Side)*p.Qty >= 0 {
			return Order{}, nil, errors.New("yalnız azalt: kapatılacak ters pozisyon yok")
		}
	}
	o := Order{
		ID: a.nextID("o"), Symbol: r.Symbol, Side: r.Side, Type: r.Type, Qty: r.Qty,
		LimitPrice: r.LimitPrice, StopPrice: r.StopPrice, TakeProfit: r.TakeProfit, StopLoss: r.StopLoss,
		Role: RoleEntry, ReduceOnly: r.ReduceOnly, Status: StatusWorking, CreatedAt: now, UpdatedAt: now,
	}
	if o.Type != TypeLimit && o.Type != TypeStopLimit {
		o.LimitPrice = 0
	}
	if o.Type != TypeStop && o.Type != TypeStopLimit {
		o.StopPrice = 0
	}
	a.Orders = append(a.Orders, o)
	evs := []Event{{Kind: "placed", OrderID: o.ID, Symbol: o.Symbol, Message: describe(o) + " gönderildi", Time: now}}
	if last > 0 {
		evs = append(evs, a.OnPrice(o.Symbol, last, now)...)
	}
	_, cur := a.order(o.ID)
	if cur != nil {
		return *cur, evs, nil
	}
	for _, c := range a.Closed {
		if c.ID == o.ID {
			return c, evs, nil
		}
	}
	return o, evs, nil
}

func describe(o Order) string {
	side := "AL"
	if o.Side == SideSell {
		side = "SAT"
	}
	kind := map[string]string{TypeMarket: "Piyasa", TypeLimit: "Limit", TypeStop: "Stop", TypeStopLimit: "Stop-Limit"}[o.Type]
	role := ""
	switch o.Role {
	case RoleTP:
		role = " (Kâr Al)"
	case RoleSL:
		role = " (Zarar Durdur)"
	}
	return fmt.Sprintf("%s %s %s %g%s", o.Symbol, kind, side, o.Qty, role)
}

// ModifyOrder changes prices/qty/brackets of a working order and re-matches.
func (a *Account) ModifyOrder(id string, p OrderPatch, last float64, now int64) (Order, []Event, error) {
	_, o := a.order(id)
	if o == nil {
		return Order{}, nil, ErrNotFound
	}
	for _, v := range []float64{p.Qty, p.LimitPrice, p.StopPrice, p.TakeProfit, p.StopLoss} {
		if !finite(v) {
			return Order{}, nil, errors.New("geçersiz sayı")
		}
	}
	next := *o
	if p.Qty > 0 {
		next.Qty = p.Qty
	}
	if p.LimitPrice > 0 {
		if next.Type != TypeLimit && next.Type != TypeStopLimit {
			return Order{}, nil, errors.New("bu emirde limit fiyatı yok")
		}
		next.LimitPrice = p.LimitPrice
	}
	if p.StopPrice > 0 {
		if next.Type != TypeStop && next.Type != TypeStopLimit {
			return Order{}, nil, errors.New("bu emirde stop fiyatı yok")
		}
		if next.Triggered {
			return Order{}, nil, errors.New("stop zaten tetiklendi")
		}
		if err := validateStop(next.Side, p.StopPrice, last); err != nil {
			return Order{}, nil, err
		}
		next.StopPrice = p.StopPrice
	}
	if next.Role == RoleEntry {
		if p.TakeProfit > 0 {
			next.TakeProfit = p.TakeProfit
		} else if p.TakeProfit < 0 {
			next.TakeProfit = 0
		}
		if p.StopLoss > 0 {
			next.StopLoss = p.StopLoss
		} else if p.StopLoss < 0 {
			next.StopLoss = 0
		}
		req := OrderRequest{Type: next.Type, LimitPrice: next.LimitPrice, StopPrice: next.StopPrice}
		if err := validateBracket(next.Side, refPrice(req, last), next.TakeProfit, next.StopLoss); err != nil {
			return Order{}, nil, err
		}
	}
	next.UpdatedAt = now
	*o = next
	evs := []Event{{Kind: "modified", OrderID: id, Symbol: next.Symbol, Message: describe(next) + " değiştirildi", Time: now}}
	if last > 0 {
		evs = append(evs, a.OnPrice(next.Symbol, last, now)...)
	}
	return next, evs, nil
}

// Cancel removes a working order (its OCO sibling stays: cancelling TP keeps SL).
func (a *Account) Cancel(id string, now int64) ([]Event, error) {
	i, o := a.order(id)
	if o == nil {
		return nil, ErrNotFound
	}
	done := *o
	done.Status, done.UpdatedAt = StatusCancelled, now
	a.Orders = append(a.Orders[:i], a.Orders[i+1:]...)
	a.remember(done)
	return []Event{{Kind: "cancelled", OrderID: id, Symbol: done.Symbol, Message: describe(done) + " iptal edildi", Time: now}}, nil
}

func (a *Account) remember(o Order) {
	a.Closed = append([]Order{o}, a.Closed...)
	if len(a.Closed) > MaxFills {
		a.Closed = a.Closed[:MaxFills]
	}
}

// SetBrackets creates, moves or removes the position-level TP/SL (tp/sl < 0 removes, 0 keeps).
func (a *Account) SetBrackets(sym string, tp, sl float64, ts int64) ([]Event, error) {
	sym = strings.ToUpper(strings.TrimSpace(sym))
	pos := a.Position(sym)
	if pos == nil {
		return nil, errors.New("açık pozisyon yok")
	}
	if !finite(tp) || !finite(sl) {
		return nil, errors.New("geçersiz sayı")
	}
	side := SideBuy
	if pos.Qty < 0 {
		side = SideSell
	}
	// Validate against the current price so a TP is never instantly marketable at the wrong side.
	ref := pos.Last
	if ref <= 0 {
		ref = pos.AvgPrice
	}
	if err := validateBracket(side, ref, math.Max(tp, 0), math.Max(sl, 0)); err != nil {
		return nil, err
	}
	var evs []Event
	group := ""
	for _, o := range a.Orders {
		if o.Symbol == sym && o.ReduceOnly && o.OcoGroup != "" && (o.Role == RoleTP || o.Role == RoleSL) {
			group = o.OcoGroup
			break
		}
	}
	if group == "" {
		group = a.nextID("g")
	}
	apply := func(role string, price float64) error {
		var existing *Order
		for i := range a.Orders {
			o := &a.Orders[i]
			if o.Symbol == sym && o.ReduceOnly && o.Role == role {
				existing = o
				break
			}
		}
		switch {
		case price < 0 && existing != nil:
			e, err := a.Cancel(existing.ID, ts)
			if err != nil {
				return err
			}
			evs = append(evs, e...)
		case price > 0 && existing != nil:
			if role == RoleTP {
				existing.LimitPrice = price
			} else {
				existing.StopPrice = price
			}
			existing.Qty = math.Abs(pos.Qty)
			existing.UpdatedAt = ts
			evs = append(evs, Event{Kind: "modified", OrderID: existing.ID, Symbol: sym, Message: describe(*existing) + " taşındı", Time: ts})
		case price > 0:
			o := Order{ID: a.nextID("o"), Symbol: sym, Side: opposite(side), Qty: math.Abs(pos.Qty), Role: role,
				OcoGroup: group, ReduceOnly: true, Status: StatusWorking, CreatedAt: ts, UpdatedAt: ts}
			if role == RoleTP {
				o.Type, o.LimitPrice = TypeLimit, price
			} else {
				o.Type, o.StopPrice = TypeStop, price
			}
			a.Orders = append(a.Orders, o)
			evs = append(evs, Event{Kind: "placed", OrderID: o.ID, Symbol: sym, Message: describe(o) + " eklendi", Time: ts})
		}
		return nil
	}
	if err := apply(RoleTP, tp); err != nil {
		return evs, err
	}
	if err := apply(RoleSL, sl); err != nil {
		return evs, err
	}
	if pos.Last > 0 {
		evs = append(evs, a.OnPrice(sym, pos.Last, ts)...)
	}
	return evs, nil
}

// ClosePosition sends a reduce-only market order for the whole position.
func (a *Account) ClosePosition(sym string, last float64, now int64) ([]Event, error) {
	sym = strings.ToUpper(strings.TrimSpace(sym))
	pos := a.Position(sym)
	if pos == nil {
		return nil, errors.New("açık pozisyon yok")
	}
	side := SideSell
	if pos.Qty < 0 {
		side = SideBuy
	}
	_, evs, err := a.Place(OrderRequest{Symbol: sym, Side: side, Type: TypeMarket, Qty: math.Abs(pos.Qty), ReduceOnly: true}, last, now)
	return evs, err
}

// ReversePosition flips the position with one market order of twice its size.
func (a *Account) ReversePosition(sym string, last float64, now int64) ([]Event, error) {
	sym = strings.ToUpper(strings.TrimSpace(sym))
	pos := a.Position(sym)
	if pos == nil {
		return nil, errors.New("açık pozisyon yok")
	}
	side := SideSell
	if pos.Qty < 0 {
		side = SideBuy
	}
	_, evs, err := a.Place(OrderRequest{Symbol: sym, Side: side, Type: TypeMarket, Qty: 2 * math.Abs(pos.Qty)}, last, now)
	return evs, err
}

// fillPrice decides whether o fills at price p and at which price.
func fillPrice(o *Order, p float64) (float64, bool) {
	buy := o.Side == SideBuy
	switch o.Type {
	case TypeMarket:
		return p, true
	case TypeLimit:
		if buy && p <= o.LimitPrice {
			return math.Min(p, o.LimitPrice), true
		}
		if !buy && p >= o.LimitPrice {
			return math.Max(p, o.LimitPrice), true
		}
	case TypeStop:
		if (buy && p >= o.StopPrice) || (!buy && p <= o.StopPrice) {
			return p, true
		}
	case TypeStopLimit:
		if !o.Triggered && ((buy && p >= o.StopPrice) || (!buy && p <= o.StopPrice)) {
			o.Triggered = true
		}
		if o.Triggered {
			if buy && p <= o.LimitPrice {
				return math.Min(p, o.LimitPrice), true
			}
			if !buy && p >= o.LimitPrice {
				return math.Max(p, o.LimitPrice), true
			}
		}
	}
	return 0, false
}

// OnPrice marks positions to p and fills every order of sym that p reaches.
// Orders are processed in creation order; fills can create/cancel bracket orders, so it loops.
func (a *Account) OnPrice(sym string, p float64, now int64) []Event {
	if !(p > 0) || !finite(p) {
		return nil
	}
	if pos := a.Position(sym); pos != nil {
		pos.Last = p
	}
	var evs []Event
	for guard := 0; guard < 64; guard++ {
		idx := -1
		var price float64
		for i := range a.Orders {
			o := &a.Orders[i]
			if o.Symbol != sym {
				continue
			}
			if fp, ok := fillPrice(o, p); ok {
				idx, price = i, fp
				break
			}
		}
		if idx < 0 {
			break
		}
		evs = append(evs, a.execute(idx, price, now)...)
	}
	return evs
}

// execute fills order idx at price (removes it from working orders).
func (a *Account) execute(idx int, price float64, now int64) []Event {
	o := a.Orders[idx]
	a.Orders = append(a.Orders[:idx], a.Orders[idx+1:]...)
	pos := a.Position(o.Symbol)
	qty := o.Qty
	if o.ReduceOnly {
		if pos == nil || sideSign(o.Side)*pos.Qty >= 0 {
			o.Status, o.Reason, o.UpdatedAt = StatusCancelled, "pozisyon yok", now
			a.remember(o)
			return []Event{{Kind: "cancelled", OrderID: o.ID, Symbol: o.Symbol, Message: describe(o) + " iptal (pozisyon kapalı)", Time: now}}
		}
		qty = math.Min(qty, math.Abs(pos.Qty))
	}
	// Buying power: only the part that opens/increases exposure needs cash.
	cur := 0.0
	if pos != nil {
		cur = pos.Qty
	}
	signed := sideSign(o.Side) * qty
	newQty := roundQty(cur + signed) // 0.01 - 0.001 → 0.009 (kayan nokta gürültüsü yok)
	if math.Abs(newQty) > math.Abs(cur)+eps || cur*newQty < 0 {
		opening := math.Abs(newQty)
		if cur*newQty > 0 {
			opening = math.Abs(newQty) - math.Abs(cur)
		}
		s := a.Summarize()
		avail := s.Available
		if cur*newQty < 0 && pos != nil { // reversing: the closed side frees its margin first
			avail += math.Abs(cur) * pos.Last
		}
		need := opening * price * (1 + a.CommissionPct/100)
		if need > avail+eps {
			o.Status, o.UpdatedAt = StatusRejected, now
			o.Reason = fmt.Sprintf("yetersiz alım gücü: gereken %.2f, kullanılabilir %.2f", need, avail)
			a.remember(o)
			return []Event{{Kind: "rejected", OrderID: o.ID, Symbol: o.Symbol, Message: describe(o) + " reddedildi: " + o.Reason, Time: now}}
		}
	}
	commission := qty * price * a.CommissionPct / 100
	realized := 0.0
	switch {
	case pos == nil:
		a.Positions = append(a.Positions, Position{Symbol: o.Symbol, Qty: signed, AvgPrice: price, Last: price, OpenedAt: now})
	case cur*signed > 0: // increase
		pos.AvgPrice = (pos.AvgPrice*math.Abs(cur) + price*qty) / (math.Abs(cur) + qty)
		pos.Qty = newQty
		pos.Last = price
	default: // reduce / close / reverse
		closing := math.Min(qty, math.Abs(cur))
		realized = (price - pos.AvgPrice) * closing * math.Copysign(1, cur)
		pos.Realized += realized
		pos.Last = price
		if math.Abs(newQty) < eps {
			a.removePosition(o.Symbol)
		} else if cur*newQty < 0 { // reversed: rest opens at fill price
			pos.Qty, pos.AvgPrice, pos.OpenedAt, pos.Realized = newQty, price, now, 0
		} else {
			pos.Qty = newQty
		}
	}
	a.Balance += realized - commission
	o.Status, o.FillPrice, o.FilledAt, o.UpdatedAt = StatusFilled, price, now, now
	o.Qty = qty
	a.remember(o)
	f := Fill{ID: a.nextID("f"), OrderID: o.ID, Symbol: o.Symbol, Side: o.Side, Type: o.Type, Role: o.Role,
		Qty: qty, Price: price, Commission: commission, Realized: realized, Time: now}
	a.Fills = append([]Fill{f}, a.Fills...)
	if len(a.Fills) > MaxFills {
		a.Fills = a.Fills[:MaxFills]
	}
	evs := []Event{{Kind: "filled", OrderID: o.ID, Symbol: o.Symbol, Message: fmt.Sprintf("%s %.8g fiyatından doldu", describe(o), price), Time: now}}

	// OCO: a filled TP cancels its SL and vice versa.
	if o.OcoGroup != "" {
		evs = append(evs, a.cancelWhere(func(x Order) bool { return x.OcoGroup == o.OcoGroup }, now, "OCO")...)
	}
	// Flat or reversed: the old TP/SL no longer protect anything — drop every reduce-only order.
	if a.Position(o.Symbol) == nil {
		evs = append(evs, a.cancelWhere(func(x Order) bool { return x.Symbol == o.Symbol && x.ReduceOnly }, now, "pozisyon kapandı")...)
	} else if cur*newQty < 0 {
		evs = append(evs, a.cancelWhere(func(x Order) bool { return x.Symbol == o.Symbol && x.ReduceOnly }, now, "pozisyon ters döndü")...)
	} else {
		a.resizeReduceOnly(o.Symbol)
	}
	// Entry bracket: open the TP/SL OCO pair for the filled quantity.
	if o.Role == RoleEntry && (o.TakeProfit > 0 || o.StopLoss > 0) && a.Position(o.Symbol) != nil {
		group := a.nextID("g")
		if o.TakeProfit > 0 {
			a.Orders = append(a.Orders, Order{ID: a.nextID("o"), Symbol: o.Symbol, Side: opposite(o.Side), Type: TypeLimit,
				Qty: qty, LimitPrice: o.TakeProfit, Role: RoleTP, ParentID: o.ID, OcoGroup: group, ReduceOnly: true,
				Status: StatusWorking, CreatedAt: now, UpdatedAt: now})
		}
		if o.StopLoss > 0 {
			a.Orders = append(a.Orders, Order{ID: a.nextID("o"), Symbol: o.Symbol, Side: opposite(o.Side), Type: TypeStop,
				Qty: qty, StopPrice: o.StopLoss, Role: RoleSL, ParentID: o.ID, OcoGroup: group, ReduceOnly: true,
				Status: StatusWorking, CreatedAt: now, UpdatedAt: now})
		}
	}
	return evs
}

func (a *Account) removePosition(sym string) {
	out := a.Positions[:0]
	for _, p := range a.Positions {
		if p.Symbol != sym {
			out = append(out, p)
		}
	}
	a.Positions = out
}

// resizeReduceOnly keeps reduce-only orders no larger than the position.
func (a *Account) resizeReduceOnly(sym string) {
	pos := a.Position(sym)
	if pos == nil {
		return
	}
	for i := range a.Orders {
		o := &a.Orders[i]
		if o.Symbol == sym && o.ReduceOnly && o.Qty > math.Abs(pos.Qty) {
			o.Qty = math.Abs(pos.Qty)
		}
	}
}

func (a *Account) cancelWhere(match func(Order) bool, now int64, why string) []Event {
	var evs []Event
	keep := a.Orders[:0]
	var gone []Order
	for _, o := range a.Orders {
		if match(o) {
			gone = append(gone, o)
		} else {
			keep = append(keep, o)
		}
	}
	a.Orders = keep
	for _, o := range gone {
		o.Status, o.Reason, o.UpdatedAt = StatusCancelled, why, now
		a.remember(o)
		evs = append(evs, Event{Kind: "cancelled", OrderID: o.ID, Symbol: o.Symbol, Message: describe(o) + " iptal (" + why + ")", Time: now})
	}
	return evs
}

// Symbols lists symbols that need a live feed (working orders or open positions), sorted.
func (a *Account) Symbols() []string {
	set := map[string]bool{}
	for _, o := range a.Orders {
		set[o.Symbol] = true
	}
	for _, p := range a.Positions {
		set[p.Symbol] = true
	}
	out := make([]string, 0, len(set))
	for s := range set {
		out = append(out, s)
	}
	sort.Strings(out)
	return out
}
