package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/ersincebi/titanview/backend/internal/analytics"
	"github.com/ersincebi/titanview/backend/internal/domain"
	"github.com/ersincebi/titanview/backend/internal/scriptjs"
	"github.com/ersincebi/titanview/backend/internal/provider"
	"github.com/ersincebi/titanview/backend/internal/storage"
)

func (s *Server) getScriptPool() *scriptjs.Pool {
	s.scriptMu.Lock()
	defer s.scriptMu.Unlock()
	if s.scriptPool == nil {
		s.scriptPool = scriptjs.NewPool(4)
	}
	return s.scriptPool
}

// GET | POST | PUT | DELETE /api/watchlists
func (s *Server) handleWatchlists(w http.ResponseWriter, r *http.Request) {
	if s.Coord == nil || s.Coord.Store == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "storage unavailable")
		return
	}
	switch r.Method {
	case http.MethodGet:
		lists, err := s.Coord.Store.ListWatchlists(r.Context())
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		flags, err := s.Coord.Store.ListSymbolFlags(r.Context())
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"watchlists": lists,
			"flags":      flags,
		})

	case http.MethodPost, http.MethodPut:
		var wl storage.SavedWatchlist
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<18)).Decode(&wl); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid json")
			return
		}
		saved, err := s.Coord.Store.SaveWatchlist(r.Context(), wl)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, saved)

	case http.MethodDelete:
		id := strings.TrimSpace(r.URL.Query().Get("id"))
		if id == "" {
			writeJSONError(w, http.StatusBadRequest, "id query parameter required")
			return
		}
		err := s.Coord.Store.DeleteWatchlist(r.Context(), id)
		if errors.Is(err, storage.ErrLastWatchlist) {
			writeJSONError(w, http.StatusConflict, err.Error())
			return
		}
		if errors.Is(err, storage.ErrWatchlistNotFound) {
			writeJSONError(w, http.StatusNotFound, err.Error())
			return
		}
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})

	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// PUT | POST /api/watchlists/flag — sets or clears a symbol's 7-color flag.
