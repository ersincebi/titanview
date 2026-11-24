package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
	"github.com/ersincebi/titanview/backend/internal/normalizer"
	"github.com/ersincebi/titanview/backend/internal/provider"
	"github.com/ersincebi/titanview/backend/internal/sources"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// StreamTarget identifies one (symbol, interval) stream for multi-chart subscriptions.
type StreamTarget struct {
	Symbol   string `json:"symbol"`
	Interval string `json:"interval"`
}

// ClientSubscriptionRequest is sent by the browser over /ws/live.
type ClientSubscriptionRequest struct {
	Action   string         `json:"action"`   // "subscribe" | "set_subscriptions" | "unsubscribe" | "ping"
	Symbol   string         `json:"symbol"`   // e.g. "BTCUSDT", "THYAO.IS", "AAPL"
	Interval string         `json:"interval"` // e.g. "1m", "15m", "4h", "1d"
	Streams  []StreamTarget `json:"streams,omitempty"`
}

const maxClientStreams = 20

type wsClient struct {
	conn *websocket.Conn
	send chan []byte
	subs map[string]struct{}
}

type streamWorker struct {
	cancel context.CancelFunc
}

// LiveHub manages all connected WebSocket clients and per-(symbol,interval) upstream stream workers.
type LiveHub struct {
	coord          *provider.CacheCoordinator
	yahooPollEvery time.Duration

	mu      sync.RWMutex
	clients map[*wsClient]struct{}
	subs    map[string]map[*wsClient]struct{}
	workers map[string]*streamWorker
	// watchers are in-process listeners (the alert engine): they keep a stream alive with no browser open.
	watchers map[string]map[int]func(domain.LiveCandleMessage)
	nextW    int
}

// NewLiveHub creates a new WebSocket hub for /ws/live.
func NewLiveHub(coord *provider.CacheCoordinator, yahooPollEvery time.Duration) *LiveHub {
	if yahooPollEvery <= 0 {
		yahooPollEvery = 15 * time.Second
	}
	return &LiveHub{
		coord:          coord,
		yahooPollEvery: yahooPollEvery,
		clients:        make(map[*wsClient]struct{}),
		subs:           make(map[string]map[*wsClient]struct{}),
		workers:        make(map[string]*streamWorker),
		watchers:       make(map[string]map[int]func(domain.LiveCandleMessage)),
	}
}

// Watch registers an in-process listener for symbol/interval candles and starts the upstream worker if
// needed. The returned cancel stops listening (and the worker once nobody else needs it).
func (h *LiveHub) Watch(rawSymbol, rawInterval string, fn func(domain.LiveCandleMessage)) func() {
	sym := domain.NormalizeSymbol(rawSymbol)
	tf := domain.NormalizeTimeframe(rawInterval)
	key := streamKey(sym, tf)
	h.mu.Lock()
	h.nextW++
	id := h.nextW
	if h.watchers[key] == nil {
		h.watchers[key] = make(map[int]func(domain.LiveCandleMessage))
	}
	h.watchers[key][id] = fn
	h.ensureWorkerLocked(key, sym, tf)
	h.mu.Unlock()
	var once sync.Once
	return func() {
		once.Do(func() {
			h.mu.Lock()
			defer h.mu.Unlock()
			delete(h.watchers[key], id)
			if len(h.watchers[key]) == 0 {
				delete(h.watchers, key)
			}
			h.stopIfIdleLocked(key)
		})
	}
}

// WatcherCount reports in-process listeners for symbol/interval.
func (h *LiveHub) WatcherCount(symbol, interval string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.watchers[streamKey(symbol, interval)])
}

