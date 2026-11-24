package trading

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"

	"github.com/ersincebi/titanview/backend/internal/domain"
)

type fakeLive struct {
	mu  sync.Mutex
	fns map[string]func(domain.LiveCandleMessage)
}

func (l *fakeLive) Watch(sym, tf string, fn func(domain.LiveCandleMessage)) func() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.fns == nil {
		l.fns = map[string]func(domain.LiveCandleMessage){}
	}
	l.fns[sym] = fn
	return func() {
		l.mu.Lock()
		delete(l.fns, sym)
		l.mu.Unlock()
	}
}

func (l *fakeLive) push(sym string, px float64) {
	l.mu.Lock()
	fn := l.fns[sym]
	l.mu.Unlock()
	if fn != nil {
		fn(domain.LiveCandleMessage{Symbol: sym, Candle: domain.Candle{Close: px}})
	}
}

func (l *fakeLive) watching() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.fns)
}

type fixedPrices map[string]float64

func (p fixedPrices) LastPrice(_ context.Context, s string) (float64, error) {
	if v, ok := p[s]; ok {
		return v, nil
	}
	return 0, ErrNoPrice
}

func testDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite3", filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestEngineFillsOnLiveTicksAndPersists(t *testing.T) {
	db := testDB(t)
	st, err := NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	live := &fakeLive{}
	eng := NewEngine(st, live, fixedPrices{"BTCUSDT": 50000})
	if err := eng.Load(context.Background()); err != nil {
		t.Fatal(err)
	}
	ch, cancel := eng.Subscribe()
	defer cancel()

	ctx := context.Background()
	o, _, err := eng.Place(ctx, OrderRequest{Symbol: "BTCUSDT", Side: "buy", Type: "limit", Qty: 0.5, LimitPrice: 49000, TakeProfit: 52000})
	if err != nil || o.Status != StatusWorking {
		t.Fatalf("place: %+v %v", o, err)
	}
	if live.watching() != 1 {
		t.Fatal("engine must watch the symbol with a working order")
	}
	<-ch // placed

	live.push("BTCUSDT", 48900)
	msg := <-ch
	if len(msg.Snapshot.Positions) != 1 || len(msg.Snapshot.Orders) != 1 || msg.Snapshot.Orders[0].Role != RoleTP {
		t.Fatalf("after fill: %+v", msg.Snapshot)
	}
	// restart: state and fill log survive
	eng2 := NewEngine(st, &fakeLive{}, nil)
	if err := eng2.Load(ctx); err != nil {
		t.Fatal(err)
	}
	s := eng2.Snapshot()
	if len(s.Positions) != 1 || len(s.Orders) != 1 {
		t.Fatalf("reload: %+v", s)
	}
	fills, err := st.FillLog(ctx, 10)
	if err != nil || len(fills) != 1 || fills[0].Price != 48900 {
		t.Fatalf("fill log: %+v %v", fills, err)
	}

	live.push("BTCUSDT", 52500) // TP
	<-ch
	if s := eng.Snapshot(); len(s.Positions) != 0 || len(s.Orders) != 0 {
		t.Fatalf("TP: %+v", s)
	}
	if live.watching() != 0 {
		t.Fatal("feed must close when nothing is open")
	}

	// market order uses the Prices fallback
	if _, _, err := eng.Place(ctx, OrderRequest{Symbol: "ETHUSDT", Side: "buy", Type: "market", Qty: 1}); err == nil {
		t.Fatal("no price for ETHUSDT must fail")
	}
	if _, err := eng.ClosePosition(ctx, "BTCUSDT"); err == nil {
		t.Fatal("no position")
	}
	if err := eng.Reset(ctx, 5000, 0.05); err != nil {
		t.Fatal(err)
	}
	if s := eng.Snapshot(); s.Balance != 5000 || s.CommissionPct != 0.05 || len(s.Fills) != 0 {
		t.Fatalf("reset: %+v", s)
	}
	if err := eng.Reset(ctx, 100, 50); err == nil {
		t.Fatal("commission > 10 must fail")
	}
}

