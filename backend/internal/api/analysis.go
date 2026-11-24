package api

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/ersincebi/titanview/backend/internal/analytics"
	"github.com/ersincebi/titanview/backend/internal/domain"
	"github.com/ersincebi/titanview/backend/internal/provider"
)

const (
	analysisDays = 2500 // analog (historical look-alike) statistics need years of daily bars
	relatedDays  = 260
	relatedPool  = 40
)

// mtfSpec: timeframe and how far back to pull (enough for ≥55 bars incl. session-limited intraday).
var mtfSpec = []struct {
	tf   string
	span int64
}{
	{"15m", 8 * 86400},
	{"1h", 45 * 86400},
	{"4h", 220 * 86400},
	{"1d", 0},
	{"1w", 6 * 365 * 86400},
}

func (s *Server) tfCandles(ctx context.Context, symbol, tf string, span int64) []domain.Candle {
	if s.Coord == nil {
		return nil
	}
	cctx, cancel := context.WithTimeout(ctx, 9*time.Second)
	defer cancel()
	to := time.Now().Unix()
	res, err := s.Coord.GetHistory(cctx, symbol, tf, to-span, to)
	if err != nil || res == nil {
		return nil
	}
	return res.Candles
}

// GET /api/analysis?symbol= — deep read: indicator votes, multi-timeframe trend matrix, projection cone,
// historical look-alikes, volume profile, regime, volume flow, gap stats (stocks).
func (s *Server) handleAnalysis(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimSpace(r.URL.Query().Get("symbol"))
	if raw == "" {
		writeJSONError(w, http.StatusBadRequest, "symbol required")
		return
	}
	info := domain.ResolveSymbolInfo(raw)
	key := "analysis|" + info.Symbol
	if v, ok := s.cache.get(key); ok {
		writeJSONLang(w, r, http.StatusOK, v)
		return
	}
	daily := s.dailyCandles(r.Context(), info.Symbol, analysisDays)
	var bench []domain.Candle
	b := benchmarkFor(info.Market)
	if b != "" && b != info.Symbol {
		bench = s.dailyCandles(r.Context(), b, 900)
	}
	stock := info.Market == domain.MarketBIST || info.Market == domain.MarketUS
	an, ok := analytics.ComputeAnalysis(daily, bench, stock)
	if !ok {
		writeJSONError(w, http.StatusBadGateway, "not enough daily history for "+info.Symbol)
		return
	}

	mtf := make([]*analytics.TFTrend, len(mtfSpec))
	var wg sync.WaitGroup
	for i, sp := range mtfSpec {
		if sp.tf == "1d" {
			if t, ok := analytics.TrendState("1d", daily); ok {
				mtf[i] = &t
			}
			continue
		}
		wg.Add(1)
		go func(i int, tf string, span int64) {
			defer wg.Done()
			if t, ok := analytics.TrendState(tf, s.tfCandles(r.Context(), info.Symbol, tf, span)); ok {
				mtf[i] = &t
			}
		}(i, sp.tf, sp.span)
	}
	wg.Wait()
	rows := make([]analytics.TFTrend, 0, len(mtf))
	up, down := 0, 0
	for i, t := range mtf {
		if t == nil {
			rows = append(rows, analytics.TFTrend{TF: mtfSpec[i].tf, Dir: "na", Detail: "Yeterli veri yok"})
			continue
		}
		rows = append(rows, *t)
		switch t.Dir {
		case "up":
			up++
		case "down":
			down++
		}
	}
	agree := "karışık"
	if n := up + down; n >= 3 {
		switch {
		case up == len(mtf) || (down == 0 && up >= 4):
			agree = "yukarı uyumlu"
		case down == len(mtf) || (up == 0 && down >= 4):
			agree = "aşağı uyumlu"
		}
	}
	resp := map[string]interface{}{
		"info": info, "analysis": an, "mtf": rows, "mtfAgreement": agree,
		"lastBarTime": daily[len(daily)-1].Timestamp,
	}
	if b != "" && b != info.Symbol {
		resp["benchmark"] = b
	}
	s.cache.set(key, resp)
	writeJSONLang(w, r, http.StatusOK, resp)
}

// crossRefs are market-wide drivers shown for every instrument (self excluded).
var crossRefs = []string{"BTCUSDT", "SPY", "XU100.IS", "GC=F", "USDTRY=X", "DX-Y.NYB"}

