package domain

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// ProviderType identifies the upstream data source.
type ProviderType string

const (
	ProviderBinance ProviderType = "BINANCE"
	ProviderYahoo   ProviderType = "YAHOO"
)

// MarketType groups instruments in the UI watchlist and symbol search.
type MarketType string

const (
	MarketCrypto MarketType = "CRYPTO"
	MarketBIST   MarketType = "BIST"
	MarketUS     MarketType = "US"
	MarketForex  MarketType = "FOREX"
)

// Candle is the normalized, immutable standard candlestick structure stored in SQLite
// and sent to Lightweight Charts.
type Candle struct {
	Symbol    string  `json:"symbol,omitempty"`
	Timeframe string  `json:"timeframe,omitempty"`
	Timestamp int64   `json:"time"` // UTC Unix epoch in seconds
	Open      float64 `json:"open"`
	High      float64 `json:"high"`
	Low       float64 `json:"low"`
	Close     float64 `json:"close"`
	Volume    float64 `json:"volume"`
}

// SymbolInfo describes a tradable instrument across Binance, BIST (.IS), US and Forex/Commodity markets.
type SymbolInfo struct {
	Symbol       string       `json:"symbol"`
	DisplayName  string       `json:"displayName"`
	Market       MarketType   `json:"market"`
	Exchange     string       `json:"exchange"`
	Currency     string       `json:"currency"`
	Provider     ProviderType `json:"provider"`
	DelayMinutes int          `json:"delayMinutes"`
}

// GapRange represents a missing [From, To] time interval (in UTC seconds) that needs to be fetched from the upstream API.
type GapRange struct {
	From int64
	To   int64
}

// LiveCandleMessage is broadcast over /ws/live when a price update or candle close occurs.
type LiveCandleMessage struct {
	Type         string       `json:"type"` // "candle_update"
	Symbol       string       `json:"symbol"`
	Interval     string       `json:"interval"`
	Provider     ProviderType `json:"provider"`
	DelayMinutes int          `json:"delayMinutes"`
	IsClosed     bool         `json:"isClosed"`
	Candle       Candle       `json:"candle"`
}

// NormalizeSymbol standardizes symbol casing and whitespace.
func NormalizeSymbol(sym string) string {
	return strings.ToUpper(strings.TrimSpace(sym))
}

// ParseTimeframe parses a standard or custom interval string into (count, canonicalUnit).
// Canonical units: "s" (1..59), "m" (1..1439), "h" (1..23), "d" (1..365), "w" (1..52), "M" (1..12).
// Case-sensitive for uppercase "M" (months) vs lowercase "m" (minutes).
func ParseTimeframe(tf string) (int, string, bool) {
	raw := strings.TrimSpace(tf)
	if raw == "" {
		return 0, "", false
	}
	// Case-sensitive single-letter or numeric+"M" month forms BEFORE lowercasing.
	if raw == "M" {
		return 1, "M", true
	}
	if strings.HasSuffix(raw, "M") && len(raw) >= 2 {
		if n, err := strconv.Atoi(raw[:len(raw)-1]); err == nil && n >= 1 && n <= 12 {
			return n, "M", true
		}
		// Never let out-of-range months like "13M" fall through to lowercase minutes.
		return 0, "", false
	}
	if raw == "D" {
		return 1, "d", true
	}
	if raw == "W" {
		return 1, "w", true
	}

	low := strings.ToLower(raw)
	switch low {
	case "daily", "d":
		return 1, "d", true
	case "weekly", "w":
		return 1, "w", true
	case "monthly":
		return 1, "M", true
	}

	// Split leading digits and trailing unit.
	i := 0
	for i < len(low) && low[i] >= '0' && low[i] <= '9' {
		i++
	}
	if i == 0 || i == len(low) {
		return 0, "", false
	}
	n, err := strconv.Atoi(low[:i])
	if err != nil || n <= 0 {
		return 0, "", false
	}
	u := low[i:]
	switch u {
	case "s", "sec":
		if n == 60 {
			return 1, "m", true
		}
		if n <= 59 {
			return n, "s", true
		}
	case "m", "min":
		if n == 1440 {
			return 1, "d", true
		}
		if n >= 60 && n%60 == 0 && n/60 <= 23 {
			return n / 60, "h", true
		}
		if n <= 1439 {
			return n, "m", true
		}
	case "h", "hr":
		if n == 24 {
			return 1, "d", true
		}
		if n <= 23 {
			return n, "h", true
		}
	case "d", "day":
		if n <= 365 {
			return n, "d", true
		}
	case "w", "wk", "week":
		if n <= 52 {
			return n, "w", true
		}
	case "mo":
		if n <= 12 {
			return n, "M", true
		}
	case "y", "yr":
		if n == 1 {
			return 12, "M", true
		}
	}
	return 0, "", false
}

