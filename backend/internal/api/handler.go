package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
	"github.com/ersincebi/titanview/backend/internal/hub"
	"github.com/ersincebi/titanview/backend/internal/scriptjs"
	"github.com/ersincebi/titanview/backend/internal/provider"
	"github.com/ersincebi/titanview/backend/internal/storage"
)

// Server wires REST endpoints, WebSocket Hub, and optional static frontend serving.
type Server struct {
	Coord     *provider.CacheCoordinator
	Hub       *hub.LiveHub
	StaticDir string
	// NewsFallback is asked (with the raw symbol) when Yahoo has no headlines, e.g. for BIST.
	NewsFallback provider.NewsFetcher
	// cache holds full-catalog analytics scans (overview/ideas/insights) for a few minutes.
	cache *ttlCache
	// quotes holds live quotes for a few seconds so many open tabs do not hammer upstreams.
	quotes *ttlCache
	// fp is the lazily built order-flow footprint engine (crypto only).
	fp fpState
	// Alerts is the server-side alert engine (nil until EnableAlerts).
	Alerts *AlertService
	// Deribit fetches public BTC/ETH crypto option chains from Deribit Public API v2.
	Deribit *provider.DeribitProvider
	// scriptPool runs TitanScript scripts concurrently for the Script Screener.
	scriptMu   sync.Mutex
	scriptPool *scriptjs.Pool
	// Trading is the paper engine + Binance client (nil until EnableTrading).
	Trading *TradingService
}

// NewServer creates a new TitanView HTTP/WS server.
func NewServer(coord *provider.CacheCoordinator, liveHub *hub.LiveHub, staticDir string) *Server {
	resolvedDir := resolveStaticDir(staticDir)
	return &Server{
		Coord:     coord,
		Hub:       liveHub,
		StaticDir: resolvedDir,
		cache:     newTTLCache(3*time.Minute, 256),
		quotes:    newTTLCache(8*time.Second, 512),
	}
}

// resolveStaticDir locates the built static assets directory across common working directories.
func resolveStaticDir(preferred string) string {
	if preferred != "" {
		if info, err := os.Stat(preferred); err == nil && info.IsDir() {
			return preferred
		}
	}
	candidates := []string{"dist", "../dist", "../../dist", "frontend/dist", "../frontend/dist"}
	for _, c := range candidates {
		if info, err := os.Stat(c); err == nil && info.IsDir() {
			return c
		}
	}
	return preferred
}