func (s *Server) handleWatchlistFlag(w http.ResponseWriter, r *http.Request) {
	if s.Coord == nil || s.Coord.Store == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "storage unavailable")
		return
	}
	if r.Method != http.MethodPut && r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var body struct {
		Symbol string `json:"symbol"`
		Color  string `json:"color"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid json")
		return
	}
	err := s.Coord.Store.SetSymbolFlag(r.Context(), body.Symbol, body.Color)
	if errors.Is(err, storage.ErrInvalidFlagColor) {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	flags, _ := s.Coord.Store.ListSymbolFlags(r.Context())
	sym := domain.ResolveSymbolInfo(body.Symbol).Symbol
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"symbol": sym,
		"color":  flags[sym],
		"flags":  flags,
	})
}

// GET | POST | PUT | DELETE /api/notes
func (s *Server) handleNotes(w http.ResponseWriter, r *http.Request) {
	if s.Coord == nil || s.Coord.Store == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "storage unavailable")
		return
	}
	switch r.Method {
	case http.MethodGet:
		sym := strings.TrimSpace(r.URL.Query().Get("symbol"))
		notes, err := s.Coord.Store.ListNotes(r.Context(), sym)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"notes": notes})

	case http.MethodPost, http.MethodPut:
		var note storage.SymbolNote
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<17)).Decode(&note); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid json")
			return
		}
		if note.SnapshotPrice <= 0 && note.Symbol != "" {
			info := domain.ResolveSymbolInfo(note.Symbol)
			if sum := s.quoteSummary(r.Context(), info); sum.LastPrice != nil {
				note.SnapshotPrice = *sum.LastPrice
			}
		}
		saved, err := s.Coord.Store.SaveNote(r.Context(), note)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, saved)

	case http.MethodDelete:
		id := strings.TrimSpace(r.URL.Query().Get("id"))
		if id == "" {
			writeJSONError(w, http.StatusBadRequest, "id query parameter required")
			return
		}
		err := s.Coord.Store.DeleteNote(r.Context(), id)
		if errors.Is(err, storage.ErrNoteNotFound) {
			writeJSONError(w, http.StatusNotFound, err.Error())
			return
		}
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})

	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// GET | POST | PUT | DELETE /api/screener/presets
func (s *Server) handleScreenerPresets(w http.ResponseWriter, r *http.Request) {
	if s.Coord == nil || s.Coord.Store == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "storage unavailable")
		return
	}
	switch r.Method {
	case http.MethodGet:
		list, err := s.Coord.Store.ListScreenerPresets(r.Context())
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"presets": list})

	case http.MethodPost, http.MethodPut:
		var p storage.SavedScreenerPreset
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<17)).Decode(&p); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid json")
			return
		}
		saved, err := s.Coord.Store.SaveScreenerPreset(r.Context(), p)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, saved)

	case http.MethodDelete:
		id := strings.TrimSpace(r.URL.Query().Get("id"))
		if id == "" {
			writeJSONError(w, http.StatusBadRequest, "id query parameter required")
			return
		}
		err := s.Coord.Store.DeleteScreenerPreset(r.Context(), id)
		if errors.Is(err, storage.ErrPresetNotFound) {
			writeJSONError(w, http.StatusNotFound, err.Error())
			return
		}
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})

	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func isETFSymbol(info domain.SymbolInfo) bool {
	if strings.Contains(strings.ToUpper(info.DisplayName), "ETF") {
		return true
	}
	switch info.Symbol {
	case "SPY", "QQQ", "IWM", "DIA", "GLD", "SLV", "TLT", "VTI", "VOO", "SMH", "ARKK":
		return true
	}
	return false
}

// handleAdvancedScreener implements GET /api/screener with 130+ technical & fundamental metrics.
func (s *Server) handleAdvancedScreener(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	q := r.URL.Query()
	marketFilter := strings.ToUpper(strings.TrimSpace(q.Get("market")))
	tf := strings.TrimSpace(q.Get("timeframe"))
	if tf == "" {
		tf = "15m"
	}
	wantFund := q.Get("fundamentals") == "1" || q.Get("includeFundamentals") == "1"
	wantWarm := q.Get("warm") == "1"

	var candidates []domain.SymbolInfo
	for _, item := range domain.DefaultSymbolCatalog {
		if marketFilter == "ETF" {
			if !isETFSymbol(item) {
				continue
			}
		} else if marketFilter != "" && marketFilter != "ALL" && string(item.Market) != marketFilter {
			continue
		}
		candidates = append(candidates, item)
	}

	if s.Coord == nil || s.Coord.Store == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"rows": []ScreenerRow{}})
		return
	}

	rows := make([]ScreenerRow, 0, len(candidates))
	for _, info := range candidates {
		candles, _ := s.Coord.Store.GetLatestCandles(r.Context(), info.Symbol, tf, 260)
		if len(candles) < 30 && tf != "15m" {
			candles, _ = s.Coord.Store.GetLatestCandles(r.Context(), info.Symbol, "15m", 260)
		}
		if len(candles) < 30 && tf != "1d" {
			if d, _ := s.Coord.Store.GetLatestCandles(r.Context(), info.Symbol, "1d", 260); len(d) >= 30 {
				candles = d
			}
		}
		if len(candles) < 30 && wantWarm {
			cctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
			now := time.Now().Unix()
			span := int64(7 * 86400)
			if tf == "1d" {
				span = 365 * 86400
			} else if tf == "4h" {
				span = 90 * 86400
			} else if tf == "1h" {
				span = 25 * 86400
			}
			if res, err := s.Coord.GetHistory(cctx, info.Symbol, tf, now-span, now); err == nil && res != nil && len(res.Candles) >= 30 {
				candles = res.Candles
			}
			cancel()
		}
		if len(candles) < 30 {
			continue
		}

		row := evaluateScreenerRow(info, candles)

		// Enrich multi-horizon performance & 52w stats from cached daily candles when available.
		if daily, _ := s.Coord.Store.GetLatestCandles(r.Context(), info.Symbol, "1d", 300); len(daily) >= 10 {
			applyDailyPerformance(&row, daily)
		}

		// Enrich live quote / extended hours if cached.
		if s.quotes != nil {
			if v, ok := s.quotes.get("q|" + info.Symbol); ok {
				lq := v.(provider.Quote)
				if lq.ExtPrice != nil {
					row.ExtPrice = lq.ExtPrice
				}
				if lq.ExtChangePct != nil {
					row.ExtChangePct = lq.ExtChangePct
				}
			}
		}

		// Enrich real fundamentals from cache (or fetch if requested for equities).
		if info.Market == domain.MarketBIST || info.Market == domain.MarketUS {
			var rep *provider.FundamentalsReport
			if s.cache != nil {
				if v, ok := s.cache.get("fundamentals|" + info.Symbol); ok {
					rCopy := v.(provider.FundamentalsReport)
					rep = &rCopy
				}
			}
			if rep == nil && wantFund && info.Symbol != "XU100.IS" {
				if ff, ok := s.Coord.Yahoo.(provider.FundamentalsFetcher); ok {
					fctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
					if fetched, err := ff.FetchFundamentals(fctx, info.Symbol); err == nil && fetched.Supported {
						if s.cache != nil {
							s.cache.set("fundamentals|"+info.Symbol, fetched)
						}
						rep = &fetched
					}
					cancel()
				}
			}
			if rep != nil && rep.Supported {
				applyFundamentalsToScreenerRow(&row, *rep)
			}
		}

		rows = append(rows, row)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"rows":      rows,
		"timeframe": tf,
	})
}

func rnd2(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return math.Round(v*100) / 100
}

func rnd3(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return math.Round(v*1000) / 1000
}

// enrichScreenerRow populates all 130+ technical indicators on ScreenerRow from the candle window.
func enrichScreenerRow(row ScreenerRow, candles []domain.Candle) ScreenerRow {
	n := len(candles)
	if n == 0 {
		return row
	}
	row.IsETF = isETFSymbol(row.SymbolInfo)

	closes := make([]float64, n)
	highs := make([]float64, n)
	lows := make([]float64, n)
	vols := make([]float64, n)
	for i, c := range candles {
		closes[i] = c.Close
		highs[i] = c.High
		lows[i] = c.Low
		vols[i] = c.Volume
	}

	last := candles[n-1]
	prev := candles[0]
	if n >= 2 {
		prev = candles[n-2]
	}

	row.LastPrice = rnd2(last.Close)
	row.OpenPrice = rnd2(last.Open)
	row.HighPrice = rnd2(last.High)
	row.LowPrice = rnd2(last.Low)
	row.PrevClose = rnd2(prev.Close)
	row.ChangeAbs = rnd2(last.Close - candles[0].Open)
	if prev.Close > 0 {
		row.GapPct = rnd2(((last.Open - prev.Close) / prev.Close) * 100)
	}
	row.Volume = math.Round(last.Volume)
	row.AvgVolume10 = math.Round(calcSimpleSMA(vols, 10))
	row.AvgVolume20 = math.Round(calcSimpleSMA(vols, 20))
	row.AvgVolume30 = math.Round(calcSimpleSMA(vols, 30))
	row.AvgVolume60 = math.Round(calcSimpleSMA(vols, 60))
	row.AvgVolume90 = math.Round(calcSimpleSMA(vols, 90))
	if row.AvgVolume20 > 0 {
		row.RelVolume = rnd2(last.Volume / row.AvgVolume20)
	} else {
		row.RelVolume = 1.0
	}
	row.Turnover = math.Round(last.Close * last.Volume)

	// Default performance & 52W range from available candles (overridden by daily candles when available)
	applyDailyPerformance(&row, candles)
	if last.High > last.Low {
		row.PosInDayRange = rnd2(((last.Close - last.Low) / (last.High - last.Low)) * 100)
	} else {
		row.PosInDayRange = 50
	}

	// Moving Averages (22)
	row.SMA5 = rnd2(calcSimpleSMA(closes, 5))
	row.SMA10 = rnd2(calcSimpleSMA(closes, 10))
	row.SMA20 = rnd2(calcSimpleSMA(closes, 20))
	row.SMA30 = rnd2(calcSimpleSMA(closes, 30))
	row.SMA50 = rnd2(calcSimpleSMA(closes, 50))
	row.SMA100 = rnd2(calcSimpleSMA(closes, 100))
	row.SMA200 = rnd2(calcSimpleSMA(closes, 200))
	row.EMA5 = rnd2(calcSimpleEMA(closes, 5))
	row.EMA10 = rnd2(calcSimpleEMA(closes, 10))
	row.EMA12 = rnd2(calcSimpleEMA(closes, 12))
	row.EMA20 = rnd2(calcSimpleEMA(closes, 20))
	row.EMA26 = rnd2(calcSimpleEMA(closes, 26))
	row.EMA30 = rnd2(calcSimpleEMA(closes, 30))
	row.EMA50 = rnd2(calcSimpleEMA(closes, 50))
	row.EMA100 = rnd2(calcSimpleEMA(closes, 100))
	row.EMA200 = rnd2(calcSimpleEMA(closes, 200))
	row.WMA20 = rnd2(calcWMA(closes, 20))
	row.VWMA20 = rnd2(calcVWMA(candles, 20))
	row.HMA9 = rnd2(calcHMA(closes, 9))
	if row.SMA20 > 0 {
		row.DistSMA20Pct = rnd2(((last.Close - row.SMA20) / row.SMA20) * 100)
	}
	if row.SMA50 > 0 {
		row.DistSMA50Pct = rnd2(((last.Close - row.SMA50) / row.SMA50) * 100)
	}
	if row.SMA200 > 0 {
		row.DistSMA200Pct = rnd2(((last.Close - row.SMA200) / row.SMA200) * 100)
	}

	// Oscillators (22)
	row.RSI7 = rnd2(calcSimpleRSI(closes, 7))
	row.RSI14 = math.Round(calcSimpleRSI(closes, 14)*10) / 10
	row.RSI21 = rnd2(calcSimpleRSI(closes, 21))
	sk, sd := calcStoch(candles, 14, 3)
	row.StochK = rnd2(sk)
	row.StochD = rnd2(sd)
	if srk, srd, ok := analytics.StochRSILast(closes); ok {
		row.StochRSIK = rnd2(srk)
		row.StochRSID = rnd2(srd)
	} else {
		row.StochRSIK = row.StochK
		row.StochRSID = row.StochD
	}
	if m, sig, hist, ok := analytics.MACDLast(closes); ok {
		row.MACD = rnd3(m)
		row.MACDSignal = rnd3(sig)
		row.MACDHist = rnd3(hist)
	} else {
		m := row.EMA12 - row.EMA26
		row.MACD = rnd3(m)
		row.MACDSignal = rnd3(m * 0.9)
		row.MACDHist = rnd3(m * 0.1)
	}
	row.CCI20 = rnd2(calcCCI(candles, 20))
	row.WilliamsR14 = rnd2(calcWilliamsR(candles, 14))
	row.MFI14 = rnd2(calcMFI(candles, 14))
	row.ROC9 = rnd2(calcROC(closes, 9))
	row.ROC20 = rnd2(calcROC(closes, 20))
	if n > 10 {
		row.Momentum10 = rnd2(last.Close - closes[n-11])
	}
	row.AO = rnd3(calcAO(candles))
	row.UO = rnd2(calcUltimateOsc(candles))
	row.CMO14 = rnd2(calcCMO(closes, 14))
	ema13 := calcSimpleEMA(closes, 13)
	row.BullPower13 = rnd3(last.High - ema13)
	row.BearPower13 = rnd3(last.Low - ema13)
	std20 := calcStdDev(closes, 20)
	if std20 > 0 {
		row.ZScore20 = rnd2((last.Close - row.SMA20) / std20)
	}

	// Trend, Volatility & Flow (31)
	if adx, pdi, mdi, ok := analytics.ADXLast(candles, 14); ok {
		row.ADX14 = rnd2(adx)
		row.PlusDI14 = rnd2(pdi)
		row.MinusDI14 = rnd2(mdi)
	} else {
		row.ADX14 = 20
		row.PlusDI14 = 20
		row.MinusDI14 = 20
	}
	if stLine, stDir, ok := analytics.SupertrendLast(candles, 10, 3.0); ok {
		row.Supertrend = rnd2(stLine)
		row.SupertrendDir = stDir
	} else {
		row.Supertrend = row.EMA20
		if last.Close >= row.EMA20 {
			row.SupertrendDir = 1
		} else {
			row.SupertrendDir = -1
		}
	}
	row.PSAR = rnd2(calcApproxPSAR(candles))
	aUp, aDn := calcAroon(candles, 14)
	row.AroonUp14 = rnd2(aUp)
	row.AroonDown14 = rnd2(aDn)
	row.AroonOsc14 = rnd2(aUp - aDn)
	if ich, ok := analytics.IchimokuLast(candles); ok {
		row.IchimokuTenkan = rnd2(ich.Tenkan)
		row.IchimokuKijun = rnd2(ich.Kijun)
		row.IchimokuSpanA = rnd2(ich.SpanA)
		row.IchimokuSpanB = rnd2(ich.SpanB)
	} else {
		hi9, lo9 := calcRangeHighLow(candles, 9)
		hi26, lo26 := calcRangeHighLow(candles, 26)
		row.IchimokuTenkan = rnd2((hi9 + lo9) / 2)
		row.IchimokuKijun = rnd2((hi26 + lo26) / 2)
		row.IchimokuSpanA = rnd2((row.IchimokuTenkan + row.IchimokuKijun) / 2)
		row.IchimokuSpanB = row.SMA50
	}
	atr14 := calcATR(candles, 14)
	row.ATR14 = rnd3(atr14)
	if last.Close > 0 {
		row.ATR14Pct = rnd2((atr14 / last.Close) * 100)
		row.NATR14 = row.ATR14Pct
	}
	row.BBMiddle20 = row.SMA20
	row.BBUpper20 = rnd2(row.SMA20 + 2*std20)
	row.BBLower20 = rnd2(row.SMA20 - 2*std20)
	if row.SMA20 > 0 {
		row.BBWidthPct = rnd2(((row.BBUpper20 - row.BBLower20) / row.SMA20) * 100)
	}
	if row.BBUpper20 > row.BBLower20 {
		row.BBPercentB = rnd2((last.Close - row.BBLower20) / (row.BBUpper20 - row.BBLower20))
	} else {
		row.BBPercentB = 0.5
	}
	row.KCUpper20 = rnd2(row.EMA20 + 1.5*atr14)
	row.KCLower20 = rnd2(row.EMA20 - 1.5*atr14)
	dHi, dLo := calcRangeHighLow(candles, 20)
	row.DonchianHigh20 = rnd2(dHi)
	row.DonchianLow20 = rnd2(dLo)
	if cmf, ok := analytics.CMFLast(candles, 20); ok {
		row.CMF20 = rnd3(cmf)
	}
	row.OBVSlopePct = rnd2(calcOBVSlopePct(candles, 14))
	row.VWAP = row.VWMA20

	// Sub-ratings (Moving Averages vs Oscillators)
	maScore := 0
	for _, ma := range []float64{row.SMA10, row.SMA20, row.SMA50, row.SMA100, row.SMA200, row.EMA10, row.EMA20, row.EMA50, row.EMA100, row.EMA200, row.VWMA20, row.HMA9} {
		if ma <= 0 {
			continue
		}
		if last.Close > ma {
			maScore++
		} else if last.Close < ma {
			maScore--
		}
	}
	row.MAScore = maScore
	row.MARating = scoreToRating(maScore, 6, 2)

	oscScore := 0
	if row.RSI14 < 30 {
		oscScore += 2
	} else if row.RSI14 < 45 {
		oscScore++
	} else if row.RSI14 > 70 {
		oscScore -= 2
	} else if row.RSI14 > 58 {
		oscScore--
	}
	if row.StochK < 20 {
		oscScore++
	} else if row.StochK > 80 {
		oscScore--
	}
	if row.CCI20 < -100 {
		oscScore++
	} else if row.CCI20 > 100 {
		oscScore--
	}
	if row.MACDHist > 0 {
		oscScore++
	} else if row.MACDHist < 0 {
		oscScore--
	}
	if row.AO > 0 {
		oscScore++
	} else if row.AO < 0 {
		oscScore--
	}
	if row.WilliamsR14 < -80 {
		oscScore++
	} else if row.WilliamsR14 > -20 {
		oscScore--
	}
	row.OscScore = oscScore
	row.OscRating = scoreToRating(oscScore, 3, 1)

	row.CandlePattern = detectCandlePattern(candles)
	row.Streak = calcStreak(closes)

	return row
}

func scoreToRating(score, strongThresh, buyThresh int) string {
	switch {
	case score >= strongThresh:
		return "STRONG_BUY"
	case score >= buyThresh:
		return "BUY"
	case score <= -strongThresh:
		return "STRONG_SELL"
	case score <= -buyThresh:
		return "SELL"
	default:
		return "NEUTRAL"
	}
}

func applyDailyPerformance(row *ScreenerRow, c []domain.Candle) {
	if len(c) == 0 {
		return
	}
	st, ok := analytics.ComputeStats(c)
	if !ok {
		return
	}
	row.Perf1W = st.Change1W
	row.Perf1M = st.Change1M
	row.Perf3M = st.Change3M
	if len(c) > 126 && c[len(c)-127].Close > 0 {
		v := rnd2((c[len(c)-1].Close/c[len(c)-127].Close - 1) * 100)
		row.Perf6M = &v
	} else if st.Change3M != nil {
		row.Perf6M = st.Change3M
	}
	row.PerfYTD = st.ChangeYTD
	row.Perf1Y = st.Change1Y
	if st.High52w > 0 {
		row.High52W = rnd2(st.High52w)
		row.From52WHighPct = st.FromHigh
	}
	if st.Low52w > 0 {
		row.Low52W = rnd2(st.Low52w)
		row.From52WLowPct = rnd2(((row.LastPrice - st.Low52w) / st.Low52w) * 100)
	}
	if row.High52W > row.Low52W {
		row.PosIn52WRange = rnd2(((row.LastPrice - row.Low52W) / (row.High52W - row.Low52W)) * 100)
	}
	hi21, lo21 := calcRangeHighLow(c, 21)
	hi63, lo63 := calcRangeHighLow(c, 63)
	row.High1M, row.Low1M = rnd2(hi21), rnd2(lo21)
	row.High3M, row.Low3M = rnd2(hi63), rnd2(lo63)
	if st.VolAnnual != nil {
		row.VolAnnualPct = *st.VolAnnual
	}
	if len(c) >= 30 {
		sub := c[len(c)-30:]
		if subSt, ok2 := analytics.ComputeStats(sub); ok2 && subSt.VolAnnual != nil {
			row.Vol30dPct = *subSt.VolAnnual
		}
	}
	row.MaxDrawdownPct = st.MaxDrawdown
}

func applyFundamentalsToScreenerRow(row *ScreenerRow, rep provider.FundamentalsReport) {
	r := rep.Ratios
	row.MarketCap = r.MarketCap
	row.EnterpriseValue = r.EnterpriseValue
	row.TrailingPE = r.TrailingPE
	row.ForwardPE = r.ForwardPE
	row.PriceToBook = r.PriceToBook
	row.PriceToSales = r.PriceToSales
	row.EVToEBITDA = r.EnterpriseToEbitda
	row.TrailingEPS = r.TrailingEPS
	row.DividendYieldPct = r.DividendYieldPct
	row.DividendRate = r.DividendRate
	row.GrossMarginPct = r.GrossMarginPct
	row.OperatingMarginPct = r.OperatingMarginPct
	row.ProfitMarginPct = r.ProfitMarginPct
	row.ROEPct = r.ROEPct
	row.ROAPct = r.ROAPct
	row.DebtToEquity = r.DebtToEquity
	row.CurrentRatio = r.CurrentRatio
	row.QuickRatio = r.QuickRatio
	row.Beta = r.Beta
	if len(rep.Annual) > 0 {
		latest := rep.Annual[0]
		row.TotalRevenue = latest.TotalRevenue
		row.NetIncome = latest.NetIncome
		row.FreeCashFlow = latest.FreeCashFlow
	}
}

func calcWMA(prices []float64, length int) float64 {
	n := len(prices)
	if n == 0 {
		return 0
	}
	if n < length {
		length = n
	}
	var num, den float64
	for i := 0; i < length; i++ {
		w := float64(i + 1)
		num += prices[n-length+i] * w
		den += w
	}
	if den == 0 {
		return prices[n-1]
	}
	return num / den
}

func calcVWMA(c []domain.Candle, length int) float64 {
	n := len(c)
	if n == 0 {
		return 0
	}
	if n < length {
		length = n
	}
	var pv, v float64
	for i := n - length; i < n; i++ {
		pv += c[i].Close * c[i].Volume
		v += c[i].Volume
	}
	if v == 0 {
		return c[n-1].Close
	}
	return pv / v
}

func calcHMA(prices []float64, length int) float64 {
	n := len(prices)
	if n == 0 {
		return 0
	}
	if n < length {
		return calcWMA(prices, n)
	}
	half := length / 2
	if half < 1 {
		half = 1
	}
	sqrtLen := int(math.Round(math.Sqrt(float64(length))))
	if sqrtLen < 1 {
		sqrtLen = 1
	}
	if n < length+sqrtLen {
		return 2*calcWMA(prices, half) - calcWMA(prices, length)
	}
	diffSeries := make([]float64, sqrtLen)
	for i := 0; i < sqrtLen; i++ {
		sub := prices[:n-sqrtLen+1+i]
		diffSeries[i] = 2*calcWMA(sub, half) - calcWMA(sub, length)
	}
	return calcWMA(diffSeries, sqrtLen)
}

func calcRangeHighLow(c []domain.Candle, length int) (hi, lo float64) {
	n := len(c)
	if n == 0 {
		return 0, 0
	}
	if n < length {
		length = n
	}
	hi, lo = c[n-length].High, c[n-length].Low
	for i := n - length; i < n; i++ {
		if c[i].High > hi {
			hi = c[i].High
		}
		if c[i].Low < lo {
			lo = c[i].Low
		}
	}
	return hi, lo
}

func calcStoch(c []domain.Candle, kLen, dLen int) (k, d float64) {
	n := len(c)
	if n == 0 {
		return 50, 50
	}
	if dLen < 1 {
		dLen = 3
	}
	var ks []float64
	start := n - dLen
	if start < 0 {
		start = 0
	}
	for idx := start; idx < n; idx++ {
		sub := c[:idx+1]
		hi, lo := calcRangeHighLow(sub, kLen)
		if hi > lo {
			ks = append(ks, ((c[idx].Close-lo)/(hi-lo))*100)
		} else {
			ks = append(ks, 50)
		}
	}
	k = ks[len(ks)-1]
	d = calcSimpleSMA(ks, len(ks))
	return k, d
}

func calcCCI(c []domain.Candle, length int) float64 {
	n := len(c)
	if n == 0 {
		return 0
	}
	if n < length {
		length = n
	}
	tp := make([]float64, length)
	var sum float64
	for i := 0; i < length; i++ {
		b := c[n-length+i]
		tp[i] = (b.High + b.Low + b.Close) / 3
		sum += tp[i]
	}
	mean := sum / float64(length)
	var devSum float64
	for _, v := range tp {
		devSum += math.Abs(v - mean)
	}
	md := devSum / float64(length)
	if md == 0 {
		return 0
	}
	return (tp[length-1] - mean) / (0.015 * md)
}

func calcWilliamsR(c []domain.Candle, length int) float64 {
	n := len(c)
	if n == 0 {
		return -50
	}
	hi, lo := calcRangeHighLow(c, length)
	if hi <= lo {
		return -50
	}
	return ((c[n-1].Close - hi) / (hi - lo)) * 100
}

func calcMFI(c []domain.Candle, length int) float64 {
	n := len(c)
	if n <= 1 {
		return 50
	}
	if n-1 < length {
		length = n - 1
	}
	var posFlow, negFlow float64
	for i := n - length; i < n; i++ {
		tp := (c[i].High + c[i].Low + c[i].Close) / 3
		prevTp := (c[i-1].High + c[i-1].Low + c[i-1].Close) / 3
		mf := tp * c[i].Volume
		if tp > prevTp {
			posFlow += mf
		} else if tp < prevTp {
			negFlow += mf
		}
	}
	if negFlow == 0 {
		if posFlow == 0 {
			return 50
		}
		return 100
	}
	mr := posFlow / negFlow
	return 100 - (100 / (1 + mr))
}

func calcROC(closes []float64, length int) float64 {
	n := len(closes)
	if n <= length || closes[n-1-length] <= 0 {
		return 0
	}
	return ((closes[n-1] - closes[n-1-length]) / closes[n-1-length]) * 100
}

func calcAO(c []domain.Candle) float64 {
	n := len(c)
	if n == 0 {
		return 0
	}
	hl2 := make([]float64, n)
	for i, b := range c {
		hl2[i] = (b.High + b.Low) / 2
	}
	return calcSimpleSMA(hl2, 5) - calcSimpleSMA(hl2, 34)
}

func calcUltimateOsc(c []domain.Candle) float64 {
	n := len(c)
	if n < 2 {
		return 50
	}
	avgBPTR := func(length int) float64 {
		if n-1 < length {
			length = n - 1
		}
		var bpSum, trSum float64
		for i := n - length; i < n; i++ {
			minLo := math.Min(c[i].Low, c[i-1].Close)
			maxHi := math.Max(c[i].High, c[i-1].Close)
			bpSum += c[i].Close - minLo
			trSum += maxHi - minLo
		}
		if trSum == 0 {
			return 0.5
		}
		return bpSum / trSum
	}
	a7, a14, a28 := avgBPTR(7), avgBPTR(14), avgBPTR(28)
	return 100 * (4*a7 + 2*a14 + a28) / 7
}

func calcCMO(closes []float64, length int) float64 {
	n := len(closes)
	if n <= 1 {
		return 0
	}
	if n-1 < length {
		length = n - 1
	}
	var up, dn float64
	for i := n - length; i < n; i++ {
		d := closes[i] - closes[i-1]
		if d > 0 {
			up += d
		} else {
			dn -= d
		}
	}
	if up+dn == 0 {
		return 0
	}
	return 100 * (up - dn) / (up + dn)
}

func calcStdDev(prices []float64, length int) float64 {
	n := len(prices)
	if n < 2 {
		return 0
	}
	if n < length {
		length = n
	}
	mean := calcSimpleSMA(prices, length)
	var sq float64
	for i := n - length; i < n; i++ {
		d := prices[i] - mean
		sq += d * d
	}
	return math.Sqrt(sq / float64(length))
}

func calcATR(c []domain.Candle, length int) float64 {
	n := len(c)
	if n == 0 {
		return 0
	}
	if n == 1 {
		return c[0].High - c[0].Low
	}
	if n-1 < length {
		length = n - 1
	}
	var sum float64
	for i := n - length; i < n; i++ {
		tr := c[i].High - c[i].Low
		tr = math.Max(tr, math.Abs(c[i].High-c[i-1].Close))
		tr = math.Max(tr, math.Abs(c[i].Low-c[i-1].Close))
		sum += tr
	}
	return sum / float64(length)
}

func calcAroon(c []domain.Candle, length int) (up, down float64) {
	n := len(c)
	if n == 0 {
		return 50, 50
	}
	if n <= length {
		length = n - 1
	}
	if length <= 0 {
		return 50, 50
	}
	hiIdx, loIdx := n-1, n-1
	hiVal, loVal := c[n-1].High, c[n-1].Low
	for i := n - 1 - length; i < n; i++ {
		if c[i].High >= hiVal {
			hiVal = c[i].High
			hiIdx = i
		}
		if c[i].Low <= loVal {
			loVal = c[i].Low
			loIdx = i
		}
	}
	barsSinceHi := float64((n - 1) - hiIdx)
	barsSinceLo := float64((n - 1) - loIdx)
	up = ((float64(length) - barsSinceHi) / float64(length)) * 100
	down = ((float64(length) - barsSinceLo) / float64(length)) * 100
	return up, down
}

func calcApproxPSAR(c []domain.Candle) float64 {
	n := len(c)
	if n == 0 {
		return 0
	}
	hi, lo := calcRangeHighLow(c, 10)
	if c[n-1].Close >= (hi+lo)/2 {
		return lo
	}
	return hi
}

func calcOBVSlopePct(c []domain.Candle, length int) float64 {
	n := len(c)
	if n <= length || length <= 0 {
		return 0
	}
	var netVol, totVol float64
	for i := n - length; i < n; i++ {
		totVol += c[i].Volume
		if c[i].Close > c[i-1].Close {
			netVol += c[i].Volume
		} else if c[i].Close < c[i-1].Close {
			netVol -= c[i].Volume
		}
	}
	if totVol == 0 {
		return 0
	}
	return (netVol / totVol) * 100
}

func detectCandlePattern(c []domain.Candle) string {
	n := len(c)
	if n < 2 {
		return "NONE"
	}
	cur := c[n-1]
	prev := c[n-2]
	rng := cur.High - cur.Low
	if rng <= 0 {
		return "DOJI"
	}
	body := math.Abs(cur.Close - cur.Open)
	upperWick := cur.High - math.Max(cur.Open, cur.Close)
	lowerWick := math.Min(cur.Open, cur.Close) - cur.Low

	// Bullish / Bearish Engulfing
	if prev.Close < prev.Open && cur.Close > cur.Open && cur.Open <= prev.Close && cur.Close >= prev.Open {
		return "BULL_ENGULFING"
	}
	if prev.Close > prev.Open && cur.Close < cur.Open && cur.Open >= prev.Close && cur.Close <= prev.Open {
		return "BEAR_ENGULFING"
	}
	// Doji
	if body/rng <= 0.1 {
		return "DOJI"
	}
	// Hammer / Shooting Star
	if lowerWick >= body*2 && upperWick <= body*0.5 {
		return "HAMMER"
	}
	if upperWick >= body*2 && lowerWick <= body*0.5 {
		return "SHOOTING_STAR"
	}
	// Marubozu
	if body/rng >= 0.85 {
		if cur.Close > cur.Open {
			return "MARUBOZU_BULL"
		}
		return "MARUBOZU_BEAR"
	}
	// Inside Bar
	if cur.High < prev.High && cur.Low > prev.Low {
		return "INSIDE_BAR"
	}
	return "NONE"
}

func calcStreak(closes []float64) int {
	n := len(closes)
	if n < 2 {
		return 0
	}
	streak := 0
	for i := n - 1; i >= 1; i-- {
		diff := closes[i] - closes[i-1]
		if diff > 0 {
			if streak < 0 {
				break
			}
			streak++
		} else if diff < 0 {
			if streak > 0 {
				break
			}
			streak--
		} else {
			break
		}
	}
	return streak
}

// ---------- Script Screener (POST /api/screener/script) ----------

// ScriptScreenerFilter describes one filter rule evaluated against a TitanScript script's plots or alertconditions.
type ScriptScreenerFilter struct {
	Target  string  `json:"target"`            // plot title/id (e.g. "RSI", "plot_0") or alertcondition title
	Op      string  `json:"op"`                // "any_alert" | "alert_title" | "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | "between" | "cross_up" | "cross_down" | "rising" | "falling" | "truthy" | "not_na"
	Value   float64 `json:"value,omitempty"`   // numeric threshold
	Value2  float64 `json:"value2,omitempty"`  // upper bound for "between"
	RHSPlot string  `json:"rhsPlot,omitempty"` // optional second plot title/id for plot-vs-plot comparison
}

// ScriptScreenerRequest is the payload for POST /api/screener/script.
type ScriptScreenerRequest struct {
	Code        string               `json:"code"`
	Timeframe   string               `json:"timeframe"`
	Market      string               `json:"market"`
	WatchlistID string               `json:"watchlistId,omitempty"`
	FlagColor   string               `json:"flagColor,omitempty"`
	Symbols     []string             `json:"symbols,omitempty"`
	Filters     []ScriptScreenerFilter `json:"filters,omitempty"`
	OnlyMatched bool                 `json:"onlyMatched,omitempty"`
}

// ScriptScreenerPlotCol describes one plot column discovered from the executed TitanScript.
type ScriptScreenerPlotCol struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

// ScriptScreenerRow is one symbol's evaluation result in the Script Screener.
type ScriptScreenerRow struct {
	domain.SymbolInfo
	LastPrice       float64             `json:"lastPrice"`
	ChangePercent   float64             `json:"changePercent"`
	Volume          float64             `json:"volume"`
	Plots           map[string]*float64 `json:"plots"`
	PrevPlots       map[string]*float64 `json:"prevPlots,omitempty"`
	AlertsFired     []string            `json:"alertsFired"`
	AlertConditions []string            `json:"alertConditions,omitempty"`
	Matched         bool                `json:"matched"`
	ExecutionMs     float64             `json:"executionMs"`
}

func scriptTimeframeCode(tf string) string {
	switch strings.ToLower(strings.TrimSpace(tf)) {
	case "1m":
		return "1"
	case "3m":
		return "3"
	case "5m":
		return "5"
	case "15m":
		return "15"
	case "30m":
		return "30"
	case "1h", "60m":
		return "60"
	case "2h":
		return "120"
	case "4h":
		return "240"
	case "1d", "d":
		return "D"
	case "1w", "w":
		return "W"
	case "1M", "m":
		return "M"
	default:
		return "15"
	}
}

// POST /api/screener/script
func (s *Server) handleScriptScreener(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req ScriptScreenerRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<18)).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid json")
		return
	}
	code := strings.TrimSpace(req.Code)
	if code == "" {
		writeJSONError(w, http.StatusBadRequest, "Betik kodu gerekli")
		return
	}
	if s.Coord == nil || s.Coord.Store == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "storage unavailable")
		return
	}

	tf := strings.TrimSpace(req.Timeframe)
	if tf == "" {
		tf = "15m"
	}
	scriptTF := scriptTimeframeCode(tf)

	// Resolve target symbol universe
	universe := s.resolveScriptScreenerUniverse(r.Context(), req)
	if len(universe) == 0 {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"scriptTitle": "TitanScript Tarayıcı",
			"timeframe":   tf,
			"columns":     []ScriptScreenerPlotCol{},
			"conditions":  []string{},
			"rows":        []ScriptScreenerRow{},
		})
		return
	}

	// Load saved user scripts so `import` libraries work inside Script Screener too.
	var savedScripts []scriptjs.Script
	if list, err := s.Coord.Store.ListScripts(r.Context()); err == nil {
		for _, sc := range list {
			savedScripts = append(savedScripts, scriptjs.Script{Name: sc.Name, Code: sc.Code})
		}
	}

	pool := s.getScriptPool()
	type evalJob struct {
		idx     int
		info    domain.SymbolInfo
		candles []domain.Candle
	}
	var jobs []evalJob
	for i, item := range universe {
		candles, _ := s.Coord.Store.GetLatestCandles(r.Context(), item.Symbol, tf, 220)
		if len(candles) < 15 && tf != "15m" {
			candles, _ = s.Coord.Store.GetLatestCandles(r.Context(), item.Symbol, "15m", 220)
		}
		if len(candles) < 15 && tf != "1d" {
			if d, _ := s.Coord.Store.GetLatestCandles(r.Context(), item.Symbol, "1d", 220); len(d) >= 15 {
				candles = d
			}
		}
		if len(candles) < 5 {
			continue
		}
		jobs = append(jobs, evalJob{idx: i, info: item, candles: candles})
	}

	type evalRes struct {
		row        *ScriptScreenerRow
		cols       []ScriptScreenerPlotCol
		conds      []string
		title      string
		compileErr string
	}
	results := make([]evalRes, len(universe))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4)

	for _, job := range jobs {
		wg.Add(1)
		sem <- struct{}{}
		go func(j evalJob) {
			defer wg.Done()
			defer func() { <-sem }()
			idx := j.idx
			item := j.info
			candles := j.candles

			out, err := pool.Run(scriptjs.Input{
				Code:      code,
				Candles:   candles,
				Symbol:    item.Symbol,
				Timeframe: scriptTF,
				Scripts:   savedScripts,
			}, 3*time.Second)
			if err != nil {
				results[idx] = evalRes{compileErr: err.Error()}
				return
			}
			if !out.OK {
				results[idx] = evalRes{compileErr: out.Error}
				return
			}

			lastIdx := len(candles) - 1
			prevIdx := lastIdx - 1
			plotsMap := map[string]*float64{}
			prevPlotsMap := map[string]*float64{}
			cols := make([]ScriptScreenerPlotCol, 0, len(out.Plots))

			for pi, p := range out.Plots {
				colID := p.ID
				if colID == "" {
					colID = fmt.Sprintf("plot_%d", pi)
				}
				colTitle := strings.TrimSpace(p.Title)
				if colTitle == "" {
					colTitle = fmt.Sprintf("Çizim %d", pi+1)
				}
				cols = append(cols, ScriptScreenerPlotCol{ID: colID, Title: colTitle})

				if lastIdx >= 0 && lastIdx < len(p.Values) && p.Values[lastIdx] != nil {
					v := rnd3(*p.Values[lastIdx])
					plotsMap[colID] = &v
					plotsMap[colTitle] = &v
				}
				if prevIdx >= 0 && prevIdx < len(p.Values) && p.Values[prevIdx] != nil {
					pv := rnd3(*p.Values[prevIdx])
					prevPlotsMap[colID] = &pv
					prevPlotsMap[colTitle] = &pv
				}
			}

			var fired []string
			seenFired := map[string]bool{}
			for _, a := range out.Alerts {
				lbl := strings.TrimSpace(a.Title)
				if lbl == "" {
					lbl = strings.TrimSpace(a.Message)
				}
				if lbl != "" && !seenFired[lbl] {
					seenFired[lbl] = true
					fired = append(fired, lbl)
				}
			}
			if fired == nil {
				fired = []string{}
			}

			var conds []string
			for _, c := range out.AlertConditions {
				if strings.TrimSpace(c.Title) != "" {
					conds = append(conds, strings.TrimSpace(c.Title))
				}
			}

			lastBar := candles[lastIdx]
			firstBar := candles[0]
			chgPct := 0.0
			if firstBar.Open > 0 {
				chgPct = rnd2(((lastBar.Close - firstBar.Open) / firstBar.Open) * 100)
			}

			row := ScriptScreenerRow{
				SymbolInfo:      item,
				LastPrice:       rnd2(lastBar.Close),
				ChangePercent:   chgPct,
				Volume:          math.Round(lastBar.Volume),
				Plots:           plotsMap,
				PrevPlots:       prevPlotsMap,
				AlertsFired:     fired,
				AlertConditions: conds,
				ExecutionMs:     rnd2(out.ExecutionMs),
			}
			row.Matched = evaluateScriptFilters(row, req.Filters)

			results[idx] = evalRes{
				row:   &row,
				cols:  cols,
				conds: conds,
				title: out.Title,
			}
		}(job)
	}
	wg.Wait()

	var (
		scriptTitle = "TitanScript Tarayıcı"
		columns     = []ScriptScreenerPlotCol{}
		conditions  = []string{}
		rows        = []ScriptScreenerRow{}
		firstErr    string
	)
	for _, res := range results {
		if res.compileErr != "" && firstErr == "" {
			firstErr = res.compileErr
		}
		if res.row == nil {
			continue
		}
		if res.title != "" {
			scriptTitle = res.title
		}
		if len(columns) == 0 && len(res.cols) > 0 {
			columns = res.cols
		}
		if len(conditions) == 0 && len(res.conds) > 0 {
			conditions = res.conds
		}
		if req.OnlyMatched && !res.row.Matched {
			continue
		}
		rows = append(rows, *res.row)
	}

	if len(rows) == 0 && firstErr != "" {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]interface{}{
			"ok":    false,
			"error": firstErr,
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":          true,
		"scriptTitle": scriptTitle,
		"timeframe":   tf,
		"columns":     columns,
		"conditions":  conditions,
		"rows":        rows,
	})
}

func (s *Server) resolveScriptScreenerUniverse(ctx context.Context, req ScriptScreenerRequest) []domain.SymbolInfo {
	const maxScriptSymbols = 60
	seen := map[string]bool{}
	var out []domain.SymbolInfo
	addSym := func(raw string) {
		raw = strings.TrimSpace(raw)
		if raw == "" || len(out) >= maxScriptSymbols {
			return
		}
		info := domain.ResolveSymbolInfo(raw)
		if info.Symbol == "" || seen[info.Symbol] {
			return
		}
		seen[info.Symbol] = true
		out = append(out, info)
	}

	if len(req.Symbols) > 0 {
		for _, sym := range req.Symbols {
			addSym(sym)
		}
		return out
	}

	if col := strings.ToLower(strings.TrimSpace(req.FlagColor)); col != "" {
		if flags, err := s.Coord.Store.ListSymbolFlags(ctx); err == nil {
			// Preserve catalog ordering for flagged symbols first, then any custom flagged symbols.
			for _, it := range domain.DefaultSymbolCatalog {
				if flags[it.Symbol] == col {
					addSym(it.Symbol)
				}
			}
			for sym, c := range flags {
				if c == col {
					addSym(sym)
				}
			}
		}
		return out
	}

	if wlID := strings.TrimSpace(req.WatchlistID); wlID != "" {
		if wl, err := s.Coord.Store.GetWatchlist(ctx, wlID); err == nil && wl != nil {
			for _, entry := range wl.Items {
				if entry.Type == "symbol" && entry.Symbol != "" {
					addSym(entry.Symbol)
				}
			}
			return out
		}
	}

	mkt := strings.ToUpper(strings.TrimSpace(req.Market))
	for _, it := range domain.DefaultSymbolCatalog {
		if mkt == "ETF" {
			if !isETFSymbol(it) {
				continue
			}
		} else if mkt != "" && mkt != "ALL" && string(it.Market) != mkt {
			continue
		}
		addSym(it.Symbol)
	}
	return out
}

func evaluateScriptFilters(row ScriptScreenerRow, filters []ScriptScreenerFilter) bool {
	if len(filters) == 0 {
		// Default match rule when no explicit filter is set: true if any alert fired, or if at least one plot is non-null.
		if len(row.AlertsFired) > 0 {
			return true
		}
		for _, v := range row.Plots {
			if v != nil {
				return true
			}
		}
		return false
	}

	for _, f := range filters {
		if !evalSingleScriptFilter(row, f) {
			return false
		}
	}
	return true
}

func evalSingleScriptFilter(row ScriptScreenerRow, f ScriptScreenerFilter) bool {
	op := strings.ToLower(strings.TrimSpace(f.Op))
	target := strings.TrimSpace(f.Target)

	switch op {
	case "any_alert":
		return len(row.AlertsFired) > 0
	case "alert_title":
		for _, a := range row.AlertsFired {
			if strings.EqualFold(a, target) || strings.Contains(strings.ToLower(a), strings.ToLower(target)) {
				return true
			}
		}
		return false
	}

	valPtr := row.Plots[target]
	if valPtr == nil {
		return false
	}
	val := *valPtr

	rhs := f.Value
	hasRHSPlot := strings.TrimSpace(f.RHSPlot) != ""
	if hasRHSPlot {
		rhsPtr := row.Plots[strings.TrimSpace(f.RHSPlot)]
		if rhsPtr == nil {
			return false
		}
		rhs = *rhsPtr
	}

	switch op {
	case "not_na":
		return true
	case "truthy":
		return val != 0
	case "gt", ">":
		return val > rhs
	case "gte", ">=":
		return val >= rhs
	case "lt", "<":
		return val < rhs
	case "lte", "<=":
		return val <= rhs
	case "eq", "==":
		return math.Abs(val-rhs) <= 1e-6
	case "neq", "!=":
		return math.Abs(val-rhs) > 1e-6
	case "between":
		lo, hi := f.Value, f.Value2
		if lo > hi {
			lo, hi = hi, lo
		}
		return val >= lo && val <= hi
	case "rising":
		prevPtr := row.PrevPlots[target]
		return prevPtr != nil && val > *prevPtr
	case "falling":
		prevPtr := row.PrevPlots[target]
		return prevPtr != nil && val < *prevPtr
	case "cross_up":
		prevPtr := row.PrevPlots[target]
		if prevPtr == nil {
			return false
		}
		prevRHS := f.Value
		if hasRHSPlot {
			pRhsPtr := row.PrevPlots[strings.TrimSpace(f.RHSPlot)]
			if pRhsPtr == nil {
				return false
			}
			prevRHS = *pRhsPtr
		}
		return *prevPtr <= prevRHS && val > rhs
	case "cross_down":
		prevPtr := row.PrevPlots[target]
		if prevPtr == nil {
			return false
		}
		prevRHS := f.Value
		if hasRHSPlot {
			pRhsPtr := row.PrevPlots[strings.TrimSpace(f.RHSPlot)]
			if pRhsPtr == nil {
				return false
			}
			prevRHS = *pRhsPtr
		}
		return *prevPtr >= prevRHS && val < rhs
	default:
		return true
	}
}
