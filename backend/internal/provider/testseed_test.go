package provider

import (
	"hash/fnv"
	"math"

	"github.com/ersincebi/titanview/backend/internal/domain"
)

// GenerateDeterministicSeedCandles is a TEST-ONLY deterministic candle generator.
func GenerateDeterministicSeedCandles(symbol, timeframe string, fromSec, toSec int64) []domain.Candle {
	info := domain.ResolveSymbolInfo(symbol)
	tf := domain.NormalizeTimeframe(timeframe)
	step := domain.TimeframeSeconds(tf)
	if step <= 0 {
		step = 900
	}
	if toSec <= fromSec {
		toSec = fromSec + step*300
	}

	// Align start timestamp to timeframe grid
	startTs := (fromSec / step) * step
	endTs := (toSec / step) * step
	maxBars := int64(500)
	if (endTs-startTs)/step > maxBars {
		startTs = endTs - maxBars*step
	}

	h := fnv.New32a()
	_, _ = h.Write([]byte(info.Symbol))
	seed := float64(h.Sum32()%10000) + 1.0

	price := 100.0

	// Scale volatility by timeframe
	volScale := 0.0045
	switch tf {
	case "1m":
		volScale = 0.0015
	case "5m":
		volScale = 0.0025
	case "15m":
		volScale = 0.004
	case "1h":
		volScale = 0.007
	case "4h":
		volScale = 0.012
	case "1d":
		volScale = 0.018
	case "1w":
		volScale = 0.032
	}

	candles := make([]domain.Candle, 0, (endTs-startTs)/step+1)
	idx := 0
	for ts := startTs; ts <= endTs; ts += step {
		t := float64(idx)
		// Multi-harmonic wave + cyclical regime so moving averages, RSI, MACD & SuperTrend trigger realistic signals
		wave1 := math.Sin(t*0.11 + seed*0.01)
		wave2 := math.Cos(t*0.037 + seed*0.02)
		wave3 := math.Sin(t*0.29 + seed*0.05)
		pctMove := (wave1*0.45 + wave2*0.35 + wave3*0.20) * volScale

		open := roundPrice(price)
		closeVal := roundPrice(math.Max(price*0.1, open*(1.0+pctMove)))

		wickUp := math.Abs(math.Sin(t*0.53+seed)) * volScale * 0.85
		wickDown := math.Abs(math.Cos(t*0.41+seed)) * volScale * 0.85

		high := roundPrice(math.Max(open, closeVal) * (1.0 + wickUp))
		low := roundPrice(math.Min(open, closeVal) * (1.0 - wickDown))

		baseVol := 125000.0
		if info.Market == domain.MarketCrypto {
			baseVol = 850.0
		}
		volMultiplier := 1.0 + 1.8*math.Abs(pctMove/volScale)
		volume := math.Round(baseVol * volMultiplier)

		candles = append(candles, domain.Candle{
			Symbol:    info.Symbol,
			Timeframe: tf,
			Timestamp: ts,
			Open:      open,
			High:      high,
			Low:       low,
			Close:     closeVal,
			Volume:    volume,
		})

		price = closeVal
		idx++
	}

	return candles
}

func roundPrice(val float64) float64 {
	if val < 2.0 {
		return math.Round(val*10000) / 10000
	}
	if val < 50.0 {
		return math.Round(val*100) / 100
	}
	return math.Round(val*100) / 100
}
