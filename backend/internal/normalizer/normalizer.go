package normalizer

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
)

// NormalizeBinanceKlines parses Binance REST /api/v3/klines JSON payload ([][12]any)
// into sorted, validated domain.Candle structs with UTC seconds timestamps.
func NormalizeBinanceKlines(symbol, timeframe string, rawJSON []byte) ([]domain.Candle, error) {
	var rawRows [][]interface{}
	if err := json.Unmarshal(rawJSON, &rawRows); err != nil {
		return nil, fmt.Errorf("failed to unmarshal binance klines: %w", err)
	}

	sym := domain.NormalizeSymbol(symbol)
	tf := domain.NormalizeTimeframe(timeframe)
	out := make([]domain.Candle, 0, len(rawRows))

	for _, row := range rawRows {
		if len(row) < 6 {
			continue
		}
		openTimeMs, ok := toInt64(row[0])
		if !ok || openTimeMs <= 0 {
			continue
		}
		openPrice, ok1 := toFloat64(row[1])
		highPrice, ok2 := toFloat64(row[2])
		lowPrice, ok3 := toFloat64(row[3])
		closePrice, ok4 := toFloat64(row[4])
		vol, ok5 := toFloat64(row[5])
		if !ok1 || !ok2 || !ok3 || !ok4 || !ok5 {
			continue
		}

		c := domain.Candle{
			Symbol:    sym,
			Timeframe: tf,
			Timestamp: openTimeMs / 1000, // ms -> s
			Open:      openPrice,
			High:      highPrice,
			Low:       lowPrice,
			Close:     closePrice,
			Volume:    vol,
		}
		if err := domain.ValidateAndRepairCandle(&c); err == nil {
			out = append(out, c)
		}
	}

	return SortAndDeduplicateCandles(out), nil
}

// BinanceWSKlineEvent models the payload emitted by wss://stream.binance.com:9443/ws/<symbol>@kline_<interval>
type BinanceWSKlineEvent struct {
	EventType string `json:"e"`
	EventTime int64  `json:"E"`
	Symbol    string `json:"s"`
	Kline     struct {
		StartTime int64  `json:"t"`
		CloseTime int64  `json:"T"`
		Symbol    string `json:"s"`
		Interval  string `json:"i"`
		Open      string `json:"o"`
		Close     string `json:"c"`
		High      string `json:"h"`
		Low       string `json:"l"`
		Volume    string `json:"v"`
		IsClosed  bool   `json:"x"`
		// encoding/json matches keys case-insensitively when there is no exact field: without these,
		// "L" (last trade id, a number) lands in Low and fails every message, "V" (taker buy volume)
		// overwrites Volume and "Q" would hit "q". Exact-name fields keep them apart.
		FirstTradeID  int64  `json:"f"`
		LastTradeID   int64  `json:"L"`
		Trades        int64  `json:"n"`
		QuoteVolume   string `json:"q"`
		TakerBaseVol  string `json:"V"`
		TakerQuoteVol string `json:"Q"`
		Ignore        string `json:"B"`
	} `json:"k"`
}

// NormalizeBinanceWSKline parses a live WebSocket kline event from Binance into a domain.Candle.
func NormalizeBinanceWSKline(rawJSON []byte) (domain.Candle, bool, error) {
	var ev BinanceWSKlineEvent
	if err := json.Unmarshal(rawJSON, &ev); err != nil {
		return domain.Candle{}, false, fmt.Errorf("failed to unmarshal binance ws event: %w", err)
	}
	if ev.Kline.StartTime <= 0 {
		return domain.Candle{}, false, fmt.Errorf("empty binance ws kline")
	}

	openVal, _ := strconv.ParseFloat(ev.Kline.Open, 64)
	highVal, _ := strconv.ParseFloat(ev.Kline.High, 64)
	lowVal, _ := strconv.ParseFloat(ev.Kline.Low, 64)
	closeVal, _ := strconv.ParseFloat(ev.Kline.Close, 64)
	volVal, _ := strconv.ParseFloat(ev.Kline.Volume, 64)

	c := domain.Candle{
		Symbol:    domain.NormalizeSymbol(ev.Kline.Symbol),
		Timeframe: domain.NormalizeTimeframe(ev.Kline.Interval),
		Timestamp: ev.Kline.StartTime / 1000,
		Open:      openVal,
		High:      highVal,
		Low:       lowVal,
		Close:     closeVal,
		Volume:    volVal,
	}
	if err := domain.ValidateAndRepairCandle(&c); err != nil {
		return domain.Candle{}, false, err
	}
	return c, ev.Kline.IsClosed, nil
}