// Routes returns the configured http.Handler with CORS middleware.
func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/api/history", s.handleHistory)
	mux.HandleFunc("/api/symbols", s.handleSymbols)
	mux.HandleFunc("/api/screener", s.handleScreener)
	mux.HandleFunc("/api/quotes", s.handleQuotes)
	mux.HandleFunc("/api/overview", s.handleOverview)
	mux.HandleFunc("/api/correlation", s.handleCorrelation)
	mux.HandleFunc("/api/security", s.handleSecurity)
	mux.HandleFunc("/api/insights", s.handleInsights)
	mux.HandleFunc("/api/analysis", s.handleAnalysis)
	mux.HandleFunc("/api/analysis/related", s.handleAnalysisRelated)
	mux.HandleFunc("/api/analysis/flow", s.handleAnalysisFlow)
	mux.HandleFunc("/api/ideas", s.handleIdeas)
	mux.HandleFunc("/api/news", s.handleNews)
	mux.HandleFunc("/api/whales", s.handleWhales)
	mux.HandleFunc("/api/footprint", s.handleFootprint)
	mux.HandleFunc("/api/events", s.handleEvents)
	mux.HandleFunc("/api/fx", s.handleFx)
	mux.HandleFunc("/api/fundamentals", s.handleFundamentals)
	mux.HandleFunc("/api/calendar", s.handleCalendar)
	mux.HandleFunc("/api/options", s.handleOptions)
	mux.HandleFunc("/api/collect", s.handleCollect)
	mux.HandleFunc("/api/cache-stats", s.handleCacheStats)
	mux.HandleFunc("/api/stats", s.handleCacheStats)
	mux.HandleFunc("/api/scripts", s.handleScripts)
	mux.HandleFunc("/api/scripts/versions", s.handleScriptVersions)
	mux.HandleFunc("/api/scripts/rename", s.handleScriptRename)
	mux.HandleFunc("/api/drawings", s.handleDrawings)
	mux.HandleFunc("/api/settings", s.handleSettings)
	mux.HandleFunc("/api/sources", s.handleSources)
	mux.HandleFunc("/api/layouts", s.handleLayouts)
	mux.HandleFunc("/api/layouts/", s.handleLayoutSub)
	mux.HandleFunc("/api/watchlists", s.handleWatchlists)
	mux.HandleFunc("/api/watchlists/flag", s.handleWatchlistFlag)
	mux.HandleFunc("/api/notes", s.handleNotes)
	mux.HandleFunc("/api/screener/presets", s.handleScreenerPresets)
	mux.HandleFunc("/api/screener/script", s.handleScriptScreener)
	mux.HandleFunc("/api/alerts", s.handleAlerts)
	mux.HandleFunc("/api/alerts/action", s.handleAlertAction)
	mux.HandleFunc("/api/alerts/log", s.handleAlertLog)
	mux.HandleFunc("/api/alerts/stream", s.handleAlertStream)
	mux.HandleFunc("/api/alerts/config", s.handleAlertConfig)
	mux.HandleFunc("/api/alerts/test", s.handleAlertTest)
	mux.HandleFunc("/api/alerts/push/key", s.handlePushKey)
	mux.HandleFunc("/api/alerts/push/subscribe", s.handlePushSubscribe)
	s.registerTrading(mux)
	mux.HandleFunc("/ws/live", s.Hub.HandleWS)

	if s.StaticDir != "" {
		mux.HandleFunc("/", s.handleStatic)
	}

	return withCORS(mux)
}

// GET /api/history?symbol=THYAO.IS&interval=15m&from=...&to=...
func (s *Server) handleHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	q := r.URL.Query()
	symbol := q.Get("symbol")
	if symbol == "" {
		symbol = "BTCUSDT"
	}
	interval := q.Get("interval")
	if interval == "" {
		interval = "15m"
	}

	fromSec, _ := strconv.ParseInt(q.Get("from"), 10, 64)
	toSec, _ := strconv.ParseInt(q.Get("to"), 10, 64)
	currency := strings.TrimSpace(q.Get("currency"))

	res, err := s.Coord.GetHistoryWithCurrency(r.Context(), symbol, interval, fromSec, toSec, currency)
	if err != nil {
		if writeUnofficialDisabledError(w, err) {
			return
		}
		var unsupErr *provider.UnsupportedIntervalError
		if errors.As(err, &unsupErr) {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]interface{}{
				"error":       unsupErr.Reason,
				"provider":    unsupErr.Provider,
				"interval":    unsupErr.Interval,
				"unsupported": true,
			})
			return
		}
		var upErr *provider.UpstreamError
		if errors.As(err, &upErr) {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": upErr.Error(), "provider": upErr.Provider})
			return
		}
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, res)
}

// SymbolQuoteSummary augments SymbolInfo with latest cached price & 24h change for the Watchlist.
type SymbolQuoteSummary struct {
	domain.SymbolInfo
	LastPrice     *float64 `json:"lastPrice"`
	ChangeAbs     *float64 `json:"changeAbs,omitempty"`
	ChangePercent *float64 `json:"changePercent"`
	High24h       *float64 `json:"high24h"`
	Low24h        *float64 `json:"low24h"`
	Volume24h     *float64 `json:"volume24h"`
	ExtPrice      *float64 `json:"extPrice,omitempty"`
	ExtChangePct  *float64 `json:"extChangePct,omitempty"`
	ExtSession    string   `json:"extSession,omitempty"`
	TechRating    *string  `json:"techRating,omitempty"`
	TechScore     *int     `json:"techScore,omitempty"`
}

