package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
	"github.com/ersincebi/titanview/backend/internal/storage"
	"github.com/gorilla/websocket"
)

type mockUpstream struct {
	calls atomic.Int32
}

func (m *mockUpstream) FetchHistory(ctx context.Context, symbol, timeframe string, fromSec, toSec int64) ([]domain.Candle, error) {
	m.calls.Add(1)
	time.Sleep(15 * time.Millisecond)
	return GenerateDeterministicSeedCandles(symbol, timeframe, fromSec, toSec), nil
}

func TestCacheCoordinatorZeroDuplicateCalls(t *testing.T) {
	ctx := context.Background()
	store, err := storage.NewSQLiteStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("failed to open sqlite: %v", err)
	}
	defer store.Close()

	mockBinance := &mockUpstream{}
	mockYahoo := &mockUpstream{}
	coord := NewCacheCoordinator(store, mockBinance, mockYahoo)

	from := int64(1730000000)
	to := int64(1730090000)

	// 1st call: cache miss -> fetches from upstream (1 call) and stores in SQLite
	res1, err := coord.GetHistory(ctx, "THYAO.IS", "15m", from, to)
	if err != nil {
		t.Fatalf("first GetHistory failed: %v", err)
	}
	if len(res1.Candles) == 0 {
		t.Fatalf("expected non-empty candles")
	}
	if mockYahoo.calls.Load() != 1 {
		t.Fatalf("expected 1 upstream call on initial miss, got %d", mockYahoo.calls.Load())
	}

	// 2nd call for the same range: MUST be served 100% from SQLite with 0 new upstream calls!
	minTs := res1.Candles[0].Timestamp
	maxTs := res1.Candles[len(res1.Candles)-1].Timestamp
	res2, err := coord.GetHistory(ctx, "THYAO.IS", "15m", minTs, maxTs)
	if err != nil {
		t.Fatalf("second GetHistory failed: %v", err)
	}
	if !res2.CacheHit {
		t.Fatalf("expected CacheHit=true on second call")
	}
	if mockYahoo.calls.Load() != 1 {
		t.Fatalf("expected upstream call count to remain 1 on cache hit, got %d", mockYahoo.calls.Load())
	}

	// Concurrent singleflight test on BTCUSDT 4h (20 goroutines -> strictly 1 upstream call)
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = coord.GetHistory(ctx, "BTCUSDT", "4h", from, to)
		}()
	}
	wg.Wait()
	if got := mockBinance.calls.Load(); got != 1 {
		t.Fatalf("expected singleflight to make strictly 1 upstream call for 20 concurrent goroutines, got %d", got)
	}
}

func TestBinanceProviderPaginationAndStreamLive(t *testing.T) {
	ctx := context.Background()
	var klinePageCalls atomic.Int32

	restSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v3/klines" {
			http.NotFound(w, r)
			return
		}
		callNum := klinePageCalls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		if callNum == 1 {
			// Page 1 returns 2 candles (matching PageLimit=2) so pagination continues to page 2
			_, _ = w.Write([]byte(`[
				[1730000000000, "68000.00", "68500.00", "67800.00", "68200.00", "120.5", 1730014399999],
				[1730014400000, "68200.00", "69000.00", "68100.00", "68900.00", "145.0", 1730028799999]
			]`))
			return
		}
		// Page 2 returns 1 candle (< PageLimit=2), ending pagination
		_, _ = w.Write([]byte(`[
			[1730028800000, "68900.00", "69400.00", "68700.00", "69250.00", "98.2", 1730043199999]
		]`))
	}))
	defer restSrv.Close()

	bp := NewBinanceProvider(restSrv.Client())
	bp.BaseURLs = []string{restSrv.URL}
	bp.PageLimit = 2

	candles, err := bp.FetchHistory(ctx, "BTCUSDT", "4h", 1730000000, 1730043200)
	if err != nil {
		t.Fatalf("BinanceProvider.FetchHistory failed: %v", err)
	}
	if klinePageCalls.Load() != 2 {
		t.Fatalf("expected 2 paginated HTTP calls, got %d", klinePageCalls.Load())
	}
	if len(candles) != 3 {
		t.Fatalf("expected 3 total candles across 2 pages, got %d", len(candles))
	}
	if candles[2].Close != 69250.0 {
		t.Fatalf("expected last candle close 69250.0, got %f", candles[2].Close)
	}

	// Test StreamLive with reconnect backoff
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
	var wsAttempts atomic.Int32
	wsSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempt := wsAttempts.Add(1)
		if attempt == 1 {
			// Simulate initial connection failure to trigger exponential backoff
			http.Error(w, "temporary failure", http.StatusServiceUnavailable)
			return
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()

		payload := map[string]interface{}{
			"e": "kline",
			"s": "BTCUSDT",
			"k": map[string]interface{}{
				"t": int64(1730043200000),
				"i": "4h",
				"o": "69250.00",
				"h": "69800.00",
				"l": "69100.00",
				"c": "69750.00",
				"v": "210.4",
				"x": true,
			},
		}
		raw, _ := json.Marshal(payload)
		_ = conn.WriteMessage(websocket.TextMessage, raw)
	}))
	defer wsSrv.Close()

	wsURL := "ws" + strings.TrimPrefix(wsSrv.URL, "http")
	bp.WSBaseURLs = []string{wsURL}
	bp.BackoffBase = 5 * time.Millisecond

	streamCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	var received domain.Candle
	var closedFlag bool
	_ = bp.StreamLive(streamCtx, "BTCUSDT", "4h", func(c domain.Candle, isClosed bool) {
		received = c
		closedFlag = isClosed
		cancel()
	})

	if wsAttempts.Load() < 2 {
		t.Fatalf("expected StreamLive to reconnect after initial failure, attempts=%d", wsAttempts.Load())
	}
	if received.Symbol != "BTCUSDT" || received.Close != 69750.0 || !closedFlag {
		t.Fatalf("unexpected live candle from StreamLive: %+v (isClosed=%v)", received, closedFlag)
	}
}