// YahooChartResponse models the JSON structure returned by Yahoo Finance /v8/finance/chart/{symbol}
type YahooChartResponse struct {
	Chart struct {
		Result []struct {
			Meta struct {
				Currency           string  `json:"currency"`
				Symbol             string  `json:"symbol"`
				RegularMarketPrice float64 `json:"regularMarketPrice"`
				GmtOffset          int64   `json:"gmtoffset"`
			} `json:"meta"`
			Timestamp  []int64 `json:"timestamp"`
			Indicators struct {
				Quote []struct {
					Open   []*float64 `json:"open"`
					High   []*float64 `json:"high"`
					Low    []*float64 `json:"low"`
					Close  []*float64 `json:"close"`
					Volume []*float64 `json:"volume"`
				} `json:"quote"`
			} `json:"indicators"`
		} `json:"result"`
		Error interface{} `json:"error"`
	} `json:"chart"`
}

// isBISTPostClose: intraday bar stamped at/after 18:00 exchange-local on a BIST symbol.
func isBISTPostClose(sym, tf string, local int64) bool {
	_, unit, ok := domain.ParseTimeframe(tf)
	if !ok || unit == "d" || unit == "w" || unit == "M" || !strings.HasSuffix(sym, ".IS") {
		return false
	}
	return ((local%86400)+86400)%86400 >= 18*3600
}

// onBarGrid reports whether an intraday timestamp sits on its bar grid. Daily/multi-day/weekly/monthly bars
// are exempt (exchange-local midnight/open). Yahoo's 60m bars open at :00 (BIST) or :30 (US), so hour-based
// frames are checked against a 15-minute grid; non-native minute frames (e.g. 3m, 10m, 45m) are fetched from
// a finer Yahoo base interval so we check against that base grid.
func onBarGrid(tf string, ts int64) bool {
	n, unit, ok := domain.ParseTimeframe(tf)
	if !ok || unit == "d" || unit == "w" || unit == "M" || unit == "s" {
		return true
	}
	if unit == "h" {
		return ts%900 == 0
	}
	// unit == "m": align to the Yahoo base interval grid (1m/2m/5m/15m/30m).
	step := int64(60)
	switch {
	case n == 30:
		step = 1800
	case n%15 == 0:
		step = 900
	case n%5 == 0:
		step = 300
	case n%2 == 0:
		step = 120
	}
	return ts%step == 0
}

