package api

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
	"github.com/ersincebi/titanview/backend/internal/provider"
	"github.com/ersincebi/titanview/backend/internal/sources"
)

// FxRatePoint is one historical daily FX conversion rate from Yahoo Finance.
type FxRatePoint struct {
	Time int64   `json:"time"`
	Rate float64 `json:"rate"`
}

// FxRatesResponse returns daily FX rates for request.currency_rate(from, to).
type FxRatesResponse struct {
	From      string        `json:"from"`
	To        string        `json:"to"`
	Pair      string        `json:"pair"`
	Supported bool          `json:"supported"`
	Reason    string        `json:"reason,omitempty"`
	Rates     []FxRatePoint `json:"rates"`
}

// GET /api/events?symbol=AAPL&from=...&to=...
// Returns real Yahoo dividends, splits, and earnings for stocks; returns supported=false for crypto/forex.
func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	q := r.URL.Query()
	rawSym := strings.TrimSpace(q.Get("symbol"))
	if rawSym == "" {
		writeJSONError(w, http.StatusBadRequest, "symbol query parameter required")
		return
	}
	info := domain.ResolveSymbolInfo(rawSym)
	if info.Provider != domain.ProviderYahoo || info.Market == domain.MarketForex || domain.IsSymbolExpression(rawSym) {
		writeJSON(w, http.StatusOK, provider.CorporateEvents{
			Symbol:    info.Symbol,
			Supported: false,
			Reason:    "Kripto, döviz ve sentetik ifade enstrümanları için temettü/bölünme/bilanço verisi bulunmaz.",
			Dividends: []provider.DividendEvent{},
			Splits:    []provider.SplitEvent{},
			Earnings:  []provider.EarningsEvent{},
		})
		return
	}

	nowSec := time.Now().Unix()
	fromSec, _ := strconv.ParseInt(q.Get("from"), 10, 64)
	toSec, _ := strconv.ParseInt(q.Get("to"), 10, 64)
	if toSec <= 0 {
		toSec = nowSec
	}
	if fromSec <= 0 || fromSec >= toSec {
		fromSec = toSec - 86400*365*5
	}

	cacheKey := fmt.Sprintf("events|%s|%d|%d", info.Symbol, fromSec/86400, toSec/86400)
	if cached, ok := s.cache.get(cacheKey); ok {
		writeJSON(w, http.StatusOK, cached)
		return
	}

	if s.Coord == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "provider unavailable")
		return
	}
	fetcher, ok := s.Coord.Yahoo.(provider.CorporateEventsFetcher)
	if !ok {
		writeJSON(w, http.StatusOK, provider.CorporateEvents{
			Symbol:    info.Symbol,
			Supported: false,
			Reason:    "Bu sağlayıcı kurumsal etkinlik verisi desteklemiyor.",
			Dividends: []provider.DividendEvent{},
			Splits:    []provider.SplitEvent{},
			Earnings:  []provider.EarningsEvent{},
		})
		return
	}

	ev, err := fetcher.FetchCorporateEvents(r.Context(), info.Symbol, fromSec, toSec)
	if err != nil {
		if writeUnofficialDisabledError(w, err) {
			return
		}
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error(), "provider": "YAHOO"})
		return
	}
	// Enrich earnings from quoteSummary when v8 chart events omitted earnings history.
	if len(ev.Earnings) == 0 {
		if ff, ok := s.Coord.Yahoo.(provider.FundamentalsFetcher); ok {
			if rep, ferr := ff.FetchFundamentals(r.Context(), info.Symbol); ferr == nil && len(rep.Earnings) > 0 {
				ev.Earnings = rep.Earnings
			}
		}
	}
	s.cache.set(cacheKey, ev)
	writeJSON(w, http.StatusOK, ev)
}

