package hub

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
	"github.com/ersincebi/titanview/backend/internal/provider"
	"github.com/ersincebi/titanview/backend/internal/storage"
	"github.com/gorilla/websocket"
)

func TestLiveHubMultiSubscriptions(t *testing.T) {
	store, err := storage.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	defer store.Close()

	coord := provider.NewCacheCoordinator(store, nil, nil)
	liveHub := NewLiveHub(coord, time.Hour)
	srv := httptest.NewServer(http.HandlerFunc(liveHub.HandleWS))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	// Subscribe to 3 streams at once (multi-chart layout)
	msg, _ := json.Marshal(ClientSubscriptionRequest{
		Action: "set_subscriptions",
		Streams: []StreamTarget{
			{Symbol: "BTCUSDT", Interval: "15m"},
			{Symbol: "ETHUSDT", Interval: "1h"},
			{Symbol: "THYAO.IS", Interval: "1d"},
		},
	})
	if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
		t.Fatalf("write: %v", err)
	}
	waitForCondition(t, time.Second, func() bool {
		return liveHub.SubscribersCount("BTCUSDT", "15m") == 1 &&
			liveHub.SubscribersCount("ETHUSDT", "1h") == 1 &&
			liveHub.SubscribersCount("THYAO.IS", "1d") == 1
	}, "all 3 multi-chart streams should be subscribed")

	// Shrink to 1 stream: dropped workers must stop cleanly
	msg2, _ := json.Marshal(ClientSubscriptionRequest{
		Action:  "set_subscriptions",
		Streams: []StreamTarget{{Symbol: "BTCUSDT", Interval: "15m"}},
	})
	_ = conn.WriteMessage(websocket.TextMessage, msg2)
	waitForCondition(t, time.Second, func() bool {
		return liveHub.ActiveWorkersCount() == 1 && liveHub.SubscribersCount("ETHUSDT", "1h") == 0
	}, "dropped streams should be cleaned up")
}

func TestLiveResamplerOHLCVAndBucketRollover(t *testing.T) {
	r := newLiveResampler("BTCUSDT", "5s")
	c1, prev1 := r.Feed(domain.Candle{Timestamp: 1700000000, Open: 100, High: 102, Low: 99, Close: 101, Volume: 5})
	if prev1 != nil || c1.Timestamp != 1700000000 || c1.Volume != 5 {
		t.Fatalf("tick 1: cur=%+v prev=%+v", c1, prev1)
	}
	// Same sub-bar updated volume (must replace, not double-add)
	c2, prev2 := r.Feed(domain.Candle{Timestamp: 1700000000, Open: 100, High: 103, Low: 99, Close: 102, Volume: 8})
	if prev2 != nil || c2.High != 103 || c2.Volume != 8 {
		t.Fatalf("tick 2: cur=%+v", c2)
	}
	// Next sub-bar inside same 5s bucket
	c3, prev3 := r.Feed(domain.Candle{Timestamp: 1700000003, Open: 102, High: 105, Low: 98, Close: 104, Volume: 4})
	if prev3 != nil || c3.Open != 100 || c3.High != 105 || c3.Low != 98 || c3.Close != 104 || c3.Volume != 12 {
		t.Fatalf("tick 3: cur=%+v", c3)
	}
	// Rollover into next 5s bucket -> prev must finalize old bucket
	c4, prev4 := r.Feed(domain.Candle{Timestamp: 1700000005, Open: 104, High: 106, Low: 104, Close: 105, Volume: 2})
	if prev4 == nil || prev4.Timestamp != 1700000000 || prev4.Close != 104 || prev4.Volume != 12 {
		t.Fatalf("rollover prev: %+v", prev4)
	}
	if c4.Timestamp != 1700000005 || c4.Open != 104 || c4.Volume != 2 {
		t.Fatalf("rollover cur: %+v", c4)
	}
}