// NormalizeYahooChart parses Yahoo Finance v8 chart JSON into standard domain.Candle structs.
// If timeframe is "4h", it automatically resamples 1h bars into 4-hour UTC blocks.
func NormalizeYahooChart(symbol, timeframe string, rawJSON []byte) ([]domain.Candle, error) {
	var resp YahooChartResponse
	if err := json.Unmarshal(rawJSON, &resp); err != nil {
		return nil, fmt.Errorf("failed to unmarshal yahoo chart: %w", err)
	}
	if len(resp.Chart.Result) == 0 {
		return nil, fmt.Errorf("empty yahoo chart result for %s", symbol)
	}

	res := resp.Chart.Result[0]
	if len(res.Indicators.Quote) == 0 || len(res.Timestamp) == 0 {
		return []domain.Candle{}, nil
	}

	quote := res.Indicators.Quote[0]
	sym := domain.NormalizeSymbol(symbol)
	tf := domain.NormalizeTimeframe(timeframe)

	n := len(res.Timestamp)
	out := make([]domain.Candle, 0, n)

	for i := 0; i < n; i++ {
		ts := res.Timestamp[i]
		if ts <= 0 {
			continue
		}
		if !onBarGrid(tf, ts) {
			// Yahoo appends a trailing "last trade" point (off-grid timestamp, no volume) to intraday series;
			// stored as a bar it shows up as a flat zero-volume candle (and after the weekend close, as a phantom gap).
			continue
		}
		if i >= len(quote.Open) || i >= len(quote.High) || i >= len(quote.Low) || i >= len(quote.Close) {
			continue
		}
		if quote.Open[i] == nil || quote.High[i] == nil || quote.Low[i] == nil || quote.Close[i] == nil {
			continue
		}

		vol := 0.0
		if i < len(quote.Volume) && quote.Volume[i] != nil {
			vol = *quote.Volume[i]
		}

		if vol == 0 && *quote.Open[i] == *quote.High[i] && *quote.High[i] == *quote.Low[i] && isBISTPostClose(sym, tf, ts+res.Meta.GmtOffset) {
			continue // closing-auction print after 18:00 local: flat, no volume
		}

		c := domain.Candle{
			Symbol:    sym,
			Timeframe: tf,
			Timestamp: ts,
			Open:      *quote.Open[i],
			High:      *quote.High[i],
			Low:       *quote.Low[i],
			Close:     *quote.Close[i],
			Volume:    vol,
		}
		if err := domain.ValidateAndRepairCandle(&c); err == nil {
			out = append(out, c)
		}
	}

	sorted := SortAndDeduplicateCandles(out)
	nVal, unit, _ := domain.ParseTimeframe(tf)
	switch unit {
	case "h":
		if nVal >= 2 {
			blockSec := int64(nVal) * 3600
			// Exchange-session aligned multi-hour blocks (standard broker model): BIST opens 10:00, US 09:30 local.
			switch domain.ResolveSymbolInfo(sym).Market {
			case domain.MarketBIST:
				return ResampleSessionAlignedBlock(sorted, sym, tf, res.Meta.GmtOffset, 10*3600, blockSec), nil
			case domain.MarketUS:
				return ResampleSessionAlignedBlock(sorted, sym, tf, res.Meta.GmtOffset, 9*3600+1800, blockSec), nil
			}
			return ResampleCandles(sorted, sym, tf, blockSec), nil
		}
	case "m":
		// Yahoo native minute intervals need no resampling; custom minutes (3m, 10m, 45m, …) resample cleanly.
		if nVal != 1 && nVal != 2 && nVal != 5 && nVal != 15 && nVal != 30 && nVal != 90 {
			return ResampleCandles(sorted, sym, tf, int64(nVal)*60), nil
		}
	case "d":
		if nVal >= 2 {
			return ResampleDays(sorted, sym, tf, nVal), nil
		}
	case "w":
		if nVal >= 2 {
			return ResampleWeeks(sorted, sym, tf, nVal), nil
		}
	case "M":
		if nVal >= 2 {
			return ResampleMonths(sorted, sym, tf, nVal, res.Meta.GmtOffset), nil
		}
	}
	return sorted, nil
}

// Resample1HTo4H deterministically aggregates 1-hour candles into 4-hour UTC blocks (14400s).
func Resample1HTo4H(candles []domain.Candle, symbol string) []domain.Candle {
	return ResampleCandles(candles, domain.NormalizeSymbol(symbol), "4h", 14400)
}

// ResampleSessionAligned buckets 4h blocks starting at the exchange session open (local seconds-of-day)
// instead of UTC midnight. offsetSec is the exchange's UTC offset (Yahoo meta.gmtoffset).
func ResampleSessionAligned(candles []domain.Candle, symbol, targetTimeframe string, offsetSec, openSec int64) []domain.Candle {
	return ResampleSessionAlignedBlock(candles, symbol, targetTimeframe, offsetSec, openSec, 14400)
}

