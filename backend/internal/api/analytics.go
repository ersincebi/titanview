package api

import (
	"context"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ersincebi/titanview/backend/internal/analytics"
	"github.com/ersincebi/titanview/backend/internal/domain"
	"github.com/ersincebi/titanview/backend/internal/provider"
	"github.com/ersincebi/titanview/backend/internal/sources"
)

const (
	maxCorrSymbols  = 12
	overviewWorkers = 6
)

// dailyCandles returns up to `days` of 1d candles for a symbol; nil on error/no data.
func (s *Server) dailyCandles(ctx context.Context, symbol string, days int) []domain.Candle {
	if s.Coord == nil {
		return nil
	}
	to := time.Now().Unix()
	res, err := s.Coord.GetHistory(ctx, symbol, "1d", to-int64(days)*86400, to)
	if err != nil || res == nil {
		return nil
	}
	return res.Candles
}

// OverviewRow is one instrument's multi-horizon move for the market heatmap.
type OverviewRow struct {
	domain.SymbolInfo
	LastPrice float64  `json:"lastPrice"`
	Change1D  *float64 `json:"change1d"`
	Change1W  *float64 `json:"change1w"`
	Change1M  *float64 `json:"change1m"`
	Turnover  float64  `json:"turnover"` // last-bar volume * close, tile weight
}

// GET /api/overview?market=ALL|CRYPTO|BIST|US|FOREX
// Symbols whose daily history cannot be fetched are omitted, never faked.
func (s *Server) handleOverview(w http.ResponseWriter, r *http.Request) {
	marketFilter := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("market")))
	if v, ok := s.cache.get("overview|" + marketFilter); ok {
		writeJSON(w, http.StatusOK, v)
		return
	}
	items := make([]domain.SymbolInfo, 0, len(domain.DefaultSymbolCatalog))
	for _, it := range domain.DefaultSymbolCatalog {
		if marketFilter != "" && marketFilter != "ALL" && string(it.Market) != marketFilter {
			continue
		}
		items = append(items, it)
	}
	rows := make([]*OverviewRow, len(items))
	var wg sync.WaitGroup
	sem := make(chan struct{}, overviewWorkers)
	for i, it := range items {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int, it domain.SymbolInfo) {
			defer wg.Done()
			defer func() { <-sem }()
			c := s.dailyCandles(r.Context(), it.Symbol, 60)
			st, ok := analytics.ComputeStats(c)
			if !ok {
				return
			}
			last := c[len(c)-1]
			rows[i] = &OverviewRow{SymbolInfo: it, LastPrice: st.Last, Change1D: st.Change1D, Change1W: st.Change1W, Change1M: st.Change1M, Turnover: last.Volume * last.Close}
		}(i, it)
	}
	wg.Wait()
	out := make([]OverviewRow, 0, len(rows))
	for _, row := range rows {
		if row != nil {
			out = append(out, *row)
		}
	}
	resp := map[string]interface{}{"rows": out}
	if len(out) > 0 { // never cache an empty scan (provider outage)
		s.cache.set("overview|"+marketFilter, resp)
	}
	writeJSON(w, http.StatusOK, resp)
}

// GET /api/correlation?symbols=A,B,C&days=250
func (s *Server) handleCorrelation(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var syms []string
	seen := map[string]bool{}
	for _, raw := range strings.Split(q.Get("symbols"), ",") {
		sym := domain.ResolveSymbolInfo(strings.TrimSpace(raw)).Symbol
		if strings.TrimSpace(raw) == "" || seen[sym] {
			continue
		}
		seen[sym] = true
		syms = append(syms, sym)
	}
	if len(syms) < 2 || len(syms) > maxCorrSymbols {
		writeJSONError(w, http.StatusBadRequest, "symbols: need 2.."+strconv.Itoa(maxCorrSymbols)+" distinct symbols")
		return
	}
	days, _ := strconv.Atoi(q.Get("days"))
	if days <= 0 {
		days = 250
	}
	if days > 750 {
		days = 750
	}
	series := make(map[string][]domain.Candle, len(syms))
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, sym := range syms {
		wg.Add(1)
		go func(sym string) {
			defer wg.Done()
			c := s.dailyCandles(r.Context(), sym, days)
			mu.Lock()
			series[sym] = c
			mu.Unlock()
		}(sym)
	}
	wg.Wait()
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"symbols": syms,
		"days":    days,
		"matrix":  analytics.CorrelationMatrix(syms, series),
	})
}