// GET /api/fx?from=EUR&to=USD&fromTs=...&toTs=...
// Fetches real daily FX conversion rates from Yahoo Finance (e.g. EURUSD=X or inverted USDEUR=X).
func (s *Server) handleFx(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	q := r.URL.Query()
	fromCur := strings.ToUpper(strings.TrimSpace(q.Get("from")))
	toCur := strings.ToUpper(strings.TrimSpace(q.Get("to")))
	if len(fromCur) < 2 || len(toCur) < 2 {
		writeJSONError(w, http.StatusBadRequest, "from and to currency codes are required")
		return
	}

	nowSec := time.Now().Unix()
	fromTs, _ := strconv.ParseInt(q.Get("fromTs"), 10, 64)
	toTs, _ := strconv.ParseInt(q.Get("toTs"), 10, 64)
	if toTs <= 0 {
		toTs = nowSec
	}
	if fromTs <= 0 || fromTs >= toTs {
		fromTs = toTs - 86400*365*2
	}

	if fromCur == toCur {
		writeJSON(w, http.StatusOK, FxRatesResponse{
			From:      fromCur,
			To:        toCur,
			Pair:      fromCur + "/" + toCur,
			Supported: true,
			Rates:     []FxRatePoint{{Time: fromTs, Rate: 1.0}},
		})
		return
	}

	cacheKey := fmt.Sprintf("fx|%s|%s|%d|%d", fromCur, toCur, fromTs/86400, toTs/86400)
	if cached, ok := s.cache.get(cacheKey); ok {
		writeJSON(w, http.StatusOK, cached)
		return
	}

	if s.Coord == nil {
		writeJSON(w, http.StatusOK, FxRatesResponse{
			From: fromCur, To: toCur, Pair: fromCur + "/" + toCur,
			Supported: false, Reason: "Kur sağlayıcısı hazır değil.", Rates: []FxRatePoint{},
		})
		return
	}

	var unofficialDisabled bool
	directSym := fromCur + toCur + "=X"
	if res, err := s.Coord.GetHistory(r.Context(), directSym, "1d", fromTs, toTs); err == nil && res != nil && len(res.Candles) > 0 {
		pts := make([]FxRatePoint, 0, len(res.Candles))
		for _, c := range res.Candles {
			if c.Close > 0 {
				pts = append(pts, FxRatePoint{Time: c.Timestamp, Rate: c.Close})
			}
		}
		if len(pts) > 0 {
			out := FxRatesResponse{From: fromCur, To: toCur, Pair: directSym, Supported: true, Rates: pts}
			s.cache.set(cacheKey, out)
			writeJSON(w, http.StatusOK, out)
			return
		}
	} else if errors.Is(err, sources.ErrUnofficialDisabled) {
		unofficialDisabled = true
	}

	invSym := toCur + fromCur + "=X"
	if !unofficialDisabled {
		if res, err := s.Coord.GetHistory(r.Context(), invSym, "1d", fromTs, toTs); err == nil && res != nil && len(res.Candles) > 0 {
			pts := make([]FxRatePoint, 0, len(res.Candles))
			for _, c := range res.Candles {
				if c.Close > 0 {
					pts = append(pts, FxRatePoint{Time: c.Timestamp, Rate: 1.0 / c.Close})
				}
			}
			if len(pts) > 0 {
				out := FxRatesResponse{From: fromCur, To: toCur, Pair: "1/" + invSym, Supported: true, Rates: pts}
				s.cache.set(cacheKey, out)
				writeJSON(w, http.StatusOK, out)
				return
			}
		} else if errors.Is(err, sources.ErrUnofficialDisabled) {
			unofficialDisabled = true
		}
	}

	reason := fmt.Sprintf("%s/%s paritesi için kur verisi bulunamadı.", fromCur, toCur)
	if unofficialDisabled {
		reason = sources.ErrUnofficialDisabled.Error()
	}
	writeJSON(w, http.StatusOK, FxRatesResponse{
		From:      fromCur,
		To:        toCur,
		Pair:      fromCur + "/" + toCur,
		Supported: false,
		Reason:    reason,
		Rates:     []FxRatePoint{},
	})
}