func TestYahooProviderBISTAndUSWithFailoverAndLatestQuote(t *testing.T) {
	ctx := context.Background()
	var query1Hits atomic.Int32
	var query2Hits atomic.Int32

	// Primary query1 returns 429 rate-limit to verify instant failover to query2
	srv1 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query1Hits.Add(1)
		http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
	}))
	defer srv1.Close()

	now := time.Now().Unix()
	ts1 := (now - 1800) / 900 * 900
	ts2 := ts1 + 900

	srv2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query2Hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		body := fmt.Sprintf(`{
			"chart": {
				"result": [{
					"timestamp": [%d, %d],
					"indicators": {
						"quote": [{
							"open": [290.5, 292.0],
							"high": [293.0, 295.5],
							"low": [289.0, 291.5],
							"close": [292.0, 294.75],
							"volume": [1500000, 1820000]
						}]
					}
				}],
				"error": null
			}
		}`, ts1, ts2)
		_, _ = w.Write([]byte(body))
	}))
	defer srv2.Close()

	yp := NewYahooProvider(srv2.Client())
	yp.BaseURLs = []string{srv1.URL, srv2.URL}

	// 1. Test FetchHistory on THYAO.IS with failover from srv1 (429) to srv2 (200)
	candles, err := yp.FetchHistory(ctx, "THYAO.IS", "15m", ts1-3600, ts2)
	if err != nil {
		t.Fatalf("YahooProvider.FetchHistory failed: %v", err)
	}
	if query1Hits.Load() != 1 || query2Hits.Load() != 1 {
		t.Fatalf("expected 1 hit on query1 and 1 hit on query2 failover, got %d and %d", query1Hits.Load(), query2Hits.Load())
	}
	if len(candles) != 2 || candles[1].Close != 294.75 {
		t.Fatalf("unexpected THYAO.IS candles: %+v", candles)
	}

	// 2. Test FetchLatestQuote on AAPL
	latest, err := yp.FetchLatestQuote(ctx, "AAPL", "15m")
	if err != nil {
		t.Fatalf("YahooProvider.FetchLatestQuote failed: %v", err)
	}
	if latest == nil || latest.Symbol != "AAPL" || latest.Close != 294.75 {
		t.Fatalf("unexpected latest quote for AAPL: %+v", latest)
	}
}

