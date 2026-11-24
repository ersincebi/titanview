// Package alerts is TitanView's server-side alert engine (Faz 23): alerts keep running while no browser is
// open. Price, indicator-plot, drawing (trend line / channel) and script alertcondition / alert() / strategy
// order-fill alerts are evaluated on live candles from the hub; firings go to the in-app log (SSE), Web Push,
// webhooks and Telegram.
package alerts

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/ersincebi/titanview/backend/internal/domain"
)

// Alert kinds.
const (
	KindCondition = "condition" // Source <condition> Target / channel / moving
	KindScript      = "script"      // a TitanScript's alertcondition(), alert() calls or strategy order fills
)

// Supported alert conditions.
const (
	CondCrossing        = "crossing"
	CondCrossingUp      = "crossing_up"
	CondCrossingDown    = "crossing_down"
	CondGreaterThan     = "greater_than"
	CondLessThan        = "less_than"
	CondEnteringChannel = "entering_channel"
	CondExitingChannel  = "exiting_channel"
	CondInsideChannel   = "inside_channel"
	CondOutsideChannel  = "outside_channel"
	CondMovingUp        = "moving_up"
	CondMovingDown      = "moving_down"
	CondMovingUpPct     = "moving_up_pct"
	CondMovingDownPct   = "moving_down_pct"
)

// AllConditions lists every supported condition.
var AllConditions = []string{
	CondCrossing, CondCrossingUp, CondCrossingDown, CondGreaterThan, CondLessThan,
	CondEnteringChannel, CondExitingChannel, CondInsideChannel, CondOutsideChannel,
	CondMovingUp, CondMovingDown, CondMovingUpPct, CondMovingDownPct,
}

// Supported alert triggers.
const (
	TrigOnce            = "once"               // Only once
	TrigOncePerBar      = "once_per_bar"       // Once per bar
	TrigOncePerBarClose = "once_per_bar_close" // Once per bar close
	TrigOncePerMinute   = "once_per_minute"    // Once per minute
)

// Script events.
const (
	ScriptAlertCondition   = "alertcondition"     // a named alertcondition()
	ScriptAlertCalls       = "alert_calls"        // any alert() function call
	ScriptOrderFills       = "order_fills"        // strategy order fills only
	ScriptOrderFillsAlerts = "order_fills_alerts" // strategy order fills and alert() calls
)

// Statuses.
const (
	StatusActive    = "active"
	StatusStopped   = "stopped"
	StatusTriggered = "triggered" // "Only once" alert that fired
	StatusExpired   = "expired"
	StatusError     = "error"
)

// Point is a drawing anchor (unix seconds, price).
type Point struct {
	Time  int64   `json:"time"`
	Price float64 `json:"price"`
}

// Line is a straight drawing line A→B interpolated in bar-index space (as the chart draws it).
// Without extension the line only exists between its anchors.
type Line struct {
	A           Point `json:"a"`
	B           Point `json:"b"`
	ExtendLeft  bool  `json:"extendLeft,omitempty"`
	ExtendRight bool  `json:"extendRight,omitempty"`
}

// Study is a TitanScript (built-in .titan indicator or user script) with its input overrides.
type Study struct {
	ID     string                     `json:"id,omitempty"`
	Name   string                     `json:"name"`
	Code   string                     `json:"code"`
	Inputs map[string]json.RawMessage `json:"inputs,omitempty"`
}

// Operand is one side of a condition.
type Operand struct {
	Kind  string  `json:"kind"`            // price | value | plot | line
	Field string  `json:"field,omitempty"` // price: close (default) open high low hl2 hlc3 ohlc4 volume
	Value float64 `json:"value,omitempty"` // value
	Study *Study  `json:"study,omitempty"` // plot
	Plot  string  `json:"plot,omitempty"`  // plot title / id / plot_N
	Line  *Line   `json:"line,omitempty"`  // line
}

