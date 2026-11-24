package api

import (
	"net/http"
	"strings"
	"sync"

	"github.com/ersincebi/titanview/backend/internal/domain"
	"github.com/ersincebi/titanview/backend/internal/provider"
)

const maxQuoteSymbols = 60

// GET /api/quotes?symbols=THYAO.IS,AAPL,BTCUSDT — live last price + day change per symbol.
// Symbols whose upstream fails are omitted (never faked); the client keeps its previous value.
func (s *Server) handleQuotes(w http.ResponseWriter, r *http.Request) {
	if s.Coord == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"quotes": []provider.Quote{}})
		return
	}
	seen := map[string]bool{}
	var syms []string
	for _, p := range strings.Split(r.URL.Query().Get("symbols"), ",") {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		sym := domain.ResolveSymbolInfo(p).Symbol
		if !seen[sym] && len(syms) < maxQuoteSymbols {
			seen[sym] = true
			syms = append(syms, sym)
		}
	}
	if len(syms) == 0 {
		writeJSONError(w, http.StatusBadRequest, "symbols required")
		return
	}
	res := make([]*provider.Quote, len(syms))
	var wg sync.WaitGroup
	sem := make(chan struct{}, overviewWorkers)
	for i, sym := range syms {
		if v, ok := s.quotes.get("q|" + sym); ok {
			q := v.(provider.Quote)
			res[i] = &q
			continue
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(i int, sym string) {
			defer wg.Done()
			defer func() { <-sem }()
			q, err := s.Coord.Quote(r.Context(), sym)
			if err != nil {
				return
			}
			s.quotes.set("q|"+sym, q)
			res[i] = &q
		}(i, sym)
	}
	wg.Wait()
	out := make([]provider.Quote, 0, len(res))
	for _, q := range res {
		if q != nil {
			out = append(out, *q)
		}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"quotes": out})
}
