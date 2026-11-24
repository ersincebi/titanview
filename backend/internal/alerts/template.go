package alerts

import (
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
	"github.com/ersincebi/titanview/backend/internal/scriptjs"
)

// TemplateCtx is everything a message placeholder can read.
type TemplateCtx struct {
	Symbol   string
	Interval string
	Candle   domain.Candle
	Now      time.Time
	// script output of the alert's study (plot_N / plot("title")) and the bar index to read.
	Script   *scriptjs.Output
	BarIndex int
	Fill     *scriptjs.Fill
}

var placeholderRe = regexp.MustCompile(`\{\{\s*([^{}]+?)\s*\}\}`)
var plotCallRe = regexp.MustCompile(`^plot\(\s*["'](.+)["']\s*\)$`)

// FormatNumber prints prices without float noise (up to 8 decimals, trailing zeros trimmed).
func FormatNumber(v float64) string {
	s := strconv.FormatFloat(v, 'f', 8, 64)
	if strings.Contains(s, ".") {
		s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	}
	return s
}

// exchangeOf maps exchange prefixes for TitanView's three markets.
func exchangeOf(sym string) string {
	info := domain.ResolveSymbolInfo(sym)
	switch {
	case info.Provider == domain.ProviderBinance:
		return "BINANCE"
	case strings.HasSuffix(sym, ".IS"):
		return "BIST"
	default:
		return string(info.Market)
	}
}

// tickerOf strips the Yahoo ".IS" suffix (shows BIST:THYAO).
func tickerOf(sym string) string { return strings.TrimSuffix(sym, ".IS") }

// Render substitutes alert template placeholders; unknown placeholders are kept verbatim.
func Render(msg string, c TemplateCtx) string {
	return placeholderRe.ReplaceAllStringFunc(msg, func(m string) string {
		key := strings.TrimSpace(m[2 : len(m)-2])
		if v, ok := resolvePlaceholder(key, c); ok {
			return v
		}
		return m
	})
}

func resolvePlaceholder(key string, c TemplateCtx) (string, bool) {
	switch strings.ToLower(key) {
	case "ticker":
		return tickerOf(c.Symbol), true
	case "exchange":
		return exchangeOf(c.Symbol), true
	case "symbol":
		return c.Symbol, true
	case "interval":
		return c.Interval, true
	case "open":
		return FormatNumber(c.Candle.Open), true
	case "high":
		return FormatNumber(c.Candle.High), true
	case "low":
		return FormatNumber(c.Candle.Low), true
	case "close":
		return FormatNumber(c.Candle.Close), true
	case "volume":
		return FormatNumber(c.Candle.Volume), true
	case "time":
		return time.Unix(c.Candle.Timestamp, 0).UTC().Format("2006-01-02T15:04:05Z"), true
	case "timenow":
		return c.Now.UTC().Format("2006-01-02T15:04:05Z"), true
	}
	if c.Fill != nil {
		switch key {
		case "strategy.order.action":
			return c.Fill.Action, true
		case "strategy.order.contracts":
			return FormatNumber(c.Fill.Qty), true
		case "strategy.order.price":
			return FormatNumber(c.Fill.Price), true
		case "strategy.order.id":
			return c.Fill.ID, true
		case "strategy.order.comment":
			return c.Fill.Comment, true
		case "strategy.position_size":
			return FormatNumber(c.Fill.PositionSize), true
		case "strategy.market_position":
			switch {
			case c.Fill.PositionSize > 0:
				return "long", true
			case c.Fill.PositionSize < 0:
				return "short", true
			}
			return "flat", true
		}
	}
	if c.Script != nil {
		ref := ""
		if strings.HasPrefix(key, "plot_") {
			ref = key
		} else if m := plotCallRe.FindStringSubmatch(key); m != nil {
			ref = m[1]
		}
		if ref != "" {
			if v, ok := c.Script.PlotValue(ref, c.BarIndex); ok {
				return FormatNumber(v), true
			}
			return "NaN", true
		}
	}
	return "", false
}
