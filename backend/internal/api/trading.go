package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ersincebi/titanview/backend/internal/trading"
)

// TradingService bundles the paper engine and the Binance client (Faz 28).
type TradingService struct {
	Paper   *trading.Engine
	Binance *trading.Binance
}

// coordPrices answers "last price" from the cache/provider (1m bars).
type coordPrices struct{ s *Server }

func (p coordPrices) LastPrice(ctx context.Context, symbol string) (float64, error) {
	cs, err := coordHistory{p.s}.Candles(ctx, symbol, "1m", 5)
	if err != nil {
		return 0, err
	}
	if len(cs) == 0 {
		return 0, trading.ErrNoPrice
	}
	return cs[len(cs)-1].Close, nil
}

// EnableTrading creates the paper engine (watching the live hub) and the Binance client.
// secretDir holds `.titan_secret` when TITAN_SECRET_KEY is unset.
func (s *Server) EnableTrading(secretDir string) (*trading.Engine, error) {
	st, err := trading.NewStore(s.Coord.Store.DB())
	if err != nil {
		return nil, err
	}
	var live trading.Live
	if s.Hub != nil {
		live = s.Hub
	}
	eng := trading.NewEngine(st, live, coordPrices{s})
	if err := eng.Load(context.Background()); err != nil {
		return nil, err
	}
	master, err := trading.LoadOrCreateMaster(secretDir)
	if err != nil {
		return nil, err
	}
	sealer, err := trading.NewSealer(master)
	if err != nil {
		return nil, err
	}
	s.Trading = &TradingService{Paper: eng, Binance: trading.NewBinance(st, sealer)}
	return eng, nil
}

func (s *Server) registerTrading(mux *http.ServeMux) {
	mux.HandleFunc("/api/trading/paper", s.handlePaper)
	mux.HandleFunc("/api/trading/paper/orders", s.handlePaperOrders)
	mux.HandleFunc("/api/trading/paper/close", s.handlePaperPosition("close"))
	mux.HandleFunc("/api/trading/paper/reverse", s.handlePaperPosition("reverse"))
	mux.HandleFunc("/api/trading/paper/reset", s.handlePaperReset)
	mux.HandleFunc("/api/trading/paper/fills", s.handlePaperFills)
	mux.HandleFunc("/api/trading/positions/brackets", s.handlePaperBrackets)
	mux.HandleFunc("/api/trading/stream", s.handleTradingStream)
	mux.HandleFunc("/api/trading/binance", s.handleBinanceKeys)
	mux.HandleFunc("/api/trading/binance/account", s.handleBinanceAccount)
	mux.HandleFunc("/api/trading/binance/orders", s.handleBinanceOrders)
	mux.HandleFunc("/api/trading/binance/preview", s.handleBinancePreview)
	mux.HandleFunc("/api/trading/binance/order", s.handleBinanceOrder)
}

func (s *Server) tradingReady(w http.ResponseWriter) bool {
	if s.Trading == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "trading engine disabled")
		return false
	}
	return true
}

func readJSONBody(w http.ResponseWriter, r *http.Request, v interface{}) bool {
	body, err := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "read body")
		return false
	}
	if err := json.Unmarshal(body, v); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid json")
		return false
	}
	return true
}

func tradingErr(w http.ResponseWriter, err error) {
	var api *trading.APIError
	switch {
	case errors.Is(err, trading.ErrNotFound):
		writeJSONError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, trading.ErrNotConfigured):
		writeJSONError(w, http.StatusPreconditionFailed, err.Error())
	case errors.As(err, &api):
		writeJSONError(w, http.StatusBadGateway, err.Error())
	case errors.Is(err, context.DeadlineExceeded):
		writeJSONError(w, http.StatusGatewayTimeout, err.Error())
	default:
		writeJSONError(w, http.StatusBadRequest, err.Error())
	}
}