func (h *LiveHub) ensureWorkerLocked(key, sym, tf string) {
	if _, running := h.workers[key]; running {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	h.workers[key] = &streamWorker{cancel: cancel}
	go h.runStreamWorker(ctx, sym, tf, key)
}

func (h *LiveHub) stopIfIdleLocked(key string) {
	if len(h.subs[key]) > 0 || len(h.watchers[key]) > 0 {
		return
	}
	if w, exists := h.workers[key]; exists {
		w.cancel()
		delete(h.workers, key)
	}
}

// HandleWS upgrades HTTP requests on /ws/live and manages client lifecycle.
func (h *LiveHub) HandleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	client := &wsClient{
		conn: conn,
		send: make(chan []byte, 128),
		subs: make(map[string]struct{}),
	}

	h.mu.Lock()
	h.clients[client] = struct{}{}
	h.mu.Unlock()

	// Optional initial query params: /ws/live?symbol=BTCUSDT&interval=15m
	initSym := r.URL.Query().Get("symbol")
	initTf := r.URL.Query().Get("interval")
	if initSym != "" {
		if initTf == "" {
			initTf = "15m"
		}
		h.subscribeClient(client, initSym, initTf)
	}

	go h.writePump(client)
	h.readPump(client)
}

func (h *LiveHub) readPump(c *wsClient) {
	defer func() {
		h.removeClient(c)
		_ = c.conn.Close()
	}()

	_ = c.conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		return nil
	})

	for {
		_, msgBytes, err := c.conn.ReadMessage()
		if err != nil {
			break
		}
		_ = c.conn.SetReadDeadline(time.Now().Add(90 * time.Second))

		var req ClientSubscriptionRequest
		if err := json.Unmarshal(msgBytes, &req); err != nil {
			continue
		}

		switch strings.ToLower(req.Action) {
		case "subscribe":
			if req.Symbol != "" {
				h.subscribeClient(c, req.Symbol, req.Interval)
			}
		case "set_subscriptions":
			h.setClientSubscriptions(c, req.Streams)
		case "unsubscribe":
			h.unsubscribeClient(c)
		case "ping":
			pong, _ := json.Marshal(map[string]string{"type": "pong"})
			select {
			case c.send <- pong:
			default:
			}
		}
	}
}

func (h *LiveHub) writePump(c *wsClient) {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func streamKey(symbol, interval string) string {
	return fmt.Sprintf("%s:%s", domain.NormalizeSymbol(symbol), domain.NormalizeTimeframe(interval))
}

func (h *LiveHub) subscribeClient(c *wsClient, rawSymbol, rawInterval string) {
	h.setClientSubscriptions(c, []StreamTarget{{Symbol: rawSymbol, Interval: rawInterval}})
}

func (h *LiveHub) setClientSubscriptions(c *wsClient, streams []StreamTarget) {
	desired := make(map[string][2]string, len(streams))
	for _, st := range streams {
		sym := domain.NormalizeSymbol(st.Symbol)
		if sym == "" {
			continue
		}
		tf := domain.NormalizeTimeframe(st.Interval)
		key := streamKey(sym, tf)
		if _, exists := desired[key]; exists {
			continue
		}
		if len(desired) >= maxClientStreams {
			break
		}
		desired[key] = [2]string{sym, tf}
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	for oldKey := range c.subs {
		if _, keep := desired[oldKey]; !keep {
			h.removeSubLocked(c, oldKey)
			delete(c.subs, oldKey)
		}
	}
	for key, pair := range desired {
		if _, already := c.subs[key]; already {
			continue
		}
		c.subs[key] = struct{}{}
		if h.subs[key] == nil {
			h.subs[key] = make(map[*wsClient]struct{})
		}
		h.subs[key][c] = struct{}{}
		h.ensureWorkerLocked(key, pair[0], pair[1])
	}
}

func (h *LiveHub) unsubscribeClient(c *wsClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for key := range c.subs {
		h.removeSubLocked(c, key)
		delete(c.subs, key)
	}
}

func (h *LiveHub) removeClient(c *wsClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.clients[c]; !ok {
		return
	}
	for key := range c.subs {
		h.removeSubLocked(c, key)
		delete(c.subs, key)
	}
	delete(h.clients, c)
	close(c.send)
}

func (h *LiveHub) removeSubLocked(c *wsClient, key string) {
	group, ok := h.subs[key]
	if !ok {
		return
	}
	delete(group, c)
	if len(group) == 0 {
		delete(h.subs, key)
	}
	h.stopIfIdleLocked(key)
}

// ActiveWorkersCount returns the number of active upstream stream workers.
func (h *LiveHub) ActiveWorkersCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.workers)
}