// ScreenerRow represents a Gelişmiş Tarayıcı technical & fundamental evaluation row (130+ metrics).
type ScreenerRow struct {
	domain.SymbolInfo

	// Price & Volume (18)
	LastPrice     float64  `json:"lastPrice"`
	OpenPrice     float64  `json:"openPrice"`
	HighPrice     float64  `json:"highPrice"`
	LowPrice      float64  `json:"lowPrice"`
	PrevClose     float64  `json:"prevClose"`
	ChangeAbs     float64  `json:"changeAbs"`
	ChangePercent float64  `json:"changePercent"`
	GapPct        float64  `json:"gapPct"`
	Volume        float64  `json:"volume"`
	AvgVolume10   float64  `json:"avgVolume10"`
	AvgVolume20   float64  `json:"avgVolume20"`
	AvgVolume30   float64  `json:"avgVolume30"`
	AvgVolume60   float64  `json:"avgVolume60"`
	AvgVolume90   float64  `json:"avgVolume90"`
	RelVolume     float64  `json:"relVolume"`
	Turnover      float64  `json:"turnover"`
	ExtPrice      *float64 `json:"extPrice,omitempty"`
	ExtChangePct  *float64 `json:"extChangePct,omitempty"`

	// Performance & 52W Range (16)
	Perf1W         *float64 `json:"perf1w,omitempty"`
	Perf1M         *float64 `json:"perf1m,omitempty"`
	Perf3M         *float64 `json:"perf3m,omitempty"`
	Perf6M         *float64 `json:"perf6m,omitempty"`
	PerfYTD        *float64 `json:"perfYtd,omitempty"`
	Perf1Y         *float64 `json:"perf1y,omitempty"`
	High52W        float64  `json:"high52w"`
	Low52W         float64  `json:"low52w"`
	From52WHighPct float64  `json:"from52wHighPct"`
	From52WLowPct  float64  `json:"from52wLowPct"`
	High1M         float64  `json:"high1m"`
	Low1M          float64  `json:"low1m"`
	High3M         float64  `json:"high3m"`
	Low3M          float64  `json:"low3m"`
	PosIn52WRange  float64  `json:"posIn52wRange"`
	PosInDayRange  float64  `json:"posInDayRange"`

	// Moving Averages (22)
	SMA5          float64 `json:"sma5"`
	SMA10         float64 `json:"sma10"`
	SMA20         float64 `json:"sma20"`
	SMA30         float64 `json:"sma30"`
	SMA50         float64 `json:"sma50"`
	SMA100        float64 `json:"sma100"`
	SMA200        float64 `json:"sma200"`
	EMA5          float64 `json:"ema5"`
	EMA10         float64 `json:"ema10"`
	EMA12         float64 `json:"ema12"`
	EMA20         float64 `json:"ema20"`
	EMA26         float64 `json:"ema26"`
	EMA30         float64 `json:"ema30"`
	EMA50         float64 `json:"ema50"`
	EMA100        float64 `json:"ema100"`
	EMA200        float64 `json:"ema200"`
	WMA20         float64 `json:"wma20"`
	VWMA20        float64 `json:"vwma20"`
	HMA9          float64 `json:"hma9"`
	DistSMA20Pct  float64 `json:"distSma20Pct"`
	DistSMA50Pct  float64 `json:"distSma50Pct"`
	DistSMA200Pct float64 `json:"distSma200Pct"`

	// Oscillators (22)
	RSI7        float64 `json:"rsi7"`
	RSI14       float64 `json:"rsi14"`
	RSI21       float64 `json:"rsi21"`
	StochK      float64 `json:"stochK"`
	StochD      float64 `json:"stochD"`
	StochRSIK   float64 `json:"stochRsiK"`
	StochRSID   float64 `json:"stochRsiD"`
	MACD        float64 `json:"macd"`
	MACDSignal  float64 `json:"macdSignal"`
	MACDHist    float64 `json:"macdHist"`
	CCI20       float64 `json:"cci20"`
	WilliamsR14 float64 `json:"williamsR14"`
	MFI14       float64 `json:"mfi14"`
	ROC9        float64 `json:"roc9"`
	ROC20       float64 `json:"roc20"`
	Momentum10  float64 `json:"momentum10"`
	AO          float64 `json:"ao"`
	UO          float64 `json:"uo"`
	CMO14       float64 `json:"cmo14"`
	BullPower13 float64 `json:"bullPower13"`
	BearPower13 float64 `json:"bearPower13"`
	ZScore20    float64 `json:"zScore20"`

	// Trend, Volatility & Flow (31)
	ADX14          float64 `json:"adx14"`
	PlusDI14       float64 `json:"plusDi14"`
	MinusDI14      float64 `json:"minusDi14"`
	Supertrend     float64 `json:"supertrend"`
	SupertrendDir  int     `json:"supertrendDir"` // +1 bull, -1 bear
	PSAR           float64 `json:"psar"`
	AroonUp14      float64 `json:"aroonUp14"`
	AroonDown14    float64 `json:"aroonDown14"`
	AroonOsc14     float64 `json:"aroonOsc14"`
	IchimokuTenkan float64 `json:"ichimokuTenkan"`
	IchimokuKijun  float64 `json:"ichimokuKijun"`
	IchimokuSpanA  float64 `json:"ichimokuSpanA"`
	IchimokuSpanB  float64 `json:"ichimokuSpanB"`
	ATR14          float64 `json:"atr14"`
	ATR14Pct       float64 `json:"atr14Pct"`
	NATR14         float64 `json:"natr14"`
	BBUpper20      float64 `json:"bbUpper20"`
	BBMiddle20     float64 `json:"bbMiddle20"`
	BBLower20      float64 `json:"bbLower20"`
	BBWidthPct     float64 `json:"bbWidthPct"`
	BBPercentB     float64 `json:"bbPercentB"`
	KCUpper20      float64 `json:"kcUpper20"`
	KCLower20      float64 `json:"kcLower20"`
	DonchianHigh20 float64 `json:"donchianHigh20"`
	DonchianLow20  float64 `json:"donchianLow20"`
	VolAnnualPct   float64 `json:"volAnnualPct"`
	Vol30dPct      float64 `json:"vol30dPct"`
	MaxDrawdownPct float64 `json:"maxDrawdownPct"`
	CMF20          float64 `json:"cmf20"`
	OBVSlopePct    float64 `json:"obvSlopePct"`
	VWAP           float64 `json:"vwap"`

	// Ratings & Patterns (8)
	Rating        string `json:"rating"`    // "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL"
	Score         int    `json:"score"`     // total score
	MARating      string `json:"maRating"`  // "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL"
	MAScore       int    `json:"maScore"`   // moving average sub-score
	OscRating     string `json:"oscRating"` // "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL"
	OscScore      int    `json:"oscScore"`  // oscillator sub-score
	CandlePattern string `json:"candlePattern"`
	Streak        int    `json:"streak"`

	// Fundamentals & Valuation (22, nil when unavailable/crypto/forex)
	IsETF              bool     `json:"isEtf"`
	MarketCap          *float64 `json:"marketCap,omitempty"`
	EnterpriseValue    *float64 `json:"enterpriseValue,omitempty"`
	TrailingPE         *float64 `json:"trailingPe,omitempty"`
	ForwardPE          *float64 `json:"forwardPe,omitempty"`
	PriceToBook        *float64 `json:"priceToBook,omitempty"`
	PriceToSales       *float64 `json:"priceToSales,omitempty"`
	EVToEBITDA         *float64 `json:"evToEbitda,omitempty"`
	TrailingEPS        *float64 `json:"trailingEps,omitempty"`
	DividendYieldPct   *float64 `json:"dividendYieldPct,omitempty"`
	DividendRate       *float64 `json:"dividendRate,omitempty"`
	GrossMarginPct     *float64 `json:"grossMarginPct,omitempty"`
	OperatingMarginPct *float64 `json:"operatingMarginPct,omitempty"`
	ProfitMarginPct    *float64 `json:"profitMarginPct,omitempty"`
	ROEPct             *float64 `json:"roePct,omitempty"`
	ROAPct             *float64 `json:"roaPct,omitempty"`
	DebtToEquity       *float64 `json:"debtToEquity,omitempty"`
	CurrentRatio       *float64 `json:"currentRatio,omitempty"`
	QuickRatio         *float64 `json:"quickRatio,omitempty"`
	Beta               *float64 `json:"beta,omitempty"`
	TotalRevenue       *float64 `json:"totalRevenue,omitempty"`
	NetIncome          *float64 `json:"netIncome,omitempty"`
	FreeCashFlow       *float64 `json:"freeCashFlow,omitempty"`
}

