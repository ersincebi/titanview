package api

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
	"github.com/ersincebi/titanview/backend/internal/footprint"
	"github.com/ersincebi/titanview/backend/internal/provider"
)

// fpState sunucu başına footprint motoru (tembel kurulum).
type fpState struct {
	once   sync.Once
	engine *footprint.Engine
	err    error
	mu     sync.Mutex // aynı anda tek doldurma: Binance ağırlık limiti + SQLite yazımı
}

const maxFootprintBars = 200

func (s *Server) footprintEngine() (*footprint.Engine, error) {
	st := &s.fp
	st.once.Do(func() {
		if s.Coord == nil || s.Coord.Store == nil {
			st.err = errUnavailable("footprint store")
			return
		}
		f, ok := s.Coord.Binance.(provider.AggTradeFetcher)
		if !ok {
			st.err = errUnavailable("aggTrades provider")
			return
		}
		db := s.Coord.Store.DB()
		if _, err := db.Exec(footprint.Schema); err != nil {
			st.err = err
			return
		}
		st.engine = &footprint.Engine{Fetch: f, Store: footprint.Store{DB: db}, PageBudget: 40}
	})
	return st.engine, st.err
}

type errUnavailable string

func (e errUnavailable) Error() string { return string(e) + " unavailable" }

// handleFootprint: GET /api/footprint?symbol=BTCUSDT&interval=1m&row=10&times=1731200000,1731200060
// Gerçek emir akışı (taker alış/satış) yalnız kripto; diğer piyasalar supported=false döner
// ve arayüz bar içi yaklaşık profili kullanır.
func (s *Server) handleFootprint(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	sym := strings.ToUpper(strings.TrimSpace(q.Get("symbol")))
	if sym == "" {
		writeJSONError(w, http.StatusBadRequest, "symbol required")
		return
	}
	if domain.ResolveSymbolInfo(sym).Market != domain.MarketCrypto {
		writeJSON(w, http.StatusOK, map[string]interface{}{"supported": false, "symbol": sym, "reason": "Bu piyasada ücretsiz işlem akışı yok; bar içi yaklaşık profil kullanılır."})
		return
	}
	tf := domain.NormalizeTimeframe(q.Get("interval"))
	step := domain.TimeframeSeconds(tf)
	row, err := strconv.ParseFloat(q.Get("row"), 64)
	if err != nil || row <= 0 || step <= 0 {
		writeJSONError(w, http.StatusBadRequest, "interval and positive row required")
		return
	}
	var times []int64
	for _, part := range strings.Split(q.Get("times"), ",") {
		if part = strings.TrimSpace(part); part == "" {
			continue
		}
		t, err := strconv.ParseInt(part, 10, 64)
		if err != nil || t <= 0 || t%step != 0 {
			writeJSONError(w, http.StatusBadRequest, "times must be bar open times")
			return
		}
		times = append(times, t)
	}
	if len(times) == 0 || len(times) > maxFootprintBars {
		writeJSONError(w, http.StatusBadRequest, "1-200 bar times required")
		return
	}
	eng, err := s.footprintEngine()
	if err != nil {
		writeJSONError(w, http.StatusNotImplemented, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	s.fp.mu.Lock()
	res, err := eng.Compute(ctx, sym, tf, step, row, times, time.Now().UnixMilli())
	s.fp.mu.Unlock()
	if err != nil && len(res.Bars) == 0 {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error(), "provider": "BINANCE"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"supported": true, "symbol": sym, "interval": tf, "row": row,
		"bars": res.Bars, "pending": res.Pending,
	})
}