func TestEngineThrottledPricePush(t *testing.T) {
	st, _ := NewStore(testDB(t))
	live := &fakeLive{}
	eng := NewEngine(st, live, fixedPrices{"X": 10})
	eng.Throttle = 10 * time.Millisecond
	_ = eng.Load(context.Background())
	ctx, stop := context.WithCancel(context.Background())
	defer stop()
	go eng.Run(ctx)
	if _, _, err := eng.Place(context.Background(), OrderRequest{Symbol: "X", Side: "buy", Type: "market", Qty: 1}); err != nil {
		t.Fatal(err)
	}
	ch, cancel := eng.Subscribe()
	defer cancel()
	live.push("X", 12)
	select {
	case m := <-ch:
		if len(m.Events) != 0 || m.Snapshot.Summary.Unrealized != 2 {
			t.Fatalf("price push: %+v", m)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no throttled push")
	}
	if _, err := eng.SetBrackets(context.Background(), "X", 15, 9); err != nil {
		t.Fatal(err)
	}
	if _, err := eng.ReversePosition(context.Background(), "X"); err != nil {
		t.Fatal(err)
	}
	s := eng.Snapshot()
	if len(s.Positions) != 1 || s.Positions[0].Qty != -1 || len(s.Orders) != 0 {
		t.Fatalf("reverse: %+v", s)
	}
	o, _, err := eng.Place(context.Background(), OrderRequest{Symbol: "X", Side: "buy", Type: "limit", Qty: 1, LimitPrice: 5})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := eng.Modify(context.Background(), o.ID, OrderPatch{LimitPrice: 6}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := eng.Modify(context.Background(), "nope", OrderPatch{}); err != ErrNotFound {
		t.Fatal("modify unknown")
	}
	if _, err := eng.Cancel(context.Background(), o.ID); err != nil {
		t.Fatal(err)
	}
	if got := eng.Watched(); len(got) != 1 || got[0] != "X" {
		t.Fatalf("watched %v", got)
	}
}

func TestSealerAndMaster(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("TITAN_SECRET_KEY", "")
	m1, err := LoadOrCreateMaster(dir)
	if err != nil || len(m1) != 32 {
		t.Fatalf("master: %v", err)
	}
	info, _ := os.Stat(filepath.Join(dir, ".titan_secret"))
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("perm %v", info.Mode().Perm())
	}
	m2, _ := LoadOrCreateMaster(dir)
	if string(m1) != string(m2) {
		t.Fatal("master must be stable")
	}
	t.Setenv("TITAN_SECRET_KEY", "env-key-that-is-long-enough")
	m3, _ := LoadOrCreateMaster(dir)
	if string(m3) != "env-key-that-is-long-enough" {
		t.Fatal("env wins")
	}
	s, _ := NewSealer(m1)
	sealed, _ := s.Seal([]byte("secret"))
	if strings.Contains(sealed, "secret") {
		t.Fatal("not encrypted")
	}
	back, err := s.Open(sealed)
	if err != nil || string(back) != "secret" {
		t.Fatal("roundtrip")
	}
	other, _ := NewSealer([]byte("another-master-key-123"))
	if _, err := other.Open(sealed); err == nil {
		t.Fatal("wrong key must fail")
	}
	if _, err := NewSealer([]byte("short")); err == nil {
		t.Fatal("short master")
	}
	if KeyHint("abcdefghijkl") != "abcd…ijkl" || KeyHint("abc") != "•••" {
		t.Fatal("hint")
	}
}

// fakeBinance verifies signatures and records orders.
type fakeBinance struct {
	mu     sync.Mutex
	secret string
	tests  int
	orders []url.Values
}

func (f *fakeBinance) handler(t *testing.T) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw := r.URL.RawQuery
		if r.Method == http.MethodPost {
			b, _ := io.ReadAll(r.Body)
			raw = string(b)
		}
		i := strings.LastIndex(raw, "&signature=")
		if i < 0 || r.Header.Get("X-MBX-APIKEY") == "" {
			w.WriteHeader(401)
			_, _ = io.WriteString(w, `{"code":-2014,"msg":"API-key format invalid."}`)
			return
		}
		mac := hmac.New(sha256.New, []byte(f.secret))
		mac.Write([]byte(raw[:i]))
		if hex.EncodeToString(mac.Sum(nil)) != raw[i+len("&signature="):] {
			w.WriteHeader(400)
			_, _ = io.WriteString(w, `{"code":-1022,"msg":"Signature for this request is not valid."}`)
			return
		}
		q, _ := url.ParseQuery(raw[:i])
		f.mu.Lock()
		defer f.mu.Unlock()
		switch r.URL.Path {
		case "/api/v3/account":
			_, _ = io.WriteString(w, `{"balances":[{"asset":"USDT","free":"100.5","locked":"0"},{"asset":"BTC","free":"0","locked":"0"}]}`)
		case "/api/v3/order/test":
			if q.Get("quantity") == "999" {
				w.WriteHeader(400)
				_, _ = io.WriteString(w, `{"code":-2010,"msg":"Account has insufficient balance for requested action."}`)
				return
			}
			f.tests++
			_, _ = io.WriteString(w, `{}`)
		case "/api/v3/order":
			if r.Method == http.MethodDelete {
				_, _ = io.WriteString(w, `{"status":"CANCELED"}`)
				return
			}
			f.orders = append(f.orders, q)
			_, _ = io.WriteString(w, `{"orderId":42,"status":"NEW"}`)
		case "/api/v3/openOrders":
			_, _ = io.WriteString(w, `[{"orderId":42,"symbol":"BTCUSDT"}]`)
		default:
			w.WriteHeader(404)
		}
	})
}