// ClientCount returns the number of active connected clients.
func (h *LiveHub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// SubscribersCount returns the number of clients subscribed to a specific symbol & interval.
func (h *LiveHub) SubscribersCount(symbol, interval string) int {
	key := streamKey(symbol, interval)
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.subs[key])
}

// SubscribedSymbols returns a list of unique stream keys currently being actively tracked.
func (h *LiveHub) SubscribedSymbols() []string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	keys := make([]string, 0, len(h.workers))
	for k := range h.workers {
		keys = append(keys, k)
	}
	return keys
}

// BroadcastCandle sends a LiveCandleMessage to all clients subscribed to symbol:interval.
func (h *LiveHub) BroadcastCandle(msg domain.LiveCandleMessage) {
	key := streamKey(msg.Symbol, msg.Interval)
	payload, err := json.Marshal(msg)
	if err != nil {
		return
	}

	h.mu.RLock()
	group := h.subs[key]
	for client := range group {
		select {
		case client.send <- payload:
		default:
		}
	}
	fns := make([]func(domain.LiveCandleMessage), 0, len(h.watchers[key]))
	for _, fn := range h.watchers[key] {
		fns = append(fns, fn)
	}
	h.mu.RUnlock()
	for _, fn := range fns {
		fn(msg)
	}
}

// BroadcastStatus tells subscribers the upstream feed state (e.g. "reconnecting").
func (h *LiveHub) BroadcastStatus(symbol, interval, state string) {
	payload, err := json.Marshal(map[string]string{
		"type": "status", "symbol": symbol, "interval": interval, "state": state,
	})
	if err != nil {
		return
	}
	h.mu.RLock()
	for client := range h.subs[streamKey(symbol, interval)] {
		select {
		case client.send <- payload:
		default:
		}
	}
	h.mu.RUnlock()
}

func (h *LiveHub) runStreamWorker(ctx context.Context, symbol, interval, key string) {
	if expr, err := domain.ParseSymbolExpr(symbol); err == nil && expr != nil && expr.IsComplex {
		h.runExpressionWorker(ctx, expr, domain.ResolveSymbolInfo(symbol), interval)
		return
	}
	info := domain.ResolveSymbolInfo(symbol)
	if info.Provider == domain.ProviderBinance {
		h.runBinanceWorker(ctx, info, interval)
	} else {
		h.runYahooPollingWorker(ctx, info, interval)
	}
}

func (h *LiveHub) runExpressionWorker(ctx context.Context, expr *domain.SymbolExpr, info domain.SymbolInfo, interval string) {
	legs := expr.Symbols()
	var mu sync.Mutex
	latest := make(map[string]domain.Candle, len(legs))

	// Seed latest known candle for each leg if coordinator is available.
	if h.coord != nil && h.coord.Store != nil {
		for _, leg := range legs {
			if cs, err := h.coord.Store.GetLatestCandles(ctx, leg, interval, 1); err == nil && len(cs) > 0 {
				latest[leg] = cs[len(cs)-1]
			}
		}
	}

	cancels := make([]func(), 0, len(legs))
	defer func() {
		for _, cancel := range cancels {
			cancel()
		}
	}()

	for _, leg := range legs {
		legSym := leg
		cancel := h.Watch(legSym, interval, func(msg domain.LiveCandleMessage) {
			mu.Lock()
			latest[legSym] = msg.Candle
			if len(latest) < len(legs) {
				mu.Unlock()
				return
			}
			series := make(map[string][]domain.Candle, len(legs))
			primaryTs := latest[legs[0]].Timestamp
			for _, l := range legs {
				c := latest[l]
				c.Timestamp = primaryTs
				series[l] = []domain.Candle{c}
			}
			merged := domain.MergeExpressionCandles(expr, series, interval)
			mu.Unlock()
			if len(merged) > 0 {
				h.BroadcastCandle(domain.LiveCandleMessage{
					Type:         "candle_update",
					Symbol:       info.Symbol,
					Interval:     interval,
					Provider:     info.Provider,
					DelayMinutes: info.DelayMinutes,
					IsClosed:     msg.IsClosed,
					Candle:       merged[len(merged)-1],
				})
			}
		})
		cancels = append(cancels, cancel)
	}
	<-ctx.Done()
}

