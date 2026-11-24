package api

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
	"github.com/ersincebi/titanview/backend/internal/provider"
)

// GET /api/fundamentals?symbol=THYAO.IS
func (s *Server) handleFundamentals(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	rawSym := strings.TrimSpace(r.URL.Query().Get("symbol"))
	if rawSym == "" {
		writeJSONError(w, http.StatusBadRequest, "symbol query parameter required")
		return
	}
	info := domain.ResolveSymbolInfo(rawSym)
	if info.Market == domain.MarketCrypto || info.Market == domain.MarketForex || domain.IsSymbolExpression(rawSym) || info.Symbol == "XU100.IS" {
		writeJSON(w, http.StatusOK, provider.FundamentalsReport{
			Symbol:      info.Symbol,
			DisplayName: info.DisplayName,
			Market:      string(info.Market),
			Currency:    info.Currency,
			Supported:   false,
			Reason:      "Kripto varlıklar, döviz/emtia çiftleri, endeksler ve sentetik ifadeler için kurumsal finansal tablo (gelir tablosu / bilanço / nakit akışı) bulunmaz.",
			Annual:      []provider.FinancialPeriodRow{},
			Quarterly:   []provider.FinancialPeriodRow{},
		})
		return
	}

	cacheKey := "fundamentals|" + info.Symbol
	if cached, ok := s.cache.get(cacheKey); ok {
		writeJSON(w, http.StatusOK, cached)
		return
	}

	if s.Coord == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "provider unavailable")
		return
	}
	ff, ok := s.Coord.Yahoo.(provider.FundamentalsFetcher)
	if !ok {
		writeJSON(w, http.StatusOK, provider.FundamentalsReport{
			Symbol:      info.Symbol,
			DisplayName: info.DisplayName,
			Market:      string(info.Market),
			Currency:    info.Currency,
			Supported:   false,
			Reason:      "Finansal tablo sağlayıcısı bu ortamda aktif değil.",
			Annual:      []provider.FinancialPeriodRow{},
			Quarterly:   []provider.FinancialPeriodRow{},
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	rep, err := ff.FetchFundamentals(ctx, info.Symbol)
	if err != nil {
		if writeUnofficialDisabledError(w, err) {
			return
		}
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error(), "provider": "YAHOO"})
		return
	}
	if rep.Supported {
		s.cache.set(cacheKey, rep)
	}
	writeJSON(w, http.StatusOK, rep)
}

var calendarCatalogSymbols = []string{
	"THYAO.IS", "ASELS.IS", "GARAN.IS", "EREGL.IS", "KCHOL.IS", "TUPRS.IS", "FROTO.IS", "BIMAS.IS", "SISE.IS", "AKBNK.IS",
	"AAPL", "NVDA", "MSFT", "TSLA", "AMZN", "META", "GOOGL", "AMD",
}