func TestBinanceConfirmFlow(t *testing.T) {
	st, _ := NewStore(testDB(t))
	sealer, _ := NewSealer([]byte("test-master-key-0123456789"))
	fb := &fakeBinance{secret: "s3cr3t-s3cr3t-s3cr3t"}
	srv := httptest.NewServer(fb.handler(t))
	defer srv.Close()
	b := NewBinance(st, sealer)
	b.BaseOverride = srv.URL
	ctx := context.Background()

	if _, err := b.Account(ctx); err != ErrNotConfigured {
		t.Fatalf("expected not configured, got %v", err)
	}
	if err := b.SaveCredentials(ctx, Credentials{APIKey: "short", Secret: "x"}); err == nil {
		t.Fatal("short key")
	}
	if err := b.SaveCredentials(ctx, Credentials{APIKey: "AKAKAKAKAKAKAKAKAK", Secret: fb.secret, Testnet: true}); err != nil {
		t.Fatal(err)
	}
	// stored sealed: the secret never appears in the database
	var stored string
	_ = st.db.QueryRow(`SELECT value FROM trading_kv WHERE key = ?`, kvBinance).Scan(&stored)
	if strings.Contains(stored, fb.secret) || strings.Contains(stored, "AKAKAKAK") {
		t.Fatal("credentials stored in clear text")
	}
	status, _ := b.Status(ctx)
	if !status.Configured || !status.Testnet || status.KeyHint != "AKAK…AKAK" {
		t.Fatalf("status %+v", status)
	}
	bal, err := b.Account(ctx)
	if err != nil || len(bal) != 1 || bal[0].Asset != "USDT" {
		t.Fatalf("account %+v %v", bal, err)
	}
	if _, err := b.PreviewOrder(ctx, BinanceOrder{Symbol: "THYAO.IS", Side: "buy", Type: "market", Qty: 1}, 0); err == nil {
		t.Fatal("BIST must be refused")
	}
	if _, err := b.PreviewOrder(ctx, BinanceOrder{Symbol: "BTCUSDT", Side: "buy", Type: "market", Qty: 999}, 0); err == nil {
		t.Fatal("exchange rejection must surface")
	}
	p, err := b.PreviewOrder(ctx, BinanceOrder{Symbol: "btcusdt", Side: "buy", Type: "stop_limit", Qty: 0.001, StopPrice: 70000, LimitPrice: 70100}, 69000)
	if err != nil {
		t.Fatal(err)
	}
	if fb.tests != 1 || len(fb.orders) != 0 {
		t.Fatal("preview must only call /order/test")
	}
	if !strings.Contains(p.Params, "type=STOP_LOSS_LIMIT") || !strings.Contains(p.Summary, "TESTNET") || math.Abs(p.Notional-70.1) > 1e-9 {
		t.Fatalf("preview %+v", p)
	}
	if _, err := b.ConfirmOrder(ctx, "bogus"); err == nil {
		t.Fatal("bogus token")
	}
	res, err := b.ConfirmOrder(ctx, p.Token)
	if err != nil || res["orderId"] != float64(42) {
		t.Fatalf("confirm %v %v", res, err)
	}
	if len(fb.orders) != 1 || fb.orders[0].Get("stopPrice") != "70000" || fb.orders[0].Get("timeInForce") != "GTC" {
		t.Fatalf("sent %+v", fb.orders)
	}
	if _, err := b.ConfirmOrder(ctx, p.Token); err == nil {
		t.Fatal("token must be single-use")
	}
	// expired token
	p2, _ := b.PreviewOrder(ctx, BinanceOrder{Symbol: "BTCUSDT", Side: "sell", Type: "limit", Qty: 1, LimitPrice: 80000}, 0)
	b.Now = func() time.Time { return time.Now().Add(2 * ConfirmTTL) }
	if _, err := b.ConfirmOrder(ctx, p2.Token); err == nil {
		t.Fatal("expired token")
	}
	b.Now = time.Now
	if list, err := b.OpenOrders(ctx, "BTCUSDT"); err != nil || len(list) != 1 {
		t.Fatalf("open orders %v %v", list, err)
	}
	if _, err := b.CancelOrder(ctx, "BTCUSDT", 42); err != nil {
		t.Fatal(err)
	}
	if _, err := b.CancelOrder(ctx, "BTCUSDT", 0); err == nil {
		t.Fatal("orderId required")
	}
	// wrong secret: Binance signature error surfaces as APIError
	_ = b.SaveCredentials(ctx, Credentials{APIKey: "AKAKAKAKAKAKAKAKAK", Secret: "wrong-wrong-wrong-wrong", Testnet: true})
	if _, err := b.Account(ctx); err == nil || !strings.Contains(err.Error(), "-1022") {
		t.Fatalf("expected signature error, got %v", err)
	}
	if err := b.DeleteCredentials(ctx); err != nil {
		t.Fatal(err)
	}
	if s, _ := b.Status(ctx); s.Configured {
		t.Fatal("delete")
	}
}

