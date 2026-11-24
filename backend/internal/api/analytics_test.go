package api

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
	"github.com/ersincebi/titanview/backend/internal/hub"
	"github.com/ersincebi/titanview/backend/internal/provider"
	"github.com/ersincebi/titanview/backend/internal/storage"
)

// stubUpstream serves deterministic daily candles (test-only) and news.
type stubUpstream struct {
	fail     map[string]bool
	newsErr  error
	lastQ    string
	emptyFor map[string]bool
}

func (s *stubUpstream) FetchHistory(_ context.Context, symbol, tf string, from, to int64) ([]domain.Candle, error) {
	if s.fail[symbol] {
		return nil, errors.New("boom")
	}
	seed := 3
	if strings.HasPrefix(symbol, "INV") {
		seed = -3
	}
	var out []domain.Candle
	price := 100.0
	day := from / 86400 * 86400
	for ts, i := day, 0; ts <= to; ts, i = ts+86400, i+1 {
		price *= 1 + float64((i*3)%7-3)*0.004*float64(seed)/3
		out = append(out, domain.Candle{Symbol: symbol, Timeframe: tf, Timestamp: ts, Open: price, High: price * 1.01, Low: price * 0.99, Close: price, Volume: 1000})
	}
	return out, nil
}

func (s *stubUpstream) FetchNews(_ context.Context, q string, limit int) ([]provider.NewsItem, error) {
	s.lastQ = q
	if s.emptyFor[q] {
		return nil, nil
	}
	if s.newsErr != nil {
		return nil, s.newsErr
	}
	return []provider.NewsItem{{Title: "T", Publisher: "P", Link: "https://x/1", Time: 5}}, nil
}

func newAnalyticsHandler(t *testing.T, st *stubUpstream) http.Handler {
	t.Helper()
	store, err := storage.NewSQLiteStore(filepath.Join(t.TempDir(), "a.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	coord := provider.NewCacheCoordinator(store, st, st)
	return NewServer(coord, hub.NewLiveHub(coord, 10*time.Second), "").Routes()
}

func getJSON(t *testing.T, h http.Handler, url string, want int, into interface{}) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, url, nil))
	if rec.Code != want {
		t.Fatalf("%s: want %d got %d: %s", url, want, rec.Code, rec.Body.String())
	}
	if into != nil {
		if err := json.Unmarshal(rec.Body.Bytes(), into); err != nil {
			t.Fatal(err)
		}
	}
}

func TestOverviewSkipsFailedUpstream(t *testing.T) {
	st := &stubUpstream{fail: map[string]bool{"THYAO.IS": true}}
	h := newAnalyticsHandler(t, st)
	var resp struct {
		Rows []OverviewRow `json:"rows"`
	}
	getJSON(t, h, "/api/overview?market=BIST", http.StatusOK, &resp)
	if len(resp.Rows) == 0 {
		t.Fatal("no rows")
	}
	for _, r := range resp.Rows {
		if r.Symbol == "THYAO.IS" {
			t.Fatal("failed symbol must be omitted, not faked")
		}
		if r.Market != domain.MarketBIST || r.Change1D == nil || r.Change1M == nil || r.LastPrice <= 0 {
			t.Fatalf("bad row %+v", r)
		}
	}
}

func TestCorrelationEndpoint(t *testing.T) {
	h := newAnalyticsHandler(t, &stubUpstream{fail: map[string]bool{"DEAD": true}})
	var resp struct {
		Symbols []string     `json:"symbols"`
		Matrix  [][]*float64 `json:"matrix"`
	}
	getJSON(t, h, "/api/correlation?symbols=THYAO.IS,INVX,DEAD,THYAO.IS&days=200", http.StatusOK, &resp)
	if len(resp.Symbols) != 3 {
		t.Fatalf("dedupe failed: %v", resp.Symbols)
	}
	m := resp.Matrix
	if m[0][0] == nil || *m[0][0] != 1 {
		t.Fatal("diag")
	}
	if m[0][1] == nil || math.Abs(*m[0][1]+1) > 1e-9 {
		t.Fatalf("THYAO~INVX want -1, got %v", m[0][1])
	}
	if m[0][2] != nil || m[2][2] != nil {
		t.Fatal("dead symbol must be null")
	}
	getJSON(t, h, "/api/correlation?symbols=A", http.StatusBadRequest, nil)
	getJSON(t, h, "/api/correlation?symbols=A,B,C,D,E,F,G,H,I,J,K,L,M", http.StatusBadRequest, nil)
}

func TestSecurityEndpoint(t *testing.T) {
	st := &stubUpstream{fail: map[string]bool{"XU100.IS": true}}
	h := newAnalyticsHandler(t, st)
	var resp map[string]interface{}
	getJSON(t, h, "/api/security?symbol=THYAO.IS", http.StatusOK, &resp)
	stats := resp["stats"].(map[string]interface{})
	if stats["change1d"] == nil || stats["high52w"].(float64) <= 0 {
		t.Fatalf("stats: %v", stats)
	}
	if _, has := resp["beta"]; has {
		t.Fatal("benchmark failed -> no beta")
	}
	h2 := newAnalyticsHandler(t, &stubUpstream{})
	getJSON(t, h2, "/api/security?symbol=THYAO.IS", http.StatusOK, &resp)
	if resp["beta"] == nil || resp["benchmark"] != "XU100.IS" {
		t.Fatalf("beta: %v", resp)
	}
	getJSON(t, h2, "/api/security", http.StatusBadRequest, nil)
	h3 := newAnalyticsHandler(t, &stubUpstream{fail: map[string]bool{"AAPL": true}})
	getJSON(t, h3, "/api/security?symbol=AAPL", http.StatusBadGateway, nil)
}