// GET /api/symbols?market=ALL|CRYPTO|BIST|US|FOREX&q=...
// Price fields are null when no real cached data exists; never fabricated.
func (s *Server) handleSymbols(w http.ResponseWriter, r *http.Request) {
	marketFilter := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("market")))
	searchQuery := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("q")))

	out := []SymbolQuoteSummary{}
	for _, item := range domain.DefaultSymbolCatalog {
		if marketFilter != "" && marketFilter != "ALL" && string(item.Market) != marketFilter {
			continue
		}
		if searchQuery != "" && !strings.Contains(item.Symbol, searchQuery) && !strings.Contains(strings.ToUpper(item.DisplayName), searchQuery) {
			continue
		}
		out = append(out, s.quoteSummary(r.Context(), item))
	}

	// Free-text lookup beyond the built-in catalog (Yahoo search); never blocks the catalog hits on failure.
	if searchQuery != "" && s.Coord != nil && (marketFilter == "" || marketFilter == "ALL" || marketFilter != "CRYPTO") {
		if ss, ok := s.Coord.Yahoo.(provider.SymbolSearcher); ok {
			sctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
			found, _ := ss.SearchSymbols(sctx, searchQuery, 10)
			cancel()
			seen := map[string]bool{}
			for _, o := range out {
				seen[o.Symbol] = true
			}
			for _, f := range found {
				if seen[f.Symbol] || (marketFilter != "" && marketFilter != "ALL" && string(f.Market) != marketFilter) {
					continue
				}
				out = append(out, s.quoteSummary(r.Context(), f))
			}
		}
	}

	// Custom symbol not in catalog (e.g. ASTOR.IS, PEPEUSDT): resolve routing only, no price.
	if searchQuery != "" && len(out) == 0 {
		out = append(out, s.quoteSummary(r.Context(), domain.ResolveSymbolInfo(searchQuery)))
	}

	if searchQuery != "" {
		rankSymbolMatches(out, searchQuery)
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"symbols": out,
	})
}