// liveResampler folds incoming native base-interval Binance WS klines into a custom target timeframe bucket.
type liveResampler struct {
	symbol    string
	targetTf  string
	bucket    int64
	hasBucket bool
	open      float64
	high      float64
	low       float64
	close     float64
	// baseVol tracks per-sub-bar latest volume inside the current bucket so mid-bar updates never double-count.
	baseVol map[int64]float64
}

func newLiveResampler(symbol, targetTf string) *liveResampler {
	return &liveResampler{symbol: symbol, targetTf: targetTf, baseVol: make(map[int64]float64)}
}

// Feed updates the current target-interval candle with a native base candle; when a new bucket starts,
// closedPrev is returned so callers can broadcast the finalized prior candle.
func (r *liveResampler) Feed(c domain.Candle) (current domain.Candle, closedPrev *domain.Candle) {
	b := normalizer.BucketStart(c.Timestamp, r.targetTf)
	if !r.hasBucket {
		r.hasBucket = true
		r.bucket = b
		r.open, r.high, r.low, r.close = c.Open, c.High, c.Low, c.Close
		r.baseVol[c.Timestamp] = c.Volume
	} else if b > r.bucket {
		prev := r.snapshot()
		closedPrev = &prev
		r.bucket = b
		r.open, r.high, r.low, r.close = c.Open, c.High, c.Low, c.Close
		r.baseVol = map[int64]float64{c.Timestamp: c.Volume}
	} else if b == r.bucket {
		if c.High > r.high {
			r.high = c.High
		}
		if c.Low < r.low {
			r.low = c.Low
		}
		r.close = c.Close
		r.baseVol[c.Timestamp] = c.Volume
	}
	return r.snapshot(), closedPrev
}

func (r *liveResampler) snapshot() domain.Candle {
	vol := 0.0
	for _, v := range r.baseVol {
		vol += v
	}
	return domain.Candle{
		Symbol:    r.symbol,
		Timeframe: r.targetTf,
		Timestamp: r.bucket,
		Open:      r.open,
		High:      r.high,
		Low:       r.low,
		Close:     r.close,
		Volume:    vol,
	}
}

func (h *LiveHub) runBinanceWorker(ctx context.Context, info domain.SymbolInfo, interval string) {
	baseTf, needResample := provider.BinanceBaseInterval(interval)
	wsEndpoints := []string{
		fmt.Sprintf("wss://data-stream.binance.vision/ws/%s@kline_%s", strings.ToLower(info.Symbol), baseTf),
		fmt.Sprintf("wss://stream.binance.com:9443/ws/%s@kline_%s", strings.ToLower(info.Symbol), baseTf),
	}

	var resampler *liveResampler
	if needResample {
		resampler = newLiveResampler(info.Symbol, interval)
	}

	dialer := websocket.Dialer{HandshakeTimeout: 5 * time.Second}
	idx := 0

	emit := func(c domain.Candle, closed bool) {
		if h.coord != nil && h.coord.Store != nil {
			_ = h.coord.Store.BatchUpsertCandles(ctx, []domain.Candle{c})
		}
		h.BroadcastCandle(domain.LiveCandleMessage{
			Type:         "candle_update",
			Symbol:       info.Symbol,
			Interval:     interval,
			Provider:     info.Provider,
			DelayMinutes: info.DelayMinutes,
			IsClosed:     closed,
			Candle:       c,
		})
	}

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		wsURL := wsEndpoints[idx%len(wsEndpoints)]
		idx++

		conn, _, err := dialer.DialContext(ctx, wsURL, nil)
		if err != nil {
			// Upstream unreachable: never fabricate ticks. Tell clients and retry.
			h.BroadcastStatus(info.Symbol, interval, "reconnecting")
			select {
			case <-ctx.Done():
				return
			case <-time.After(2 * time.Second):
			}
			continue
		}

		readErr := false
		for !readErr {
			select {
			case <-ctx.Done():
				_ = conn.Close()
				return
			default:
			}

			_ = conn.SetReadDeadline(time.Now().Add(20 * time.Second))
			_, rawMsg, err := conn.ReadMessage()
			if err != nil {
				readErr = true
				break
			}

			candle, isClosed, normErr := normalizer.NormalizeBinanceWSKline(rawMsg)
			if normErr != nil {
				continue
			}

			if resampler != nil {
				cur, prev := resampler.Feed(candle)
				if prev != nil {
					emit(*prev, true)
				}
				emit(cur, false)
			} else {
				emit(candle, isClosed)
			}
		}
		_ = conn.Close()
	}
}

