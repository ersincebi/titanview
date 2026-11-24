package api

import (
	"net/http"
	"sort"
	"strings"
	"sync"

	"github.com/ersincebi/titanview/backend/internal/analytics"
	"github.com/ersincebi/titanview/backend/internal/domain"
)

const (
	insightDays = 900 // ~2.5y calendar: enough for seasonality + 200-bar averages
	ideaDays    = 320 // scan window: 200-bar SMA + 12-1 momentum, cheaper than the single read
)

// GET /api/insights?symbol=THYAO.IS — full programmatic read of one instrument.
func (s *Server) handleInsights(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimSpace(r.URL.Query().Get("symbol"))
	if raw == "" {
		writeJSONError(w, http.StatusBadRequest, "symbol required")
		return
	}
	info := domain.ResolveSymbolInfo(raw)
	key := "insights|" + info.Symbol
	if v, ok := s.cache.get(key); ok {
		writeJSONLang(w, r, http.StatusOK, v)
		return
	}
	c := s.dailyCandles(r.Context(), info.Symbol, insightDays)
	var bench []domain.Candle
	if b := benchmarkFor(info.Market); b != "" && b != info.Symbol {
		bench = s.dailyCandles(r.Context(), b, insightDays)
	}
	in, ok := analytics.ComputeInsights(c, bench)
	if !ok {
		writeJSONError(w, http.StatusBadGateway, "not enough daily history for "+info.Symbol)
		return
	}
	resp := map[string]interface{}{"info": info, "insights": in}
	if b := benchmarkFor(info.Market); b != "" && b != info.Symbol && len(bench) > 0 {
		resp["benchmark"] = b
	}
	s.cache.set(key, resp)
	writeJSONLang(w, r, http.StatusOK, resp)
}

// IdeaRow is one catalog instrument reduced to a rankable, filterable line.
type IdeaRow struct {
	domain.SymbolInfo
	Last     float64            `json:"last"`
	Change1D *float64           `json:"change1d"`
	Score    int                `json:"score"`
	Bias     string             `json:"bias"`
	Tags     []string           `json:"tags"`
	Signals  []analytics.Signal `json:"signals"` // the strongest few
	RSI14    *float64           `json:"rsi14"`
	RelVol   *float64           `json:"relVolume"`
}

// GET /api/ideas?market=ALL|CRYPTO|BIST|US|FOREX — scans the catalog and returns tagged instruments.
// Instruments without enough daily history are omitted, never faked.
func (s *Server) handleIdeas(w http.ResponseWriter, r *http.Request) {
	marketFilter := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("market")))
	if v, ok := s.cache.get("ideas|" + marketFilter); ok {
		writeJSONLang(w, r, http.StatusOK, v)
		return
	}
	items := make([]domain.SymbolInfo, 0, len(domain.DefaultSymbolCatalog))
	for _, it := range domain.DefaultSymbolCatalog {
		if marketFilter != "" && marketFilter != "ALL" && string(it.Market) != marketFilter {
			continue
		}
		items = append(items, it)
	}
	// one benchmark fetch per market, shared by every instrument of that market
	benches := map[domain.MarketType][]domain.Candle{}
	var bmu sync.Mutex
	var bwg sync.WaitGroup
	seen := map[domain.MarketType]bool{}
	for _, it := range items {
		if b := benchmarkFor(it.Market); b != "" && !seen[it.Market] {
			seen[it.Market] = true
			bwg.Add(1)
			go func(m domain.MarketType, sym string) {
				defer bwg.Done()
				c := s.dailyCandles(r.Context(), sym, ideaDays)
				bmu.Lock()
				benches[m] = c
				bmu.Unlock()
			}(it.Market, b)
		}
	}
	bwg.Wait()

	rows := make([]*IdeaRow, len(items))
	var wg sync.WaitGroup
	sem := make(chan struct{}, overviewWorkers)
	for i, it := range items {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int, it domain.SymbolInfo) {
			defer wg.Done()
			defer func() { <-sem }()
			c := s.dailyCandles(r.Context(), it.Symbol, ideaDays)
			var bench []domain.Candle
			if benchmarkFor(it.Market) != it.Symbol {
				bench = benches[it.Market]
			}
			in, ok := analytics.ComputeInsights(c, bench)
			if !ok {
				return
			}
			st, _ := analytics.ComputeStats(c)
			sigs := append([]analytics.Signal(nil), in.Signals...)
			sort.SliceStable(sigs, func(a, b int) bool { return abs64(sigs[a].Weight) > abs64(sigs[b].Weight) })
			if len(sigs) > 3 {
				sigs = sigs[:3]
			}
			rows[i] = &IdeaRow{SymbolInfo: it, Last: in.Last, Change1D: st.Change1D, Score: in.Score, Bias: in.Bias,
				Tags: in.Tags, Signals: sigs, RSI14: in.Metrics.RSI14, RelVol: in.Metrics.RelVolume}
		}(i, it)
	}
	wg.Wait()
	out := make([]IdeaRow, 0, len(rows))
	for _, row := range rows {
		if row != nil {
			out = append(out, *row)
		}
	}
	sort.SliceStable(out, func(a, b int) bool { return out[a].Score > out[b].Score })
	resp := map[string]interface{}{"rows": out}
	if len(out) > 0 {
		s.cache.set("ideas|"+marketFilter, resp)
	}
	writeJSONLang(w, r, http.StatusOK, resp)
}

func abs64(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}