// rankSymbolMatches Sıralama önceliği: tam sembol > sembol öneki > sembolde geçen > yalnız adda geçen.
// "ETH" sorgusu "Tether US" adı yüzünden BTCUSDT'yi ETHUSDT'nin önüne koyuyordu.
func rankSymbolMatches(out []SymbolQuoteSummary, q string) {
	rank := func(x SymbolQuoteSummary) int {
		sym := strings.ToUpper(x.Symbol)
		base := strings.SplitN(sym, ".", 2)[0]
		switch {
		case sym == q || base == q:
			return 0
		case strings.HasPrefix(sym, q):
			return 1
		case strings.Contains(sym, q):
			return 2
		default:
			return 3
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return rank(out[i]) < rank(out[j]) })
}

func (s *Server) quoteSummary(ctx context.Context, item domain.SymbolInfo) SymbolQuoteSummary {
	sum := SymbolQuoteSummary{SymbolInfo: item}
	if s.Coord == nil || s.Coord.Store == nil {
		return sum
	}
	latest, err := s.Coord.Store.GetLatestCandles(ctx, item.Symbol, "15m", 65)
	daily := false
	if err != nil || len(latest) == 0 {
		latest, err = s.Coord.Store.GetLatestCandles(ctx, item.Symbol, "1d", 65)
		daily = true
	}
	if err != nil || len(latest) == 0 {
		return sum
	}
	// 24 saatlik pencere: 15m'de son 32 bar (8 sa, eski davranış), 1d'de yalnız son gün.
	// 1d mumlarından 32 günlük değişimi "günlük değişim" diye göstermek yanıltıcıydı (ETH -%30 vs gerçek +%1,6).
	window := latest
	if daily {
		window = latest[len(latest)-1:]
	} else if len(window) > 32 {
		window = window[len(window)-32:]
	}
	last := window[len(window)-1].Close
	high, low, vol := window[0].High, window[0].Low, 0.0
	for _, c := range window {
		if c.High > high {
			high = c.High
		}
		if c.Low < low {
			low = c.Low
		}
		vol += c.Volume
	}
	sum.LastPrice = &last
	first := window[0].Open
	if daily && len(latest) >= 2 {
		first = latest[len(latest)-2].Close // önceki günün kapanışına göre ("Değ%")
	}
	if first > 0 {
		chgAbs := math.Round((last-first)*10000) / 10000
		chg := math.Round(((last-first)/first)*100.0*100) / 100
		sum.ChangeAbs = &chgAbs
		sum.ChangePercent = &chg
	}
	sum.High24h, sum.Low24h, sum.Volume24h = &high, &low, &vol
	if len(latest) >= 15 {
		ev := evaluateScreenerRow(item, latest)
		rating := ev.Rating
		score := ev.Score
		sum.TechRating = &rating
		sum.TechScore = &score
	}
	if s.quotes != nil {
		if v, ok := s.quotes.get("q|" + item.Symbol); ok {
			q := v.(provider.Quote)
			if q.Last > 0 {
				l := q.Last
				c := math.Round(q.Change*10000) / 10000
				p := math.Round(q.ChangePct*100) / 100
				sum.LastPrice = &l
				sum.ChangeAbs = &c
				sum.ChangePercent = &p
			}
			if q.Volume != nil && *q.Volume > 0 {
				sum.Volume24h = q.Volume
			}
			if q.ExtPrice != nil {
				sum.ExtPrice = q.ExtPrice
			}
			if q.ExtChangePct != nil {
				sum.ExtChangePct = q.ExtChangePct
			}
			if q.ExtSession != "" {
				sum.ExtSession = q.ExtSession
			}
		}
	}
	return sum
}

