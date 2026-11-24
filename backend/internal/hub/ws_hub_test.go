package hub

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
	"github.com/ersincebi/titanview/backend/internal/provider"
	"github.com/ersincebi/titanview/backend/internal/storage"
	"github.com/gorilla/websocket"
)

func TestLiveHubSubscriptionAndBroadcast(t *testing.T) {
	store, err := storage.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatalf("failed to open sqlite: %v", err)
	}
	defer store.Close()

	_ = store.BatchUpsertCandles(context.Background(), []domain.Candle{
		{Symbol: "THYAO.IS", Timeframe: "15m", Timestamp: 1731283200, Open: 290, High: 295, Low: 289, Close: 293, Volume: 100000},
	})

	coord := provider.NewCacheCoordinator(store, nil, nil)
	liveHub := NewLiveHub(coord, 50*time.Millisecond)

	srv := httptest.NewServer(http.HandlerFunc(liveHub.HandleWS))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "?symbol=THYAO.IS&interval=15m"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to dial ws: %v", err)
	}
	defer conn.Close()

	// Trigger a broadcast and verify reception
	liveHub.BroadcastCandle(domain.LiveCandleMessage{
		Type:         "candle_update",
		Symbol:       "THYAO.IS",
		Interval:     "15m",
		Provider:     domain.ProviderYahoo,
		DelayMinutes: 15,
		IsClosed:     false,
		Candle: domain.Candle{
			Symbol:    "THYAO.IS",
			Timeframe: "15m",
			Timestamp: 1731283200,
			Open:      290,
			High:      296,
			Low:       289,
			Close:     295.5,
			Volume:    125000,
		},
	})

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, raw, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("failed to read broadcast message: %v", err)
	}

	var received domain.LiveCandleMessage
	if err := json.Unmarshal(raw, &received); err != nil {
		t.Fatalf("failed to unmarshal live message: %v", err)
	}
	if received.Symbol != "THYAO.IS" || received.Candle.Close <= 0 {
		t.Fatalf("unexpected live candle message: %+v", received)
	}
}

func TestLiveHubClientJSONSubscriptionLifecycleAndZeroIdleWorkers(t *testing.T) {
	store, err := storage.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatalf("failed to open sqlite: %v", err)
	}
	defer store.Close()

	coord := provider.NewCacheCoordinator(store, nil, nil)
	liveHub := NewLiveHub(coord, 100*time.Millisecond)

	srv := httptest.NewServer(http.HandlerFunc(liveHub.HandleWS))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to dial ws: %v", err)
	}
	defer conn.Close()

	// Initially connected, but no subscriptions yet
	time.Sleep(20 * time.Millisecond)
	if liveHub.ClientCount() != 1 {
		t.Fatalf("expected 1 connected client, got %d", liveHub.ClientCount())
	}
	if liveHub.ActiveWorkersCount() != 0 {
		t.Fatalf("expected 0 active workers before subscription, got %d", liveHub.ActiveWorkersCount())
	}

	// 1. Send JSON subscribe request for BTCUSDT
	subMsg, _ := json.Marshal(ClientSubscriptionRequest{
		Action:   "subscribe",
		Symbol:   "BTCUSDT",
		Interval: "15m",
	})
	if err := conn.WriteMessage(websocket.TextMessage, subMsg); err != nil {
		t.Fatalf("failed to send subscribe msg: %v", err)
	}

	// Wait briefly for worker to register
	waitForCondition(t, 500*time.Millisecond, func() bool {
		return liveHub.ActiveWorkersCount() == 1 && liveHub.SubscribersCount("BTCUSDT", "15m") == 1
	}, "worker should be active after subscribe")

	// Verify broadcast delivery to client
	liveHub.BroadcastCandle(domain.LiveCandleMessage{
		Type:         "candle_update",
		Symbol:       "BTCUSDT",
		Interval:     "15m",
		Provider:     domain.ProviderBinance,
		DelayMinutes: 0,
		IsClosed:     false,
		Candle: domain.Candle{
			Symbol:    "BTCUSDT",
			Timeframe: "15m",
			Timestamp: 1730000000,
			Open:      65000,
			High:      65100,
			Low:       64950,
			Close:     65050,
			Volume:    10.5,
		},
	})

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, raw, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("failed to read live candle broadcast: %v", err)
	}
	var candleMsg domain.LiveCandleMessage
	if err := json.Unmarshal(raw, &candleMsg); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}
	if candleMsg.Symbol != "BTCUSDT" || candleMsg.Candle.Close != 65050 {
		t.Fatalf("unexpected message: %+v", candleMsg)
	}

	// 2. Test ping / pong
	pingMsg, _ := json.Marshal(ClientSubscriptionRequest{Action: "ping"})
	if err := conn.WriteMessage(websocket.TextMessage, pingMsg); err != nil {
		t.Fatalf("failed to send ping: %v", err)
	}
	_, pongRaw, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("failed to read pong: %v", err)
	}
	var pongMap map[string]string
	_ = json.Unmarshal(pongRaw, &pongMap)
	if pongMap["type"] != "pong" {
		t.Fatalf("expected pong response, got %+v", pongMap)
	}

	// 3. Unsubscribe -> Zero idle resource consumption verification!
	unsubMsg, _ := json.Marshal(ClientSubscriptionRequest{Action: "unsubscribe"})
	if err := conn.WriteMessage(websocket.TextMessage, unsubMsg); err != nil {
		t.Fatalf("failed to send unsubscribe: %v", err)
	}

	waitForCondition(t, 500*time.Millisecond, func() bool {
		return liveHub.ActiveWorkersCount() == 0 && liveHub.SubscribersCount("BTCUSDT", "15m") == 0
	}, "active workers should be 0 after unsubscribe (zero idle resource consumption)")

	// 4. Subscribe to another symbol, then close connection to verify cleanup
	subYahoo, _ := json.Marshal(ClientSubscriptionRequest{
		Action:   "subscribe",
		Symbol:   "THYAO.IS",
		Interval: "15m",
	})
	if err := conn.WriteMessage(websocket.TextMessage, subYahoo); err != nil {
		t.Fatalf("failed to send subscribe to THYAO: %v", err)
	}

	waitForCondition(t, 500*time.Millisecond, func() bool {
		return liveHub.ActiveWorkersCount() == 1
	}, "worker should be active for THYAO.IS")

	// Close connection
	_ = conn.Close()

	waitForCondition(t, 1*time.Second, func() bool {
		return liveHub.ClientCount() == 0 && liveHub.ActiveWorkersCount() == 0
	}, "all clients and workers should be terminated after disconnect")
}