func (h *LiveHub) runYahooPollingWorker(ctx context.Context, info domain.SymbolInfo, interval string) {
	if _, unit, ok := domain.ParseTimeframe(interval); ok && unit == "s" {
		// Yahoo Finance does not provide sub-minute data; do not poll.
		return
	}
	// Poll immediately on subscribe, then every yahooPollEvery (15-30s).
	pollTicker := time.NewTicker(h.yahooPollEvery)
	defer pollTicker.Stop()

	h.pollYahooOnce(ctx, info, interval)

	for {
		select {
		case <-ctx.Done():
			return
		case <-pollTicker.C:
			h.pollYahooOnce(ctx, info, interval)
		}
	}
}

func (h *LiveHub) pollYahooOnce(ctx context.Context, info domain.SymbolInfo, interval string) {
	if h.coord == nil || h.coord.Yahoo == nil {
		return
	}
	// Skip silently while unofficial data sources are disabled so the ticker does not churn.
	if yp, ok := h.coord.Yahoo.(*provider.YahooProvider); ok && !sources.Enabled() && len(yp.BaseURLs) > 0 {
		allUnofficial := true
		for _, raw := range yp.BaseURLs {
			u, err := url.Parse(raw)
			if err != nil || !sources.IsUnofficialHost(u.Hostname()) {
				allUnofficial = false
				break
			}
		}
		if allUnofficial {
			return
		}
	}
	var latest domain.Candle
	if lq, ok := h.coord.Yahoo.(interface {
		FetchLatestQuote(ctx context.Context, symbol, timeframe string) (*domain.Candle, error)
	}); ok {
		// Lightweight range=1d poll; history gaps are healed by the coordinator's live-edge refresh.
		c, err := lq.FetchLatestQuote(ctx, info.Symbol, interval)
		if err != nil || c == nil {
			return
		}
		latest = *c
		if h.coord.Store != nil {
			_ = h.coord.Store.BatchUpsertCandles(ctx, []domain.Candle{latest})
		}
	} else {
		now := time.Now().Unix()
		lookback := domain.TimeframeSeconds(interval) * 20
		if lookback < 86400*3 {
			lookback = 86400 * 3
		}
		candles, err := h.coord.Yahoo.FetchHistory(ctx, info.Symbol, interval, now-lookback, now)
		if err != nil || len(candles) == 0 {
			return
		}
		latest = candles[len(candles)-1]
		if h.coord.Store != nil {
			// Persist the last two bars so a bar that rolled over between polls keeps its final values.
			tail := candles
			if len(tail) > 2 {
				tail = tail[len(tail)-2:]
			}
			_ = h.coord.Store.BatchUpsertCandles(ctx, tail)
		}
	}
	h.BroadcastCandle(domain.LiveCandleMessage{
		Type:         "candle_update",
		Symbol:       info.Symbol,
		Interval:     interval,
		Provider:     info.Provider,
		DelayMinutes: info.DelayMinutes,
		IsClosed:     false,
		Candle:       latest,
	})
}