// GET /api/screener?market=ALL|BIST|CRYPTO|US|FOREX|ETF&timeframe=15m|1h|4h|1d|1w
// Symbols with too little real cached data are omitted instead of faked.
func (s *Server) handleScreener(w http.ResponseWriter, r *http.Request) {
	s.handleAdvancedScreener(w, r)
}

func evaluateScreenerRow(info domain.SymbolInfo, candles []domain.Candle) ScreenerRow {
	n := len(candles)
	if n == 0 {
		return ScreenerRow{SymbolInfo: info, Rating: "NEUTRAL"}
	}

	closes := make([]float64, n)
	for i, c := range candles {
		closes[i] = c.Close
	}

	last := candles[n-1]
	first := candles[0]
	chgPct := 0.0
	if first.Open > 0 {
		chgPct = ((last.Close - first.Open) / first.Open) * 100.0
	}

	ema20 := calcSimpleEMA(closes, 20)
	ema50 := calcSimpleEMA(closes, 50)
	sma200 := calcSimpleSMA(closes, 200)
	ema12 := calcSimpleEMA(closes, 12)
	ema26 := calcSimpleEMA(closes, 26)
	macdVal := ema12 - ema26
	rsi14 := calcSimpleRSI(closes, 14)

	score := 0
	if last.Close > ema20 {
		score++
	} else {
		score--
	}
	if ema20 > ema50 {
		score++
	} else {
		score--
	}
	if last.Close > sma200 {
		score++
	} else {
		score--
	}
	if macdVal > 0 {
		score++
	} else {
		score--
	}
	if rsi14 > 55 && rsi14 < 72 {
		score++
	} else if rsi14 < 32 {
		score += 2 // Oversold bounce signal
	} else if rsi14 > 75 {
		score--
	}
	if chgPct > 0.8 {
		score++
	} else if chgPct < -0.8 {
		score--
	}

	rating := "NEUTRAL"
	switch {
	case score >= 3:
		rating = "STRONG_BUY"
	case score >= 1:
		rating = "BUY"
	case score <= -3:
		rating = "STRONG_SELL"
	case score <= -1:
		rating = "SELL"
	}

	return enrichScreenerRow(ScreenerRow{
		SymbolInfo:    info,
		LastPrice:     last.Close,
		ChangePercent: math.Round(chgPct*100) / 100,
		Volume:        last.Volume,
		RSI14:         math.Round(rsi14*10) / 10,
		EMA20:         math.Round(ema20*100) / 100,
		EMA50:         math.Round(ema50*100) / 100,
		SMA200:        math.Round(sma200*100) / 100,
		MACD:          math.Round(macdVal*1000) / 1000,
		Rating:        rating,
		Score:         score,
	}, candles)
}