func TestLiveHubConcurrentRaceCondition(t *testing.T) {
	store, err := storage.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatalf("failed to open sqlite: %v", err)
	}
	defer store.Close()

	coord := provider.NewCacheCoordinator(store, nil, nil)
	liveHub := NewLiveHub(coord, 20*time.Millisecond)

	srv := httptest.NewServer(http.HandlerFunc(liveHub.HandleWS))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	concurrency := 15

	done := make(chan struct{})
	var wg sync.WaitGroup

	// Background broadcaster
	go func() {
		ticker := time.NewTicker(10 * time.Millisecond)
		defer ticker.Stop()
		symbols := []string{"BTCUSDT", "ETHUSDT", "THYAO.IS", "AAPL"}
		i := 0
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				i++
				sym := symbols[i%len(symbols)]
				liveHub.BroadcastCandle(domain.LiveCandleMessage{
					Type:         "candle_update",
					Symbol:       sym,
					Interval:     "15m",
					Provider:     domain.DetectProvider(sym),
					DelayMinutes: 0,
					IsClosed:     false,
					Candle: domain.Candle{
						Symbol:    sym,
						Timeframe: "15m",
						Timestamp: time.Now().Unix(),
						Open:      100 + float64(i),
						High:      105 + float64(i),
						Low:       95 + float64(i),
						Close:     102 + float64(i),
						Volume:    500,
					},
				})
			}
		}
	}()

	for c := 0; c < concurrency; c++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
			if err != nil {
				return
			}
			defer conn.Close()

			sym := "BTCUSDT"
			if id%2 == 0 {
				sym = "THYAO.IS"
			}

			subMsg, _ := json.Marshal(ClientSubscriptionRequest{
				Action:   "subscribe",
				Symbol:   sym,
				Interval: "15m",
			})
			_ = conn.WriteMessage(websocket.TextMessage, subMsg)

			time.Sleep(30 * time.Millisecond)

			pingMsg, _ := json.Marshal(ClientSubscriptionRequest{Action: "ping"})
			_ = conn.WriteMessage(websocket.TextMessage, pingMsg)

			time.Sleep(30 * time.Millisecond)

			unsubMsg, _ := json.Marshal(ClientSubscriptionRequest{Action: "unsubscribe"})
			_ = conn.WriteMessage(websocket.TextMessage, unsubMsg)
		}(c)
	}

	wg.Wait()
	close(done)

	waitForCondition(t, 2*time.Second, func() bool {
		return liveHub.ClientCount() == 0 && liveHub.ActiveWorkersCount() == 0
	}, "hub should cleanly clean up all concurrent clients and workers")
}

func waitForCondition(t *testing.T, timeout time.Duration, cond func() bool, desc string) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !cond() {
		t.Fatalf("condition timed out (%s): %s", timeout, desc)
	}
}

func TestLiveHubWatchKeepsWorkerWithoutClients(t *testing.T) {
	h := NewLiveHub(provider.NewCacheCoordinator(nil, nil, nil), time.Hour) // Yahoo symbol, no upstream: no network
	got := make(chan domain.LiveCandleMessage, 4)
	cancel := h.Watch("thyao.is", "15m", func(m domain.LiveCandleMessage) { got <- m })
	if h.ActiveWorkersCount() != 1 || h.WatcherCount("THYAO.IS", "15m") != 1 {
		t.Fatalf("watch must start a worker: workers=%d", h.ActiveWorkersCount())
	}
	cancel2 := h.Watch("THYAO.IS", "15m", func(domain.LiveCandleMessage) {})
	h.BroadcastCandle(domain.LiveCandleMessage{Symbol: "THYAO.IS", Interval: "15m", Candle: domain.Candle{Timestamp: 1, Close: 300}})
	select {
	case m := <-got:
		if m.Candle.Close != 300 {
			t.Fatalf("candle %+v", m)
		}
	case <-time.After(time.Second):
		t.Fatal("watcher not called")
	}
	cancel()
	cancel() // idempotent
	if h.ActiveWorkersCount() != 1 {
		t.Fatal("second watcher keeps the worker")
	}
	cancel2()
	if h.ActiveWorkersCount() != 0 || h.WatcherCount("THYAO.IS", "15m") != 0 {
		t.Fatal("worker must stop with the last watcher")
	}
}