// ResampleSessionAlignedBlock buckets multi-hour blocks (blockSec = N*3600) starting at the exchange
// session open in local time.
func ResampleSessionAlignedBlock(candles []domain.Candle, symbol, targetTimeframe string, offsetSec, openSec, blockSec int64) []domain.Candle {
	if blockSec <= 0 {
		blockSec = 14400
	}
	return resampleBy(candles, symbol, targetTimeframe, func(ts int64) int64 {
		local := ts + offsetSec
		day := local - ((local%86400)+86400)%86400
		k := floorDiv(local-day-openSec, blockSec)
		return day + openSec + k*blockSec - offsetSec
	})
}

// ResampleDays aggregates daily candles into deterministic N-day UTC blocks.
func ResampleDays(candles []domain.Candle, symbol, targetTimeframe string, days int) []domain.Candle {
	if days <= 1 {
		return candles
	}
	block := int64(days) * 86400
	return resampleBy(candles, symbol, targetTimeframe, func(ts int64) int64 {
		return floorDiv(ts, block) * block
	})
}

// ResampleWeeks aggregates weekly candles into Monday-aligned N-week blocks.
func ResampleWeeks(candles []domain.Candle, symbol, targetTimeframe string, weeks int) []domain.Candle {
	if weeks <= 1 {
		return candles
	}
	const weekSec = int64(604800)
	const monShift = int64(3 * 86400) // 1970-01-01 was Thursday; shift so Monday = 0
	return resampleBy(candles, symbol, targetTimeframe, func(ts int64) int64 {
		wIdx := floorDiv(ts+monShift, weekSec)
		bucketW := floorDiv(wIdx, int64(weeks)) * int64(weeks)
		return bucketW*weekSec - monShift
	})
}

// ResampleMonths aggregates monthly/daily candles into calendar N-month blocks (e.g. 3M -> Jan/Apr/Jul/Oct).
// offsetSec shifts timestamps into exchange-local time before extracting calendar year/month so exchanges
// east of UTC (like BIST UTC+3) do not land on the previous month.
func ResampleMonths(candles []domain.Candle, symbol, targetTimeframe string, months int, offsetSec int64) []domain.Candle {
	if months <= 0 {
		months = 1
	}
	return resampleBy(candles, symbol, targetTimeframe, func(ts int64) int64 {
		return MonthBucketStart(ts, months, offsetSec)
	})
}

// MonthBucketStart returns the UTC unix timestamp of the first day of the N-month calendar bucket containing ts.
func MonthBucketStart(ts int64, months int, offsetSec int64) int64 {
	if months <= 0 {
		months = 1
	}
	t := time.Unix(ts+offsetSec, 0).UTC()
	m0 := int(t.Month()) - 1
	bm := (m0/months)*months + 1
	return time.Date(t.Year(), time.Month(bm), 1, 0, 0, 0, 0, time.UTC).Unix()
}

// BucketStart computes the canonical UTC bucket start timestamp for any timeframe (used by live WS aggregation).
func BucketStart(ts int64, tf string) int64 {
	n, unit, ok := domain.ParseTimeframe(domain.NormalizeTimeframe(tf))
	if !ok {
		return ts
	}
	switch unit {
	case "s":
		b := int64(n)
		return floorDiv(ts, b) * b
	case "m":
		b := int64(n) * 60
		return floorDiv(ts, b) * b
	case "h":
		b := int64(n) * 3600
		return floorDiv(ts, b) * b
	case "d":
		b := int64(n) * 86400
		return floorDiv(ts, b) * b
	case "w":
		const weekSec = int64(604800)
		const monShift = int64(3 * 86400)
		wIdx := floorDiv(ts+monShift, weekSec)
		return floorDiv(wIdx, int64(n))*int64(n)*weekSec - monShift
	case "M":
		return MonthBucketStart(ts, n, 0)
	default:
		return ts
	}
}