func TestOrderParamsMapping(t *testing.T) {
	cases := map[string]string{TypeMarket: "MARKET", TypeLimit: "LIMIT", TypeStop: "STOP_LOSS", TypeStopLimit: "STOP_LOSS_LIMIT"}
	for typ, want := range cases {
		o := BinanceOrder{Symbol: "ETHUSDT", Side: "sell", Type: typ, Qty: 1, LimitPrice: 3000, StopPrice: 2900}
		q, err := orderParams(&o)
		if err != nil || q.Get("type") != want || q.Get("side") != "SELL" {
			t.Fatalf("%s: %v %v", typ, q, err)
		}
	}
	for _, o := range []BinanceOrder{
		{Symbol: "ETHUSDT", Side: "buy", Type: "limit", Qty: 1},
		{Symbol: "ETHUSDT", Side: "buy", Type: "stop", Qty: 1},
		{Symbol: "ETHUSDT", Side: "buy", Type: "stop_limit", Qty: 1, StopPrice: 1},
		{Symbol: "ETHUSDT", Side: "x", Type: "market", Qty: 1},
		{Symbol: "ETHUSDT", Side: "buy", Type: "oco", Qty: 1},
		{Symbol: "ETHUSDT", Side: "buy", Type: "market", Qty: 0},
	} {
		if _, err := orderParams(&o); err == nil {
			t.Fatalf("expected error for %+v", o)
		}
	}
}