// GET /api/calendar?country=ALL|TR|US|EU&market=ALL|BIST|US
func (s *Server) handleCalendar(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	q := r.URL.Query()
	countryFilter := strings.ToUpper(strings.TrimSpace(q.Get("country")))
	marketFilter := strings.ToUpper(strings.TrimSpace(q.Get("market")))

	now := time.Now()
	allEcon := provider.OfficialEconomicCalendar(now)
	econ := make([]provider.EconomicCalendarEvent, 0, len(allEcon))
	for _, ev := range allEcon {
		if countryFilter != "" && countryFilter != "ALL" && ev.Country != countryFilter {
			continue
		}
		econ = append(econ, ev)
	}

	earnings, dividends := s.collectEquityCalendars(r.Context(), now, marketFilter)

	resp := provider.CalendarResponse{
		Economic:   econ,
		Earnings:   earnings,
		Dividends:  dividends,
		IPONote:    "Halka arz (IPO) takvimi için ücretsiz, kimlik doğrulamasız canlı veri akışı bulunmamaktadır. Sahte şirket/tarih uydurmak yerine SPK Haftalık Bülten, KAP, Borsa İstanbul ve NASDAQ resmi halka arz duyuru kaynakları doğrudan aşağıda sunulmuştur.",
		IPOSources: provider.OfficialIPOSources(),
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) collectEquityCalendars(ctx context.Context, now time.Time, marketFilter string) ([]provider.EarningsCalendarItem, []provider.DividendCalendarItem) {
	cacheKey := "calendar_equities|" + marketFilter
	type cachedCal struct {
		earn []provider.EarningsCalendarItem
		div  []provider.DividendCalendarItem
	}
	if v, ok := s.cache.get(cacheKey); ok {
		cc := v.(cachedCal)
		return cc.earn, cc.div
	}

	if s.Coord == nil {
		return []provider.EarningsCalendarItem{}, []provider.DividendCalendarItem{}
	}
	evFetcher, hasEv := s.Coord.Yahoo.(provider.CorporateEventsFetcher)
	ffFetcher, hasFf := s.Coord.Yahoo.(provider.FundamentalsFetcher)
	if !hasEv && !hasFf {
		return []provider.EarningsCalendarItem{}, []provider.DividendCalendarItem{}
	}

	nowSec := now.Unix()
	fromSec := nowSec - 86400*365*2
	toSec := nowSec + 86400*180

	var mu sync.Mutex
	var earnings []provider.EarningsCalendarItem
	var dividends []provider.DividendCalendarItem

	var wg sync.WaitGroup
	sem := make(chan struct{}, 6)
	for _, sym := range calendarCatalogSymbols {
		info := domain.ResolveSymbolInfo(sym)
		if marketFilter != "" && marketFilter != "ALL" && string(info.Market) != marketFilter {
			continue
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(info domain.SymbolInfo) {
			defer wg.Done()
			defer func() { <-sem }()
			sctx, cancel := context.WithTimeout(ctx, 5*time.Second)
			defer cancel()

			seenEarnTs := map[int64]bool{}
			addEarn := func(e provider.EarningsEvent) {
				if e.Time <= 0 || seenEarnTs[e.Time] {
					return
				}
				seenEarnTs[e.Time] = true
				status := "REPORTED"
				if e.Time > nowSec || (e.Actual == nil && e.Estimate != nil) {
					status = "UPCOMING"
				}
				var surp *float64
				if e.Actual != nil && e.Estimate != nil && *e.Estimate != 0 {
					v := math.Round(((*e.Actual-*e.Estimate)/math.Abs(*e.Estimate))*10000) / 100
					surp = &v
				}
				mu.Lock()
				earnings = append(earnings, provider.EarningsCalendarItem{
					Symbol:      info.Symbol,
					DisplayName: info.DisplayName,
					Market:      string(info.Market),
					Currency:    info.Currency,
					Time:        e.Time,
					EpsEstimate: e.Estimate,
					EpsActual:   e.Actual,
					SurprisePct: surp,
					Status:      status,
				})
				mu.Unlock()
			}

			if hasEv {
				if ev, err := evFetcher.FetchCorporateEvents(sctx, info.Symbol, fromSec, toSec); err == nil && ev.Supported {
					// Keep latest 2 dividends per symbol so the calendar stays concise and relevant
					startIdx := 0
					if len(ev.Dividends) > 2 {
						startIdx = len(ev.Dividends) - 2
					}
					for _, d := range ev.Dividends[startIdx:] {
						mu.Lock()
						dividends = append(dividends, provider.DividendCalendarItem{
							Symbol:      info.Symbol,
							DisplayName: info.DisplayName,
							Market:      string(info.Market),
							Currency:    info.Currency,
							ExTime:      d.Time,
							Amount:      d.Amount,
						})
						mu.Unlock()
					}
					for _, e := range ev.Earnings {
						addEarn(e)
					}
				}
			}
			if hasFf && len(seenEarnTs) == 0 {
				if rep, err := ffFetcher.FetchFundamentals(sctx, info.Symbol); err == nil && len(rep.Earnings) > 0 {
					for _, e := range rep.Earnings {
						addEarn(e)
					}
				}
			}
		}(info)
	}
	wg.Wait()

	sort.Slice(earnings, func(i, j int) bool { return earnings[i].Time > earnings[j].Time })
	sort.Slice(dividends, func(i, j int) bool { return dividends[i].ExTime > dividends[j].ExTime })
	if earnings == nil {
		earnings = []provider.EarningsCalendarItem{}
	}
	if dividends == nil {
		dividends = []provider.DividendCalendarItem{}
	}
	if len(earnings) > 0 || len(dividends) > 0 {
		s.cache.set(cacheKey, cachedCal{earn: earnings, div: dividends})
	}
	return earnings, dividends
}

// GET /api/options?symbol=BTCUSDT&expiry=29JAN27
func (s *Server) handleOptions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	q := r.URL.Query()
	rawSym := strings.TrimSpace(q.Get("symbol"))
	if rawSym == "" {
		rawSym = "BTCUSDT"
	}
	expiry := strings.TrimSpace(q.Get("expiry"))

	underlying, ok := provider.ResolveDeribitUnderlying(rawSym)
	if !ok {
		info := domain.ResolveSymbolInfo(rawSym)
		reason := fmt.Sprintf("%s (%s) için ücretsiz opsiyon zinciri verisi bulunmamaktadır. Deribit Public API üzerinden BTC ve ETH kripto opsiyon zincirini inceleyebilirsiniz.", info.Symbol, info.Market)
		if info.Market == domain.MarketBIST {
			reason = "BIST VİOP opsiyon zinciri için ücretsiz açık veri kaynağı bulunmamaktadır (Borsa İstanbul VİOP gerçek zamanlı/gecikmeli opsiyon verisi lisanslı veri dağıtıcıları gerektirir). Kripto opsiyon zinciri (BTC / ETH) Deribit Public API üzerinden canlı sunulmaktadır."
		}
		writeJSON(w, http.StatusOK, provider.OptionChainResponse{
			Supported: false,
			Market:    string(info.Market),
			Symbol:    info.Symbol,
			Reason:    reason,
			Expiries:  []provider.OptionExpirySummary{},
			Rows:      []provider.OptionChainStrikeRow{},
		})
		return
	}

	cacheKey := fmt.Sprintf("options|%s|%s", underlying, strings.ToUpper(expiry))
	if cached, ok := s.quotes.get(cacheKey); ok {
		writeJSON(w, http.StatusOK, cached)
		return
	}

	deribit := s.Deribit
	if deribit == nil {
		deribit = provider.NewDeribitProvider(nil)
	}

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	chain, err := deribit.FetchOptionChain(ctx, underlying, expiry, time.Now())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error(), "provider": "DERIBIT"})
		return
	}
	s.quotes.set(cacheKey, chain)
	writeJSON(w, http.StatusOK, chain)
}