// GET /api/trading/paper
func (s *Server) handlePaper(w http.ResponseWriter, r *http.Request) {
	if !s.tradingReady(w) {
		return
	}
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, http.StatusOK, s.Trading.Paper.Snapshot())
}

type orderResult struct {
	Order    trading.Order    `json:"order"`
	Events   []trading.Event  `json:"events"`
	Snapshot trading.Snapshot `json:"snapshot"`
}

// POST /api/trading/paper/orders | PUT ?id= | DELETE ?id=
func (s *Server) handlePaperOrders(w http.ResponseWriter, r *http.Request) {
	if !s.tradingReady(w) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	eng := s.Trading.Paper
	switch r.Method {
	case http.MethodPost:
		var req trading.OrderRequest
		if !readJSONBody(w, r, &req) {
			return
		}
		o, evs, err := eng.Place(ctx, req)
		if err != nil {
			tradingErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, orderResult{Order: o, Events: evs, Snapshot: eng.Snapshot()})
	case http.MethodPut:
		var p trading.OrderPatch
		if !readJSONBody(w, r, &p) {
			return
		}
		o, evs, err := eng.Modify(ctx, r.URL.Query().Get("id"), p)
		if err != nil {
			tradingErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, orderResult{Order: o, Events: evs, Snapshot: eng.Snapshot()})
	case http.MethodDelete:
		evs, err := eng.Cancel(ctx, r.URL.Query().Get("id"))
		if err != nil {
			tradingErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, orderResult{Events: evs, Snapshot: eng.Snapshot()})
	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// POST /api/trading/paper/close?symbol= and /reverse?symbol=
func (s *Server) handlePaperPosition(action string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.tradingReady(w) {
			return
		}
		if r.Method != http.MethodPost {
			writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		sym := r.URL.Query().Get("symbol")
		var evs []trading.Event
		var err error
		if action == "close" {
			evs, err = s.Trading.Paper.ClosePosition(ctx, sym)
		} else {
			evs, err = s.Trading.Paper.ReversePosition(ctx, sym)
		}
		if err != nil {
			tradingErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, orderResult{Events: evs, Snapshot: s.Trading.Paper.Snapshot()})
	}
}

// PUT /api/trading/positions/brackets  {symbol, takeProfit, stopLoss}  (negative removes, 0 keeps)
func (s *Server) handlePaperBrackets(w http.ResponseWriter, r *http.Request) {
	if !s.tradingReady(w) {
		return
	}
	if r.Method != http.MethodPut {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var body struct {
		Symbol     string  `json:"symbol"`
		TakeProfit float64 `json:"takeProfit"`
		StopLoss   float64 `json:"stopLoss"`
	}
	if !readJSONBody(w, r, &body) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	evs, err := s.Trading.Paper.SetBrackets(ctx, body.Symbol, body.TakeProfit, body.StopLoss)
	if err != nil {
		tradingErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, orderResult{Events: evs, Snapshot: s.Trading.Paper.Snapshot()})
}

// POST /api/trading/paper/reset  {initialBalance, commissionPct}
func (s *Server) handlePaperReset(w http.ResponseWriter, r *http.Request) {
	if !s.tradingReady(w) {
		return
	}
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var body struct {
		InitialBalance float64 `json:"initialBalance"`
		CommissionPct  float64 `json:"commissionPct"`
	}
	if !readJSONBody(w, r, &body) {
		return
	}
	if err := s.Trading.Paper.Reset(r.Context(), body.InitialBalance, body.CommissionPct); err != nil {
		tradingErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.Trading.Paper.Snapshot())
}

// GET /api/trading/paper/fills?limit=  (permanent fill log)
func (s *Server) handlePaperFills(w http.ResponseWriter, r *http.Request) {
	if !s.tradingReady(w) {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	fills, err := s.Trading.Paper.Store.FillLog(r.Context(), limit)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"fills": fills})
}

// GET /api/trading/stream  SSE: event "trading" = {events, snapshot}
func (s *Server) handleTradingStream(w http.ResponseWriter, r *http.Request) {
	if !s.tradingReady(w) {
		return
	}
	fl, ok := w.(http.Flusher)
	if !ok {
		writeJSONError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	ch, cancel := s.Trading.Paper.Subscribe()
	defer cancel()
	first, _ := json.Marshal(trading.Message{Events: []trading.Event{}, Snapshot: s.Trading.Paper.Snapshot()})
	_, _ = fmt.Fprintf(w, "retry: 3000\nevent: trading\ndata: %s\n\n", first)
	fl.Flush()
	ping := time.NewTicker(25 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ping.C:
			_, _ = fmt.Fprint(w, ": ping\n\n")
			fl.Flush()
		case m, open := <-ch:
			if !open {
				return
			}
			b, _ := json.Marshal(m)
			_, _ = fmt.Fprintf(w, "event: trading\ndata: %s\n\n", b)
			fl.Flush()
		}
	}
}

// GET status | PUT {apiKey, secret, testnet} | DELETE
func (s *Server) handleBinanceKeys(w http.ResponseWriter, r *http.Request) {
	if !s.tradingReady(w) {
		return
	}
	bn := s.Trading.Binance
	switch r.Method {
	case http.MethodGet:
	case http.MethodPut:
		var c trading.Credentials
		if !readJSONBody(w, r, &c) {
			return
		}
		if err := bn.SaveCredentials(r.Context(), c); err != nil {
			tradingErr(w, err)
			return
		}
	case http.MethodDelete:
		if err := bn.DeleteCredentials(r.Context()); err != nil {
			tradingErr(w, err)
			return
		}
	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	st, err := bn.Status(r.Context())
	if err != nil {
		tradingErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

// GET /api/trading/binance/account
func (s *Server) handleBinanceAccount(w http.ResponseWriter, r *http.Request) {
	if !s.tradingReady(w) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	bal, err := s.Trading.Binance.Account(ctx)
	if err != nil {
		tradingErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"balances": bal})
}

// GET /api/trading/binance/orders?symbol=
func (s *Server) handleBinanceOrders(w http.ResponseWriter, r *http.Request) {
	if !s.tradingReady(w) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	list, err := s.Trading.Binance.OpenOrders(ctx, r.URL.Query().Get("symbol"))
	if err != nil {
		tradingErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"orders": list})
}

// POST /api/trading/binance/preview  BinanceOrder -> Preview (validated by /order/test, nothing placed)
func (s *Server) handleBinancePreview(w http.ResponseWriter, r *http.Request) {
	if !s.tradingReady(w) {
		return
	}
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var o trading.BinanceOrder
	if !readJSONBody(w, r, &o) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	ref, _ := coordPrices{s}.LastPrice(ctx, strings.ToUpper(o.Symbol))
	p, err := s.Trading.Binance.PreviewOrder(ctx, o, ref)
	if err != nil {
		tradingErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// POST /api/trading/binance/order {token, confirm:true} | DELETE ?symbol=&orderId=
func (s *Server) handleBinanceOrder(w http.ResponseWriter, r *http.Request) {
	if !s.tradingReady(w) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	switch r.Method {
	case http.MethodPost:
		var body struct {
			Token   string `json:"token"`
			Confirm bool   `json:"confirm"`
		}
		if !readJSONBody(w, r, &body) {
			return
		}
		if !body.Confirm || body.Token == "" {
			writeJSONError(w, http.StatusBadRequest, "gerçek emir için önizleme belirteci ve confirm:true gerekli")
			return
		}
		res, err := s.Trading.Binance.ConfirmOrder(ctx, body.Token)
		if err != nil {
			tradingErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, res)
	case http.MethodDelete:
		id, _ := strconv.ParseInt(r.URL.Query().Get("orderId"), 10, 64)
		res, err := s.Trading.Binance.CancelOrder(ctx, r.URL.Query().Get("symbol"), id)
		if err != nil {
			tradingErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, res)
	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