func benchmarkFor(m domain.MarketType) string {
	switch m {
	case domain.MarketBIST:
		return "XU100.IS"
	case domain.MarketUS:
		return "SPY"
	case domain.MarketCrypto:
		return "BTCUSDT"
	}
	return ""
}

// GET /api/security?symbol=THYAO.IS
func (s *Server) handleSecurity(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimSpace(r.URL.Query().Get("symbol"))
	if raw == "" {
		writeJSONError(w, http.StatusBadRequest, "symbol required")
		return
	}
	info := domain.ResolveSymbolInfo(raw)
	c := s.dailyCandles(r.Context(), info.Symbol, 400)
	st, ok := analytics.ComputeStats(c)
	if !ok {
		writeJSONError(w, http.StatusBadGateway, "no daily history for "+info.Symbol)
		return
	}
	resp := map[string]interface{}{"info": info, "stats": st}
	if bench := benchmarkFor(info.Market); bench != "" && bench != info.Symbol {
		if b, ok := analytics.Beta(c, s.dailyCandles(r.Context(), bench, 400)); ok {
			resp["beta"] = math.Round(b*100) / 100
			resp["benchmark"] = bench
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

// GET /api/news?symbol=THYAO.IS&limit=10   (no symbol = general market news)
func (s *Server) handleNews(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	queries := []string{"stock market"}
	if sym := strings.TrimSpace(q.Get("symbol")); sym != "" {
		queries = provider.NewsQueries(sym)
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	var nf provider.NewsFetcher
	if s.Coord != nil {
		nf, _ = s.Coord.Yahoo.(provider.NewsFetcher)
	}
	if nf == nil {
		writeJSONError(w, http.StatusNotImplemented, "news provider unavailable")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()
	var items []provider.NewsItem
	var err error
	query := queries[0]
	for _, qq := range queries {
		query = qq
		items, err = nf.FetchNews(ctx, qq, limit)
		if err != nil || len(items) > 0 {
			break
		}
	}
	// Yahoo had nothing (or failed): try the symbol-aware fallback so BIST still gets real headlines.
	if len(items) == 0 && s.NewsFallback != nil {
		if sym := strings.TrimSpace(q.Get("symbol")); sym != "" {
			if fb, fbErr := s.NewsFallback.FetchNews(ctx, sym, limit); fbErr == nil && len(fb) > 0 {
				items, err, query = fb, nil, sym
			} else if err == nil && errors.Is(fbErr, sources.ErrUnofficialDisabled) {
				err = fbErr
			}
		}
	}
	if err != nil {
		if writeUnofficialDisabledError(w, err) {
			return
		}
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error(), "provider": "YAHOO"})
		return
	}
	if items == nil {
		items = []provider.NewsItem{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"query": query, "items": items})
}

// GET /api/whales?symbol=BTCUSDT&top=25 — crypto only (public exchange tape); other markets have no free tape.
func (s *Server) handleWhales(w http.ResponseWriter, r *http.Request) {
	sym := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("symbol")))
	if sym == "" {
		writeJSONError(w, http.StatusBadRequest, "symbol required")
		return
	}
	info := domain.ResolveSymbolInfo(sym)
	if info.Market != domain.MarketCrypto {
		writeJSON(w, http.StatusOK, map[string]interface{}{"supported": false, "symbol": sym, "reason": "Bu piyasa için ücretsiz işlem akışı (tape) yok; yalnız kripto."})
		return
	}
	var wf provider.WhaleFetcher
	if s.Coord != nil {
		wf, _ = s.Coord.Binance.(provider.WhaleFetcher)
	}
	if wf == nil {
		writeJSONError(w, http.StatusNotImplemented, "whale provider unavailable")
		return
	}
	top, _ := strconv.Atoi(r.URL.Query().Get("top"))
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	rep, err := wf.FetchWhales(ctx, sym, top)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error(), "provider": "BINANCE"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"supported": true, "report": rep})
}