func calcSimpleSMA(prices []float64, length int) float64 {
	if len(prices) == 0 {
		return 0
	}
	if len(prices) < length {
		sum := 0.0
		for _, p := range prices {
			sum += p
		}
		return sum / float64(len(prices))
	}
	sum := 0.0
	for i := len(prices) - length; i < len(prices); i++ {
		sum += prices[i]
	}
	return sum / float64(length)
}

func calcSimpleEMA(prices []float64, length int) float64 {
	if len(prices) == 0 {
		return 0
	}
	alpha := 2.0 / float64(length+1)
	ema := prices[0]
	for i := 1; i < len(prices); i++ {
		ema = alpha*prices[i] + (1.0-alpha)*ema
	}
	return ema
}

func calcSimpleRSI(prices []float64, length int) float64 {
	if len(prices) <= length {
		return 50.0
	}
	avgGain := 0.0
	avgLoss := 0.0
	for i := 1; i <= length; i++ {
		diff := prices[i] - prices[i-1]
		if diff > 0 {
			avgGain += diff
		} else {
			avgLoss -= diff
		}
	}
	avgGain /= float64(length)
	avgLoss /= float64(length)

	for i := length + 1; i < len(prices); i++ {
		diff := prices[i] - prices[i-1]
		gain := 0.0
		loss := 0.0
		if diff > 0 {
			gain = diff
		} else {
			loss = -diff
		}
		avgGain = (avgGain*float64(length-1) + gain) / float64(length)
		avgLoss = (avgLoss*float64(length-1) + loss) / float64(length)
	}
	if avgLoss == 0 {
		return 100.0
	}
	rs := avgGain / avgLoss
	return 100.0 - (100.0 / (1.0 + rs))
}

// GET /api/cache-stats or /api/stats
func (s *Server) handleCacheStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	stats, err := s.Coord.Store.GetCacheStats(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if s.Coord != nil {
		tot, hits, ratio := s.Coord.HitStats()
		stats.TotalRequests = tot
		stats.CacheHits = hits
		stats.CacheHitRatio = ratio
	}
	if s.Hub != nil {
		stats.ActiveClients = s.Hub.ClientCount()
		stats.ActiveWorkers = s.Hub.ActiveWorkersCount()
	}
	writeJSON(w, http.StatusOK, stats)
}

// GET | POST | DELETE /api/scripts
func (s *Server) handleScripts(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		scripts, err := s.Coord.Store.ListScripts(r.Context())
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if scripts == nil {
			scripts = []storage.SavedScript{}
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"scripts": scripts})

	case http.MethodPost:
		var sc storage.SavedScript
		if err := json.NewDecoder(r.Body).Decode(&sc); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid json")
			return
		}
		if sc.ID == "" {
			sc.ID = fmt.Sprintf("script_%d", time.Now().UnixNano())
		}
		if err := s.Coord.Store.SaveScript(r.Context(), sc); err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, sc)

	case http.MethodDelete:
		id := r.URL.Query().Get("id")
		if id == "" {
			writeJSONError(w, http.StatusBadRequest, "id query parameter required")
			return
		}
		if err := s.Coord.Store.DeleteScript(r.Context(), id); err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})

	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// GET | POST | DELETE /api/drawings