func TestNewsEndpoint(t *testing.T) {
	st := &stubUpstream{}
	h := newAnalyticsHandler(t, st)
	var resp struct {
		Query string              `json:"query"`
		Items []provider.NewsItem `json:"items"`
	}
	getJSON(t, h, "/api/news?symbol=BTCUSDT", http.StatusOK, &resp)
	if st.lastQ != "BTC-USD" || len(resp.Items) != 1 || resp.Items[0].Title != "T" {
		t.Fatalf("news: %+v q=%s", resp, st.lastQ)
	}
	st.emptyFor = map[string]bool{"BTC-USD": true}
	getJSON(t, h, "/api/news?symbol=BTCUSDT", http.StatusOK, &resp)
	if st.lastQ != "BTC" || len(resp.Items) != 1 {
		t.Fatalf("fallback query failed: q=%s %+v", st.lastQ, resp)
	}
	st.newsErr = errors.New("down")
	getJSON(t, h, "/api/news?symbol=AAPL", http.StatusBadGateway, nil)
}

type fallbackNews struct {
	items []provider.NewsItem
	err   error
	gotQ  string
}

func (f *fallbackNews) FetchNews(_ context.Context, q string, _ int) ([]provider.NewsItem, error) {
	f.gotQ = q
	return f.items, f.err
}

func TestNewsFallbackWhenYahooEmpty(t *testing.T) {
	st := &stubUpstream{emptyFor: map[string]bool{"THYAO.IS": true, "THYAO": true}}
	store, err := storage.NewSQLiteStore(filepath.Join(t.TempDir(), "f.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	srv := NewServer(provider.NewCacheCoordinator(store, st, st), nil, "")
	fb := &fallbackNews{items: []provider.NewsItem{{Title: "TR", Publisher: "P", Link: "https://tr/1", Time: 9}}}
	srv.NewsFallback = fb
	h := srv.Routes()
	var resp struct {
		Query string              `json:"query"`
		Items []provider.NewsItem `json:"items"`
	}
	getJSON(t, h, "/api/news?symbol=THYAO.IS", http.StatusOK, &resp)
	if fb.gotQ != "THYAO.IS" || len(resp.Items) != 1 || resp.Items[0].Title != "TR" {
		t.Fatalf("fallback not used: %+v q=%s", resp, fb.gotQ)
	}
	// Yahoo error + fallback result -> 200 with fallback items
	st2 := &stubUpstream{newsErr: errors.New("down")}
	srv2 := NewServer(provider.NewCacheCoordinator(store, st2, st2), nil, "")
	srv2.NewsFallback = fb
	getJSON(t, srv2.Routes(), "/api/news?symbol=AAPL", http.StatusOK, &resp)
	if len(resp.Items) != 1 {
		t.Fatalf("yahoo error + good fallback must succeed: %+v", resp)
	}
	// Both empty -> empty list, not an error, nothing invented
	fb.items = nil
	getJSON(t, h, "/api/news?symbol=THYAO.IS", http.StatusOK, &resp)
	if len(resp.Items) != 0 {
		t.Fatalf("must stay empty: %+v", resp)
	}
	// Both fail -> still 502
	fb.err = errors.New("gn down")
	getJSON(t, srv2.Routes(), "/api/news?symbol=AAPL", http.StatusBadGateway, nil)
}

type whaleStub struct {
	stubUpstream
	rep *provider.WhaleReport
	err error
}

func (w *whaleStub) FetchWhales(_ context.Context, sym string, _ int) (*provider.WhaleReport, error) {
	return w.rep, w.err
}

func TestWhalesEndpoint(t *testing.T) {
	store, err := storage.NewSQLiteStore(filepath.Join(t.TempDir(), "w.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	st := &stubUpstream{}
	ws := &whaleStub{rep: &provider.WhaleReport{Symbol: "BTCUSDT", Sampled: 1, Trades: []provider.WhaleTrade{{Notional: 5, Side: "BUY"}}}}
	h := NewServer(provider.NewCacheCoordinator(store, ws, st), nil, "").Routes()
	var resp struct {
		Supported bool                  `json:"supported"`
		Reason    string                `json:"reason"`
		Report    *provider.WhaleReport `json:"report"`
	}
	getJSON(t, h, "/api/whales?symbol=btcusdt", http.StatusOK, &resp)
	if !resp.Supported || resp.Report == nil || resp.Report.Sampled != 1 {
		t.Fatalf("%+v", resp)
	}
	// equities have no free tape: explicit unsupported, not fake data
	resp.Report, resp.Supported = nil, false
	getJSON(t, h, "/api/whales?symbol=THYAO.IS", http.StatusOK, &resp)
	if resp.Supported || resp.Reason == "" || resp.Report != nil {
		t.Fatalf("%+v", resp)
	}
	getJSON(t, h, "/api/whales", http.StatusBadRequest, nil)
	ws.err = errors.New("down")
	getJSON(t, h, "/api/whales?symbol=BTCUSDT", http.StatusBadGateway, nil)
}