// Notify selects the delivery channels.
type Notify struct {
	App      bool   `json:"app"`               // in-app log + toast
	Popup    bool   `json:"popup"`             // modal popup in the UI
	Sound    bool   `json:"sound"`             // UI plays a sound
	Push     bool   `json:"push"`              // Web Push to every subscribed browser
	Webhook  string `json:"webhook,omitempty"` // POST URL
	Telegram bool   `json:"telegram"`          // Telegram bot (config in /api/alerts/config)
	Ntfy     bool   `json:"ntfy,omitempty"`    // phone push via ntfy (config in /api/alerts/config)
}

// Alert is one stored alert.
type Alert struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Symbol   string `json:"symbol"`
	Interval string `json:"interval"`
	Kind     string `json:"kind"`

	Source    Operand  `json:"source"`
	Condition string   `json:"condition,omitempty"`
	Target    *Operand `json:"target,omitempty"`
	Upper     *Operand `json:"upper,omitempty"`
	Lower     *Operand `json:"lower,omitempty"`
	Amount    float64  `json:"amount,omitempty"`
	Bars      int      `json:"bars,omitempty"`

	Study          *Study `json:"study,omitempty"`
	ScriptEvent      string `json:"scriptEvent,omitempty"`
	ConditionTitle string `json:"conditionTitle,omitempty"`

	Trigger   string `json:"trigger"`
	ExpiresAt int64  `json:"expiresAt,omitempty"` // unix seconds; 0 = open-ended
	Message   string `json:"message"`
	Notify    Notify `json:"notify"`
	// DrawingID links a drawing alert back to its chart object (UI only).
	DrawingID string `json:"drawingId,omitempty"`

	Status      string `json:"status"`
	StatusMsg   string `json:"statusMsg,omitempty"`
	CreatedAt   int64  `json:"createdAt"`
	UpdatedAt   int64  `json:"updatedAt"`
	LastFiredAt int64  `json:"lastFiredAt,omitempty"`
	FireCount   int    `json:"fireCount"`
}

// Delivery is the outcome of one channel for one firing.
type Delivery struct {
	Channel string `json:"channel"`
	OK      bool   `json:"ok"`
	Detail  string `json:"detail,omitempty"`
}

// LogEntry is one firing in the alert log.
type LogEntry struct {
	ID         int64      `json:"id"`
	AlertID    string     `json:"alertId"`
	Name       string     `json:"name"`
	Symbol     string     `json:"symbol"`
	Interval   string     `json:"interval"`
	Time       int64      `json:"time"`    // unix ms when it fired
	BarTime    int64      `json:"barTime"` // unix seconds of the bar
	Price      float64    `json:"price"`
	Message    string     `json:"message"`
	Notify     Notify     `json:"notify"`
	Deliveries []Delivery `json:"deliveries,omitempty"`
}

var priceFields = map[string]bool{"": true, "close": true, "open": true, "high": true, "low": true, "hl2": true, "hlc3": true, "ohlc4": true, "volume": true}

const maxCodeBytes = 256 << 10

func (o *Operand) validate(name string) error {
	switch o.Kind {
	case "price":
		if !priceFields[o.Field] {
			return fmt.Errorf("%s: unknown price field %q", name, o.Field)
		}
	case "value":
		if o.Value != o.Value { // NaN
			return fmt.Errorf("%s: value is NaN", name)
		}
	case "plot":
		if err := o.Study.validate(name); err != nil {
			return err
		}
		if strings.TrimSpace(o.Plot) == "" {
			return fmt.Errorf("%s: plot is required", name)
		}
	case "line":
		if o.Line == nil {
			return fmt.Errorf("%s: line is required", name)
		}
		if o.Line.A.Time <= 0 || o.Line.B.Time <= 0 {
			return fmt.Errorf("%s: line anchors need times", name)
		}
	default:
		return fmt.Errorf("%s: unknown operand kind %q", name, o.Kind)
	}
	return nil
}

func (s *Study) validate(name string) error {
	if s == nil || strings.TrimSpace(s.Code) == "" {
		return fmt.Errorf("%s: script code is required", name)
	}
	if len(s.Code) > maxCodeBytes {
		return fmt.Errorf("%s: script code too large", name)
	}
	return nil
}