func (s *Server) handleDrawings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		sym := r.URL.Query().Get("symbol")
		if sym == "" {
			sym = "THYAO.IS"
		}
		layoutID := r.URL.Query().Get("layoutId")
		scope := r.URL.Query().Get("scope") // "global" | "layout" | "local" (default global/includeGlobal)
		includeGlobal := scope != "local"
		list, err := s.Coord.Store.ListDrawingsForScope(r.Context(), sym, layoutID, includeGlobal)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if list == nil {
			list = []storage.SavedDrawing{}
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"drawings": list})

	case http.MethodPost:
		var d storage.SavedDrawing
		if err := json.NewDecoder(r.Body).Decode(&d); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid json")
			return
		}
		if d.ID == "" {
			d.ID = fmt.Sprintf("draw_%d", time.Now().UnixNano())
		}
		if err := s.Coord.Store.SaveDrawing(r.Context(), d); err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, d)

	case http.MethodDelete:
		sym := r.URL.Query().Get("symbol")
		id := r.URL.Query().Get("id")
		layoutID := r.URL.Query().Get("layoutId")
		if err := s.Coord.Store.DeleteDrawingsForScope(r.Context(), sym, id, layoutID); err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})

	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	if s.StaticDir == "" {
		http.NotFound(w, r)
		return
	}
	cleanPath := filepath.Clean(r.URL.Path)
	if strings.Contains(cleanPath, "..") {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	// Never serve frontend HTML for unmatched /api or /ws routes
	if strings.HasPrefix(cleanPath, "/api/") || strings.HasPrefix(cleanPath, "/ws/") || cleanPath == "/api" || cleanPath == "/ws" {
		writeJSONError(w, http.StatusNotFound, "endpoint not found")
		return
	}
	if cleanPath == "/" || cleanPath == "." {
		cleanPath = "/index.html"
	}
	fullPath := filepath.Join(s.StaticDir, cleanPath)

	// Set optimized caching headers
	if strings.HasPrefix(cleanPath, "/assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else if cleanPath == "/index.html" {
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	} else if cleanPath == "/sw.js" {
		// servis işçisi her zaman yeniden doğrulanmalı; yoksa güncelleme günlerce gecikir
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		w.Header().Set("Service-Worker-Allowed", "/")
	} else if cleanPath == "/manifest.webmanifest" {
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Content-Type", "application/manifest+json")
	} else if strings.HasPrefix(cleanPath, "/icons/") {
		w.Header().Set("Cache-Control", "public, max-age=86400")
	}

	if info, err := os.Stat(fullPath); err == nil && !info.IsDir() {
		http.ServeFile(w, r, fullPath)
		return
	}

	// PWA dosyaları yoksa HTML döndürme (servis işçisi/manifest bozuk MIME ile sessizce başarısız olur)
	if cleanPath == "/sw.js" || cleanPath == "/manifest.webmanifest" || strings.HasPrefix(cleanPath, "/icons/") || strings.HasPrefix(cleanPath, "/assets/") {
		w.Header().Del("Content-Type")
		w.Header().Del("Cache-Control")
		http.NotFound(w, r)
		return
	}

	// SPA fallback: return index.html for unknown frontend routes
	indexPath := filepath.Join(s.StaticDir, "index.html")
	if _, err := os.Stat(indexPath); err == nil {
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		http.ServeFile(w, r, indexPath)
		return
	}

	http.NotFound(w, r)
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Titan-Token")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// GET | PUT /api/collect — symbols whose candles are collected in the background (favourites).
func (s *Server) handleCollect(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.Coord.Store.ListCollectSymbols(r.Context())
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, collectResponse(list))
	case http.MethodPut, http.MethodPost:
		var body struct {
			Symbols []string `json:"symbols"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&body); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid json")
			return
		}
		if err := s.Coord.Store.SetCollectSymbols(r.Context(), body.Symbols); err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		list, _ := s.Coord.Store.ListCollectSymbols(r.Context())
		writeJSON(w, http.StatusOK, collectResponse(list))
	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// collectResponse adds display info so a fresh browser can rebuild the favourites list from the server.
func collectResponse(list []string) map[string]interface{} {
	type item struct {
		Symbol      string `json:"symbol"`
		DisplayName string `json:"displayName"`
		Market      string `json:"market"`
	}
	items := make([]item, 0, len(list))
	for _, sym := range list {
		info := domain.ResolveSymbolInfo(sym)
		items = append(items, item{Symbol: sym, DisplayName: info.DisplayName, Market: string(info.Market)})
	}
	return map[string]interface{}{"symbols": list, "items": items, "max": storage.MaxCollectSymbols}
}