// IsValidTimeframe reports whether tf parses as a supported standard or custom timeframe.
func IsValidTimeframe(tf string) bool {
	_, _, ok := ParseTimeframe(tf)
	return ok
}

// NormalizeTimeframe converts user-supplied intervals to canonical TitanView timeframes.
func NormalizeTimeframe(tf string) string {
	n, u, ok := ParseTimeframe(tf)
	if !ok {
		return "15m"
	}
	return fmt.Sprintf("%d%s", n, u)
}

// TimeframeSeconds returns the approximate duration of one candle in seconds.
func TimeframeSeconds(tf string) int64 {
	n, u, ok := ParseTimeframe(NormalizeTimeframe(tf))
	if !ok {
		return 900
	}
	switch u {
	case "s":
		return int64(n)
	case "m":
		return int64(n) * 60
	case "h":
		return int64(n) * 3600
	case "d":
		return int64(n) * 86400
	case "w":
		return int64(n) * 604800
	case "M":
		return int64(n) * 30 * 86400
	default:
		return 900
	}
}

// DefaultHistoryLookbackSeconds returns a sensible initial history window when 'from' is omitted.
func DefaultHistoryLookbackSeconds(tf string) int64 {
	// Yahoo intraday is capped upstream (<=60d for 5m-30m, 730d for 1h); crypto (Binance) goes much deeper
	// but a single request is bounded by the page cap (see CacheCoordinator.GetHistory), so these are the
	// deepest windows both sources can serve. Older bars load on scroll.
	n, u, ok := ParseTimeframe(NormalizeTimeframe(tf))
	if !ok {
		return 86400 * 30
	}
	switch u {
	case "s":
		// 1s..59s: keep within Binance 1s multi-page span (<= 9000s) while returning >= 150 bars.
		w := int64(n) * 300
		if w < 900 {
			w = 900
		}
		if w > 9000 {
			w = 9000
		}
		return w
	case "m":
		switch {
		case n == 1:
			return 86400 * 6
		case n <= 3:
			return 86400 * 14
		case n <= 5:
			return 86400 * 30
		default:
			return 86400 * 55
		}
	case "h":
		return 86400 * 700
	case "d":
		if n == 1 {
			return 86400 * 365 * 10
		}
		years := int64(n) * 10
		if years > 30 {
			years = 30
		}
		return 86400 * 365 * years
	case "w":
		years := int64(n) * 20
		if years > 40 {
			years = 40
		}
		return 86400 * 365 * years
	case "M":
		if n <= 3 {
			return 86400 * 365 * 30
		}
		return 86400 * 365 * 40
	default:
		return 86400 * 30
	}
}

// ValidateAndRepairCandle ensures a candle has valid finite positive OHLC values and consistent High/Low bounds.
func ValidateAndRepairCandle(c *Candle) error {
	if c == nil {
		return fmt.Errorf("nil candle")
	}
	if c.Timestamp <= 0 {
		return fmt.Errorf("invalid timestamp: %d", c.Timestamp)
	}
	if math.IsNaN(c.Open) || math.IsNaN(c.High) || math.IsNaN(c.Low) || math.IsNaN(c.Close) || math.IsNaN(c.Volume) {
		return fmt.Errorf("NaN value in candle")
	}
	if math.IsInf(c.Open, 0) || math.IsInf(c.High, 0) || math.IsInf(c.Low, 0) || math.IsInf(c.Close, 0) {
		return fmt.Errorf("Inf value in candle")
	}
	if c.Open <= 0 || c.High <= 0 || c.Low <= 0 || c.Close <= 0 {
		return fmt.Errorf("non-positive price in candle")
	}
	maxOC := math.Max(c.Open, c.Close)
	minOC := math.Min(c.Open, c.Close)
	if c.High < maxOC {
		c.High = maxOC
	}
	if c.Low > minOC {
		c.Low = minOC
	}
	if c.Volume < 0 || math.IsInf(c.Volume, 0) {
		c.Volume = 0
	}
	return nil
}