// GET /api/analysis/related?symbol= — who moves with / against it (same market), benchmark beta and
// rolling correlation, cross-market drivers. Daily log returns on common days only.
func (s *Server) handleAnalysisRelated(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimSpace(r.URL.Query().Get("symbol"))
	if raw == "" {
		writeJSONError(w, http.StatusBadRequest, "symbol required")
		return
	}
	info := domain.ResolveSymbolInfo(raw)
	key := "related|" + info.Symbol
	if v, ok := s.cache.get(key); ok {
		writeJSONLang(w, r, http.StatusOK, v)
		return
	}
	subject := s.dailyCandles(r.Context(), info.Symbol, relatedDays)
	if len(subject) < 40 {
		writeJSONError(w, http.StatusBadGateway, "not enough daily history for "+info.Symbol)
		return
	}
	var pool []domain.SymbolInfo
	for _, it := range domain.DefaultSymbolCatalog {
		if it.Market == info.Market && it.Symbol != info.Symbol && len(pool) < relatedPool {
			pool = append(pool, it)
		}
	}
	var cross []domain.SymbolInfo
	for _, cs := range crossRefs {
		if cs != info.Symbol {
			cross = append(cross, domain.ResolveSymbolInfo(cs))
		}
	}
	build := func(list []domain.SymbolInfo) []analytics.RelatedItem {
		out := make([]*analytics.RelatedItem, len(list))
		var wg sync.WaitGroup
		sem := make(chan struct{}, overviewWorkers)
		for i, it := range list {
			wg.Add(1)
			sem <- struct{}{}
			go func(i int, it domain.SymbolInfo) {
				defer wg.Done()
				defer func() { <-sem }()
				c := s.dailyCandles(r.Context(), it.Symbol, relatedDays)
				r90, n, ok := analytics.CorrOver(subject, c, 90)
				if !ok {
					return
				}
				item := analytics.RelatedItem{Symbol: it.Symbol, DisplayName: it.DisplayName, Market: string(it.Market), R90: r90, N: n}
				if r30, _, ok := analytics.CorrOver(subject, c, 30); ok {
					d := round3(r30 - r90)
					item.R30, item.Delta = &r30, &d
				}
				out[i] = &item
			}(i, it)
		}
		wg.Wait()
		items := make([]analytics.RelatedItem, 0, len(out))
		for _, o := range out {
			if o != nil {
				items = append(items, *o)
			}
		}
		return items
	}
	pos, neg := analytics.RankRelated(build(pool), 5)
	crossItems := build(cross)
	resp := map[string]interface{}{
		"info": info, "positive": pos, "negative": neg, "cross": crossItems, "market": info.Market,
		"note": "Günlük log getiri, ortak işlem günlerinde Pearson (son 90 / 30 gün). Farklı piyasaların takvimi farklıdır; korelasyon nedensellik değildir.",
	}
	if b := benchmarkFor(info.Market); b != "" && b != info.Symbol {
		bc := s.dailyCandles(r.Context(), b, relatedDays)
		resp["benchmark"] = b
		if beta, ok := analytics.Beta(subject, bc); ok {
			resp["beta"] = round3(beta)
		}
		if r, _, ok := analytics.CorrOver(subject, bc, 90); ok {
			resp["benchR90"] = r
		}
		if r, _, ok := analytics.CorrOver(subject, bc, 30); ok {
			resp["benchR30"] = r
		}
	}
	// relative strength vs BTC for crypto
	if info.Market == domain.MarketCrypto && info.Symbol != "BTCUSDT" {
		btc := s.dailyCandles(r.Context(), "BTCUSDT", relatedDays)
		if rs := relStrength(subject, btc, 30); rs != nil {
			resp["relStrengthBTC30d"] = *rs
		}
	}
	s.cache.set(key, resp)
	writeJSONLang(w, r, http.StatusOK, resp)
}

func round3(v float64) float64 { return float64(int(v*1000+sign(v)*0.5)) / 1000 }
func sign(v float64) float64 {
	if v < 0 {
		return -1
	}
	return 1
}

// relStrength: asset % change minus base % change over the last n bars (percentage points).
func relStrength(a, b []domain.Candle, n int) *float64 {
	if len(a) <= n || len(b) <= n || a[len(a)-1-n].Close <= 0 || b[len(b)-1-n].Close <= 0 {
		return nil
	}
	v := (a[len(a)-1].Close/a[len(a)-1-n].Close - b[len(b)-1].Close/b[len(b)-1-n].Close) * 100
	v = float64(int(v*100+sign(v)*0.5)) / 100
	return &v
}

// GET /api/analysis/flow?symbol= — news tone (all markets); whales + order-book imbalance (crypto).
func (s *Server) handleAnalysisFlow(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimSpace(r.URL.Query().Get("symbol"))
	if raw == "" {
		writeJSONError(w, http.StatusBadRequest, "symbol required")
		return
	}
	info := domain.ResolveSymbolInfo(raw)
	key := "flow|" + info.Symbol
	if v, ok := s.cache.get(key); ok {
		writeJSONLang(w, r, http.StatusOK, v)
		return
	}
	resp := map[string]interface{}{"info": info}
	var mu sync.Mutex
	var wg sync.WaitGroup
	set := func(k string, v interface{}) {
		mu.Lock()
		resp[k] = v
		mu.Unlock()
	}

	wg.Add(1)
	go func() {
		defer wg.Done()
		ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
		defer cancel()
		var items []provider.NewsItem
		if s.Coord != nil {
			if nf, ok := s.Coord.Yahoo.(provider.NewsFetcher); ok {
				for _, q := range provider.NewsQueries(info.Symbol) {
					if got, err := nf.FetchNews(ctx, q, 12); err == nil && len(got) > 0 {
						items = got
						break
					}
				}
			}
		}
		if len(items) == 0 && s.NewsFallback != nil {
			if got, err := s.NewsFallback.FetchNews(ctx, info.Symbol, 12); err == nil {
				items = got
			}
		}
		titles := make([]string, len(items))
		for i, it := range items {
			titles[i] = it.Title
		}
		tone := analytics.NewsTone(titles)
		set("tone", tone)
		set("news", items)
	}()

	if info.Market == domain.MarketCrypto && s.Coord != nil {
		if wf, ok := s.Coord.Binance.(provider.WhaleFetcher); ok {
			wg.Add(1)
			go func() {
				defer wg.Done()
				ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
				defer cancel()
				if rep, err := wf.FetchWhales(ctx, info.Symbol, 5); err == nil {
					set("whales", rep)
				}
			}()
		}
		if df, ok := s.Coord.Binance.(provider.DepthFetcher); ok {
			wg.Add(1)
			go func() {
				defer wg.Done()
				ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
				defer cancel()
				if rep, err := df.FetchDepth(ctx, info.Symbol); err == nil {
					set("depth", rep)
				}
			}()
		}
	}
	wg.Wait()
	s.cache.set(key, resp)
	writeJSONLang(w, r, http.StatusOK, resp)
}