// ResampleToTimeframe aggregates candles into any canonical target timeframe (UTC-aligned).
func ResampleToTimeframe(candles []domain.Candle, symbol, targetTimeframe string) []domain.Candle {
	sym := domain.NormalizeSymbol(symbol)
	tf := domain.NormalizeTimeframe(targetTimeframe)
	n, unit, ok := domain.ParseTimeframe(tf)
	if !ok {
		return candles
	}
	switch unit {
	case "s":
		return ResampleCandles(candles, sym, tf, int64(n))
	case "m":
		return ResampleCandles(candles, sym, tf, int64(n)*60)
	case "h":
		return ResampleCandles(candles, sym, tf, int64(n)*3600)
	case "d":
		return ResampleDays(candles, sym, tf, n)
	case "w":
		return ResampleWeeks(candles, sym, tf, n)
	case "M":
		return ResampleMonths(candles, sym, tf, n, 0)
	default:
		return candles
	}
}

func floorDiv(a, b int64) int64 {
	q := a / b
	if a%b != 0 && (a < 0) != (b < 0) {
		q--
	}
	return q
}

// ResampleCandles aggregates finer-grained candles (e.g. 1h) into larger timeframe buckets (e.g. 4h = 14400s).
func ResampleCandles(candles []domain.Candle, symbol, targetTimeframe string, bucketSec int64) []domain.Candle {
	if len(candles) == 0 || bucketSec <= 0 {
		return candles
	}
	return resampleBy(candles, symbol, targetTimeframe, func(ts int64) int64 { return ts - (ts % bucketSec) })
}

func resampleBy(candles []domain.Candle, symbol, targetTimeframe string, bucketOf func(int64) int64) []domain.Candle {
	if len(candles) == 0 {
		return candles
	}
	sorted := SortAndDeduplicateCandles(candles)
	var result []domain.Candle

	for _, c := range sorted {
		bucketTs := bucketOf(c.Timestamp)
		if len(result) == 0 || result[len(result)-1].Timestamp != bucketTs {
			result = append(result, domain.Candle{
				Symbol:    symbol,
				Timeframe: targetTimeframe,
				Timestamp: bucketTs,
				Open:      c.Open,
				High:      c.High,
				Low:       c.Low,
				Close:     c.Close,
				Volume:    c.Volume,
			})
		} else {
			last := &result[len(result)-1]
			if c.High > last.High {
				last.High = c.High
			}
			if c.Low < last.Low {
				last.Low = c.Low
			}
			last.Close = c.Close
			last.Volume += c.Volume
		}
	}
	return result
}

// SortAndDeduplicateCandles orders candles by Timestamp ascending and keeps the latest entry on duplicate timestamps.
func SortAndDeduplicateCandles(candles []domain.Candle) []domain.Candle {
	if len(candles) <= 1 {
		return candles
	}
	sort.SliceStable(candles, func(i, j int) bool {
		return candles[i].Timestamp < candles[j].Timestamp
	})

	dedup := make([]domain.Candle, 0, len(candles))
	for _, c := range candles {
		if len(dedup) > 0 && dedup[len(dedup)-1].Timestamp == c.Timestamp {
			dedup[len(dedup)-1] = c
		} else {
			dedup = append(dedup, c)
		}
	}
	return dedup
}

func toInt64(v interface{}) (int64, bool) {
	switch val := v.(type) {
	case float64:
		return int64(val), true
	case int64:
		return val, true
	case int:
		return int64(val), true
	case string:
		parsed, err := strconv.ParseInt(val, 10, 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}

func toFloat64(v interface{}) (float64, bool) {
	switch val := v.(type) {
	case float64:
		return val, true
	case string:
		parsed, err := strconv.ParseFloat(val, 64)
		return parsed, err == nil
	case int64:
		return float64(val), true
	default:
		return 0, false
	}
}