func TestCacheCoordinatorEndToEndWithHTTPTestAndOfflineFallback(t *testing.T) {
	ctx := context.Background()
	store, err := storage.NewSQLiteStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("failed to open sqlite: %v", err)
	}
	defer store.Close()

	var binanceHTTPCount atomic.Int32
	var yahooHTTPCount atomic.Int32

	binanceSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		binanceHTTPCount.Add(1)
		time.Sleep(20 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[
			[1730000000000, "68000.00", "68500.00", "67800.00", "68200.00", "120.5", 1730014399999],
			[1730014400000, "68200.00", "69000.00", "68100.00", "68900.00", "145.0", 1730028799999]
		]`))
	}))
	defer binanceSrv.Close()

	now := time.Now().Unix()
	yTs1 := (now - 7200) / 3600 * 3600
	yTs2 := yTs1 + 3600

	yahooSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		yahooHTTPCount.Add(1)
		w.Header().Set("Content-Type", "application/json")
		body := fmt.Sprintf(`{
			"chart": {
				"result": [{
					"timestamp": [%d, %d],
					"indicators": {
						"quote": [{
							"open": [225.0, 226.5],
							"high": [227.0, 228.0],
							"low": [224.5, 226.0],
							"close": [226.5, 227.8],
							"volume": [900000, 1100000]
						}]
					}
				}],
				"error": null
			}
		}`, yTs1, yTs2)
		_, _ = w.Write([]byte(body))
	}))
	defer yahooSrv.Close()

	bp := NewBinanceProvider(binanceSrv.Client())
	bp.BaseURLs = []string{binanceSrv.URL}

	yp := NewYahooProvider(yahooSrv.Client())
	yp.BaseURLs = []string{yahooSrv.URL}

	coord := NewCacheCoordinator(store, bp, yp)

	// 1. 10 & 20 concurrent goroutines requesting BTCUSDT 4h -> strictly 1 HTTP call to Binance
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			res, err := coord.GetHistory(ctx, "BTCUSDT", "4h", 1730000000, 1730014400)
			if err != nil || len(res.Candles) != 2 {
				t.Errorf("concurrent BTCUSDT GetHistory failed: err=%v len=%d", err, len(res.Candles))
			}
		}()
	}
	wg.Wait()
	if got := binanceHTTPCount.Load(); got != 1 {
		t.Fatalf("expected strictly 1 HTTP call to Binance for 20 concurrent goroutines, got %d", got)
	}

	// 2. Route THYAO.IS and AAPL through YahooProvider and cache in SQLite
	resBist, err := coord.GetHistory(ctx, "THYAO.IS", "1h", yTs1, yTs2)
	if err != nil || resBist.Provider != domain.ProviderYahoo || len(resBist.Candles) != 2 {
		t.Fatalf("THYAO.IS GetHistory failed: err=%v res=%+v", err, resBist)
	}
	resUS, err := coord.GetHistory(ctx, "AAPL", "1h", yTs1, yTs2)
	if err != nil || resUS.Provider != domain.ProviderYahoo || len(resUS.Candles) != 2 {
		t.Fatalf("AAPL GetHistory failed: err=%v res=%+v", err, resUS)
	}
	if got := yahooHTTPCount.Load(); got != 2 {
		t.Fatalf("expected 2 Yahoo HTTP calls (1 for THYAO.IS, 1 for AAPL), got %d", got)
	}

	// 3. Upstream down + empty SQLite must surface an UpstreamError, never fabricated candles.
	failingBinance := NewBinanceProvider(binanceSrv.Client())
	failingBinance.BaseURLs = []string{"http://127.0.0.1:1"} // unreachable port
	offlineCoord := NewCacheCoordinator(store, failingBinance, yp)

	_, err = offlineCoord.GetHistory(ctx, "SOLUSDT", "1h", 1730000000, 1730036000)
	var upErr *UpstreamError
	if !errors.As(err, &upErr) {
		t.Fatalf("expected UpstreamError for offline SOLUSDT, got %v", err)
	}
	if n, _ := store.GetLatestCandles(ctx, "SOLUSDT", "1h", 10); len(n) != 0 {
		t.Fatalf("offline fetch must not persist fake candles, got %d", len(n))
	}
}

type countingUpstream struct {
	calls atomic.Int32
	close float64
}

func (m *countingUpstream) FetchHistory(ctx context.Context, symbol, timeframe string, fromSec, toSec int64) ([]domain.Candle, error) {
	m.calls.Add(1)
	step := domain.TimeframeSeconds(domain.NormalizeTimeframe(timeframe))
	ts := (time.Now().Unix() / step) * step
	return []domain.Candle{{Symbol: symbol, Timeframe: domain.NormalizeTimeframe(timeframe), Timestamp: ts,
		Open: 1, High: m.close, Low: 1, Close: m.close, Volume: 1}}, nil
}

func TestLiveEdgeRefreshesFormingBar(t *testing.T) {
	ctx := context.Background()
	store, err := storage.NewSQLiteStore(filepath.Join(t.TempDir(), "live.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	up := &countingUpstream{close: 10}
	coord := NewCacheCoordinator(store, nil, up)

	if _, err := coord.GetHistory(ctx, "AAPL", "1d", 0, 0); err != nil {
		t.Fatal(err)
	}
	first := up.calls.Load()
	// Within TTL: served from cache.
	if _, err := coord.GetHistory(ctx, "AAPL", "1d", 0, 0); err != nil {
		t.Fatal(err)
	}
	if up.calls.Load() != first {
		t.Fatalf("within TTL must not hit upstream: %d -> %d", first, up.calls.Load())
	}
	// Age the refresh past TTL: forming daily bar must be re-fetched and updated.
	if _, err := store.DB().Exec(`UPDATE fetched_ranges SET fetched_at = fetched_at - 1000`); err != nil {
		t.Fatal(err)
	}
	up.close = 12
	res, err := coord.GetHistory(ctx, "AAPL", "1d", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if up.calls.Load() == first {
		t.Fatal("stale live edge must trigger an upstream refresh")
	}
	if got := res.Candles[len(res.Candles)-1].Close; got != 12 {
		t.Fatalf("forming bar not refreshed, close=%v", got)
	}
}

func TestYahooSearchSymbols(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/finance/search" || r.URL.Query().Get("q") != "aselsan" {
			http.Error(w, "bad", 400)
			return
		}
		_, _ = w.Write([]byte(`{"quotes":[
			{"symbol":"ASELS.IS","shortname":"ASELSAN","longname":"Aselsan Elektronik Sanayi","quoteType":"EQUITY"},
			{"symbol":"BTC-USD","shortname":"Bitcoin","quoteType":"CRYPTOCURRENCY"},
			{"symbol":"XYZ","shortname":"Xyz","quoteType":"OPTION"}]}`))
	}))
	defer srv.Close()
	y := NewYahooProvider(nil)
	y.BaseURLs = []string{srv.URL}
	got, err := y.SearchSymbols(context.Background(), "aselsan", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Symbol != "ASELS.IS" || got[0].Market != domain.MarketBIST || got[0].DelayMinutes != 15 {
		t.Fatalf("unexpected: %+v", got)
	}
}

func TestParseYahooNewsAndQuery(t *testing.T) {
	body := []byte(`{"news":[{"title":"A","publisher":"P","link":"https://x/a","providerPublishTime":100},{"title":"","link":"https://x/b"},{"title":"C","link":"javascript:alert(1)"},{"title":"D","publisher":"Q","link":"https://x/d","providerPublishTime":50}]}`)
	got, err := parseYahooNews(body, 10)
	if err != nil || len(got) != 2 || got[0].Title != "A" || got[1].Title != "D" {
		t.Fatalf("news parse: %+v %v", got, err)
	}
	if one, _ := parseYahooNews(body, 1); len(one) != 1 {
		t.Fatal("limit ignored")
	}
	if NewsQuery("BTCUSDT") != "BTC-USD" || NewsQuery("thyao.is") != "THYAO.IS" || NewsQuery("USDT") != "USDT" {
		t.Fatal("news query mapping")
	}
}

type spanUpstream struct{ from, to int64 }

func (s *spanUpstream) FetchHistory(_ context.Context, symbol, tf string, from, to int64) ([]domain.Candle, error) {
	s.from, s.to = from, to
	return []domain.Candle{{Symbol: symbol, Timeframe: tf, Timestamp: to - 60, Open: 1, High: 2, Low: 1, Close: 1.5, Volume: 1}}, nil
}

func TestDefaultWindowClampedForBinanceOnly(t *testing.T) {
	store, err := storage.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	bin, yah := &spanUpstream{}, &spanUpstream{}
	c := NewCacheCoordinator(store, bin, yah)
	ctx := context.Background()

	// 15m default (55d = 5280 bars) fits in one Binance request: untouched
	if _, err := c.GetHistory(ctx, "BTCUSDT", "15m", 0, 0); err != nil {
		t.Fatal(err)
	}
	if bars := (bin.to - bin.from) / 900; bars != 5280 {
		t.Errorf("15m bars=%d want 5280", bars)
	}
	// 1h default (700d = 16800 bars) would overflow the page cap and drop the RECENT bars: must be clamped
	if _, err := c.GetHistory(ctx, "BTCUSDT", "1h", 0, 0); err != nil {
		t.Fatal(err)
	}
	if bars := (bin.to - bin.from) / 3600; bars != maxBinanceBars {
		t.Errorf("1h bars=%d want clamp %d", bars, maxBinanceBars)
	}
	// Yahoo keeps its full (upstream-limited) window
	if _, err := c.GetHistory(ctx, "THYAO.IS", "1h", 0, 0); err != nil {
		t.Fatal(err)
	}
	if days := (yah.to - yah.from) / 86400; days != 700 {
		t.Errorf("yahoo 1h days=%d want 700", days)
	}
	// An explicit range is never clamped
	if _, err := c.GetHistory(ctx, "BTCUSDT", "1h", 1_000_000_000, 1_700_000_000); err != nil {
		t.Fatal(err)
	}
	if bin.from != 1_000_000_000 {
		t.Errorf("explicit from altered: %d", bin.from)
	}
}

// truthUpstream returns the "final" OHLC for every bar in [from, to] (close = 100 + bar index).
type truthUpstream struct {
	calls atomic.Int32
	from  atomic.Int64
}

func (m *truthUpstream) FetchHistory(ctx context.Context, symbol, timeframe string, fromSec, toSec int64) ([]domain.Candle, error) {
	m.calls.Add(1)
	m.from.Store(fromSec)
	tf := domain.NormalizeTimeframe(timeframe)
	step := domain.TimeframeSeconds(tf)
	var out []domain.Candle
	for ts := (fromSec / step) * step; ts <= toSec; ts += step {
		c := float64(100 + ts/step%1000)
		out = append(out, domain.Candle{Symbol: symbol, Timeframe: tf, Timestamp: ts, Open: c, High: c + 1, Low: c - 1, Close: c, Volume: 1})
	}
	return out, nil
}

// Faz 20 kanıtı (BTCUSDT 1d 2026-11-12): canlı akışın yazdığı ve socket kopukken kapanan bar yarım kalıyordu.
func TestLiveFeedWrittenBarsAreReverified(t *testing.T) {
	ctx := context.Background()
	store, err := storage.NewSQLiteStore(filepath.Join(t.TempDir(), "verify.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	up := &truthUpstream{}
	coord := NewCacheCoordinator(store, nil, up)
	if _, err := coord.GetHistory(ctx, "AAPL", "1d", 0, 0); err != nil {
		t.Fatal(err)
	}
	const step = int64(86400)
	today := (time.Now().Unix() / step) * step
	stale := today - 5*step
	// Canlı akış (WS) 5 gün önceki barı oluşurken yazdı; son REST yenilemesi ondan da önceydi.
	if err := store.BatchUpsertCandles(ctx, []domain.Candle{{Symbol: "AAPL", Timeframe: "1d", Timestamp: stale, Open: 1, High: 1, Low: 1, Close: 1, Volume: 1}}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DB().Exec(`UPDATE fetched_ranges SET fetched_at = ?`, stale-3600); err != nil {
		t.Fatal(err)
	}
	res, err := coord.GetHistory(ctx, "AAPL", "1d", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if up.from.Load() > stale {
		t.Fatalf("re-verify must start at or before the unverified bar: from=%d stale=%d", up.from.Load(), stale)
	}
	for _, c := range res.Candles {
		if c.Timestamp == stale && c.Close != float64(100+stale/step%1000) {
			t.Fatalf("partial live-feed bar not healed: close=%v", c.Close)
		}
	}
	// Eski geçmiş (sol boşluk) çekimi canlı kenar işaretini ilerletmez.
	before := store.LastFetchedAt(ctx, "AAPL", "1d")
	if err := store.RecordFetchedRangeHistoric(ctx, "AAPL", "1d", 0, 10); err != nil {
		t.Fatal(err)
	}
	if store.LastFetchedAt(ctx, "AAPL", "1d") != before {
		t.Fatal("historic fetch must not move the live-edge mark")
	}
}

func TestUnverifiedFromBounds(t *testing.T) {
	const s = int64(60)
	if got := unverifiedFrom(0, 0, 100_000, s); got != 100_000-maxVerifyBars*s {
		t.Fatalf("never refreshed: %d", got)
	}
	if got := unverifiedFrom(0, 99_000, 100_000, s); got != 99_000 {
		t.Fatalf("clamped to oldest cached: %d", got)
	}
	if got := unverifiedFrom(99_990, 0, 100_000, s); got != 99_930 {
		t.Fatalf("from last refresh minus a bar: %d", got)
	}
}