func isChannel(c string) bool {
	return c == CondEnteringChannel || c == CondExitingChannel || c == CondInsideChannel || c == CondOutsideChannel
}

func isMoving(c string) bool {
	return c == CondMovingUp || c == CondMovingDown || c == CondMovingUpPct || c == CondMovingDownPct
}

// Normalize fills defaults and validates. It never touches runtime fields (status, counters).
func (a *Alert) Normalize() error {
	a.Symbol = domain.NormalizeSymbol(a.Symbol)
	if a.Symbol == "" || len(a.Symbol) > 40 {
		return errors.New("symbol is required")
	}
	if a.Interval == "" {
		a.Interval = "1m"
	}
	if !domain.IsValidTimeframe(a.Interval) {
		return fmt.Errorf("unknown interval %q", a.Interval)
	}
	a.Interval = domain.NormalizeTimeframe(a.Interval)
	a.Name = strings.TrimSpace(a.Name)
	if len(a.Name) > 120 || len(a.Message) > 4000 {
		return errors.New("name/message too long")
	}
	switch a.Trigger {
	case "":
		a.Trigger = TrigOnce
	case TrigOnce, TrigOncePerBar, TrigOncePerBarClose, TrigOncePerMinute:
	default:
		return fmt.Errorf("unknown trigger %q", a.Trigger)
	}
	if a.Notify.Webhook != "" {
		u, err := url.Parse(a.Notify.Webhook)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return errors.New("webhook must be an http(s) URL")
		}
	}
	switch a.Kind {
	case "", KindCondition:
		a.Kind = KindCondition
		return a.normalizeCondition()
	case KindScript:
		if err := a.Study.validate("study"); err != nil {
			return err
		}
		switch a.ScriptEvent {
		case ScriptAlertCondition:
			if strings.TrimSpace(a.ConditionTitle) == "" {
				return errors.New("conditionTitle is required")
			}
		case ScriptAlertCalls, ScriptOrderFills, ScriptOrderFillsAlerts:
		default:
			return fmt.Errorf("unknown scriptEvent %q", a.ScriptEvent)
		}
		return nil
	default:
		return fmt.Errorf("unknown kind %q", a.Kind)
	}
}

func (a *Alert) normalizeCondition() error {
	if a.Source.Kind == "" {
		a.Source.Kind = "price"
	}
	if a.Source.Kind != "price" && a.Source.Kind != "plot" {
		return errors.New("source must be price or plot")
	}
	if err := a.Source.validate("source"); err != nil {
		return err
	}
	switch {
	case isChannel(a.Condition):
		if a.Upper == nil || a.Lower == nil {
			return errors.New("channel conditions need upper and lower bounds")
		}
		if err := a.Upper.validate("upper"); err != nil {
			return err
		}
		return a.Lower.validate("lower")
	case isMoving(a.Condition):
		if !(a.Amount > 0) {
			return errors.New("moving conditions need a positive amount")
		}
		if a.Bars < 1 || a.Bars > 5000 {
			return errors.New("moving conditions need bars in 1..5000")
		}
		return nil
	case a.Condition == CondCrossing || a.Condition == CondCrossingUp || a.Condition == CondCrossingDown ||
		a.Condition == CondGreaterThan || a.Condition == CondLessThan:
		if a.Target == nil {
			return errors.New("target is required")
		}
		return a.Target.validate("target")
	default:
		return fmt.Errorf("unknown condition %q", a.Condition)
	}
}

// Studies returns every distinct script study the alert needs evaluated.
func (a *Alert) Studies() []*Study {
	var out []*Study
	add := func(s *Study) {
		if s != nil {
			out = append(out, s)
		}
	}
	if a.Kind == KindScript {
		add(a.Study)
		return out
	}
	for _, o := range []*Operand{&a.Source, a.Target, a.Upper, a.Lower} {
		if o != nil && o.Kind == "plot" {
			add(o.Study)
		}
	}
	return out
}
