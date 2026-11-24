package alerts

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	db, err := sql.Open("sqlite3", "file:"+t.Name()+"?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	st, err := NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	return st
}

// decryptPush is the browser side of RFC 8291 (used only to prove the server's encryption).
func decryptPush(t *testing.T, body []byte, ua *ecdh.PrivateKey, auth []byte) []byte {
	t.Helper()
	salt, rs, idlen := body[:16], binary.BigEndian.Uint32(body[16:20]), int(body[20])
	if rs != 4096 || idlen != 65 {
		t.Fatalf("header rs=%d idlen=%d", rs, idlen)
	}
	asPub, ct := body[21:21+idlen], body[21+idlen:]
	pub, err := ecdh.P256().NewPublicKey(asPub)
	if err != nil {
		t.Fatal(err)
	}
	shared, _ := ua.ECDH(pub)
	info := append(append([]byte("WebPush: info\x00"), ua.PublicKey().Bytes()...), asPub...)
	prkKey, _ := hkdf.Extract(sha256.New, shared, auth)
	ikm, _ := hkdf.Expand(sha256.New, prkKey, string(info), 32)
	prk, _ := hkdf.Extract(sha256.New, ikm, salt)
	cek, _ := hkdf.Expand(sha256.New, prk, "Content-Encoding: aes128gcm\x00", 16)
	nonce, _ := hkdf.Expand(sha256.New, prk, "Content-Encoding: nonce\x00", 12)
	block, _ := aes.NewCipher(cek)
	gcm, _ := cipher.NewGCM(block)
	plain, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if plain[len(plain)-1] != 0x02 {
		t.Fatal("missing last-record delimiter")
	}
	return plain[:len(plain)-1]
}

func verifyVAPID(t *testing.T, header string, wantAud string) {
	t.Helper()
	if !strings.HasPrefix(header, "vapid t=") {
		t.Fatalf("authorization: %q", header)
	}
	parts := strings.SplitN(strings.TrimPrefix(header, "vapid t="), ", k=", 2)
	tok, k := parts[0], parts[1]
	kb, _ := decodeB64(k)
	pub := &ecdsa.PublicKey{Curve: elliptic.P256(), X: new(big.Int).SetBytes(kb[1:33]), Y: new(big.Int).SetBytes(kb[33:])}
	seg := strings.Split(tok, ".")
	sum := sha256.Sum256([]byte(seg[0] + "." + seg[1]))
	sig, _ := decodeB64(seg[2])
	if !ecdsa.Verify(pub, sum[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])) {
		t.Fatal("VAPID signature invalid")
	}
	claims, _ := decodeB64(seg[1])
	var c map[string]any
	_ = json.Unmarshal(claims, &c)
	if c["aud"] != wantAud || !strings.HasPrefix(c["sub"].(string), "mailto:") {
		t.Fatalf("claims %v", c)
	}
}

func newSub(t *testing.T, endpoint string) (PushSubscription, *ecdh.PrivateKey, []byte) {
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	auth := make([]byte, 16)
	_, _ = rand.Read(auth)
	var s PushSubscription
	s.Endpoint = endpoint
	s.Keys.P256dh = b64.EncodeToString(ua.PublicKey().Bytes())
	s.Keys.Auth = b64.EncodeToString(auth)
	return s, ua, auth
}

func TestWebPushEncryptRoundTripAndErrors(t *testing.T) {
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	auth := []byte("0123456789abcdef")
	ct, err := EncryptPayload([]byte(`{"t":"merhaba"}`), ua.PublicKey().Bytes(), auth, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := decryptPush(t, ct, ua, auth); string(got) != `{"t":"merhaba"}` {
		t.Fatalf("round trip: %s", got)
	}
	if _, err := EncryptPayload(nil, []byte{1, 2}, auth, nil, nil); err == nil {
		t.Fatal("bad p256dh")
	}
	if _, err := EncryptPayload(nil, ua.PublicKey().Bytes(), []byte("short"), nil, nil); err == nil {
		t.Fatal("bad auth")
	}
	if _, err := EncryptPayload(make([]byte, 5000), ua.PublicKey().Bytes(), auth, nil, nil); err == nil {
		t.Fatal("oversize payload")
	}
	// VAPID key survives serialisation
	v, _ := GenerateVAPID("mailto:x@y")
	v2, err := ParseVAPID(v.PrivateB64(), "mailto:x@y")
	if err != nil || v2.PublicB64() != v.PublicB64() {
		t.Fatalf("parse vapid: %v", err)
	}
	if _, err := ParseVAPID("!!", ""); err == nil {
		t.Fatal("invalid vapid")
	}
	if _, err := decodeB64("***"); err == nil {
		t.Fatal("invalid base64")
	}
}

func TestPushDeliveryToSubscriptions(t *testing.T) {
	st := testStore(t)
	n := NewNotifier(st)
	var got atomic.Value
	var mu sync.Mutex
	keys := map[string]struct {
		k    *ecdh.PrivateKey
		auth []byte
	}{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/gone" {
			w.WriteHeader(http.StatusGone)
			return
		}
		if r.Header.Get("Content-Encoding") != "aes128gcm" || r.Header.Get("TTL") == "" {
			w.WriteHeader(400)
			return
		}
		verifyVAPID(t, r.Header.Get("Authorization"), "http://"+r.Host)
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		k := keys[r.URL.Path]
		mu.Unlock()
		got.Store(string(decryptPush(t, body, k.k, k.auth)))
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()
	ok, uaKey, auth := newSub(t, srv.URL+"/ok")
	keys["/ok"] = struct {
		k    *ecdh.PrivateKey
		auth []byte
	}{uaKey, auth}
	gone, _, _ := newSub(t, srv.URL+"/gone")
	ctx := context.Background()
	_ = st.AddPushSub(ctx, ok)
	_ = st.AddPushSub(ctx, gone)
	_ = st.AddPushSub(ctx, ok) // idempotent

	ds := n.Deliver(ctx, LogEntry{AlertID: "a1", Name: "BTC 65k", Symbol: "BTCUSDT", Message: "BTC 65000 üstünde", Notify: Notify{Push: true}})
	if len(ds) != 1 || !ds[0].OK || ds[0].Detail != "1 tarayıcı" {
		t.Fatalf("push delivery: %+v", ds)
	}
	var p PushPayload
	_ = json.Unmarshal([]byte(got.Load().(string)), &p)
	if p.Title != "BTC 65k" || p.Body != "BTC 65000 üstünde" || p.Symbol != "BTCUSDT" || p.Tag != "alert-a1" {
		t.Fatalf("payload %+v", p)
	}
	subs, _ := st.PushSubs(ctx)
	if len(subs) != 1 || subs[0].Endpoint != ok.Endpoint {
		t.Fatalf("gone subscription must be removed: %+v", subs)
	}
	// the VAPID key is persisted and reused
	v1, _ := n.VAPID(ctx)
	n2 := NewNotifier(st)
	v2, _ := n2.VAPID(ctx)
	if v1.PublicB64() != v2.PublicB64() {
		t.Fatal("VAPID key must persist")
	}
	_ = st.RemovePushSub(ctx, ok.Endpoint)
	ds = n.Deliver(ctx, LogEntry{Notify: Notify{Push: true}})
	if ds[0].OK || ds[0].Detail != "abone tarayıcı yok" {
		t.Fatalf("no subscribers: %+v", ds)
	}
	bad := ok
	bad.Keys.P256dh = "AAAA"
	if err := SendPush(ctx, http.DefaultClient, v1, bad, []byte("x")); err == nil {
		t.Fatal("bad subscription key")
	}
}

func TestWebhookDelivery(t *testing.T) {
	st := testStore(t)
	n := NewNotifier(st)
	n.RetryDelay = time.Millisecond
	var calls int32
	var lastCT, lastBody atomic.Value
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c := atomic.AddInt32(&calls, 1)
		b, _ := io.ReadAll(r.Body)
		lastCT.Store(r.Header.Get("Content-Type"))
		lastBody.Store(string(b))
		switch r.URL.Path {
		case "/flaky":
			if c == 1 {
				w.WriteHeader(503)
				return
			}
		case "/bad":
			w.WriteHeader(400)
			return
		}
		w.WriteHeader(200)
	}))
	defer srv.Close()
	ctx := context.Background()
	d := n.webhook(ctx, srv.URL+"/ok", `{"side":"buy","ticker":"BTCUSDT"}`)
	if !d.OK || lastCT.Load() != "application/json" || lastBody.Load() != `{"side":"buy","ticker":"BTCUSDT"}` {
		t.Fatalf("json webhook: %+v %v", d, lastCT.Load())
	}
	d = n.webhook(ctx, srv.URL+"/ok", "BTC yukarı kesti")
	if !d.OK || !strings.HasPrefix(lastCT.Load().(string), "text/plain") {
		t.Fatalf("text webhook: %+v", d)
	}
	atomic.StoreInt32(&calls, 0)
	if d = n.webhook(ctx, srv.URL+"/flaky", "x"); !d.OK || atomic.LoadInt32(&calls) != 2 {
		t.Fatalf("retry on 5xx: %+v calls=%d", d, calls)
	}
	atomic.StoreInt32(&calls, 0)
	if d = n.webhook(ctx, srv.URL+"/bad", "x"); d.OK || d.Detail != "HTTP 400" || atomic.LoadInt32(&calls) != 1 {
		t.Fatalf("4xx must not retry: %+v calls=%d", d, calls)
	}
	if d = n.webhook(ctx, "http://127.0.0.1:1/x", "x"); d.OK {
		t.Fatal("unreachable webhook")
	}
	if d = n.webhook(ctx, "::bad", "x"); d.OK {
		t.Fatal("bad url")
	}
	cctx, cancel := context.WithCancel(ctx)
	cancel()
	if d = n.webhook(cctx, srv.URL+"/flaky", "x"); d.OK {
		t.Fatal("cancelled")
	}
}

func TestTelegramDelivery(t *testing.T) {
	st := testStore(t)
	n := NewNotifier(st)
	var got atomic.Value
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/botTOK123/sendMessage" {
			w.WriteHeader(404)
			_, _ = w.Write([]byte(`{"ok":false,"description":"Not Found"}`))
			return
		}
		var m map[string]any
		_ = json.NewDecoder(r.Body).Decode(&m)
		got.Store(m)
		if m["chat_id"] == "bad" {
			_, _ = w.Write([]byte(`{"ok":false,"description":"Bad Request: chat not found"}`))
			return
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()
	n.TelegramBase = srv.URL
	ctx := context.Background()

	ds := n.Deliver(ctx, LogEntry{Notify: Notify{Telegram: true}})
	if ds[0].OK {
		t.Fatal("unconfigured telegram must fail")
	}
	if err := n.SetTelegram(ctx, TelegramConfig{Enabled: true, Token: " TOK123 ", ChatID: " 42 "}); err != nil {
		t.Fatal(err)
	}
	// an empty token on update keeps the stored one
	_ = n.SetTelegram(ctx, TelegramConfig{Enabled: true, ChatID: "42"})
	cfg, _ := n.Telegram(ctx)
	if cfg.Token != "TOK123" || cfg.ChatID != "42" {
		t.Fatalf("config %+v", cfg)
	}
	ds = n.Deliver(ctx, LogEntry{Name: "RSI 70", Symbol: "ETHUSDT", Interval: "1h", Message: "RSI 71", Notify: Notify{Telegram: true}})
	m := got.Load().(map[string]any)
	if !ds[0].OK || m["chat_id"] != "42" || m["text"] != "🔔 RSI 70\nETHUSDT · 1h\nRSI 71" {
		t.Fatalf("telegram: %+v %v", ds, m)
	}
	err := n.SendTelegram(ctx, TelegramConfig{Enabled: true, Token: "TOK123", ChatID: "bad"}, "x")
	if err == nil || !strings.Contains(err.Error(), "chat not found") {
		t.Fatalf("telegram error: %v", err)
	}
	err = n.SendTelegram(ctx, TelegramConfig{Enabled: true, Token: "WRONG", ChatID: "1"}, "x")
	if err == nil || strings.Contains(err.Error(), "WRONG") {
		t.Fatalf("token must not leak: %v", err)
	}
	n.TelegramBase = "http://127.0.0.1:1"
	if err := n.SendTelegram(ctx, cfg, "x"); err == nil || strings.Contains(err.Error(), "TOK123") {
		t.Fatalf("unreachable must not leak token: %v", err)
	}
	if telegramText(LogEntry{Symbol: "X", Interval: "1m", Message: "m"}) != "🔔 X\nX · 1m\nm" {
		t.Fatal("text without name")
	}
}

func TestBroadcaster(t *testing.T) {
	b := NewBroadcaster()
	ch, cancel := b.Subscribe()
	if b.Count() != 1 {
		t.Fatal("count")
	}
	b.Publish(LogEntry{ID: 7})
	if e := <-ch; e.ID != 7 {
		t.Fatal("publish")
	}
	for i := 0; i < 100; i++ { // never blocks on a slow listener
		b.Publish(LogEntry{ID: int64(i)})
	}
	cancel()
	cancel()
	if b.Count() != 0 {
		t.Fatal("cancel")
	}
}

func TestStoreCRUDAndLog(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	a := Alert{ID: "a1", Symbol: "BTCUSDT", UpdatedAt: 1}
	if err := st.Put(ctx, a); err != nil {
		t.Fatal(err)
	}
	a.Name = "x"
	a.UpdatedAt = 2
	_ = st.Put(ctx, a)
	got, err := st.Get(ctx, "a1")
	if err != nil || got.Name != "x" {
		t.Fatalf("get %v %+v", err, got)
	}
	if _, err := st.Get(ctx, "nope"); !errors.Is(err, ErrNotFound) {
		t.Fatal("not found")
	}
	list, _ := st.List(ctx)
	if len(list) != 1 {
		t.Fatal("list")
	}
	if err := st.Delete(ctx, "a1"); err != nil || !errors.Is(st.Delete(ctx, "a1"), ErrNotFound) {
		t.Fatal("delete")
	}
	var last LogEntry
	for i := 0; i < 5; i++ {
		last, err = st.AppendLog(ctx, LogEntry{AlertID: "a1", Time: int64(i), Message: "m"})
		if err != nil {
			t.Fatal(err)
		}
	}
	last.Deliveries = []Delivery{{Channel: "webhook", OK: true}}
	_ = st.UpdateLog(ctx, last)
	entries, _ := st.Log(ctx, 0, 0)
	if len(entries) != 5 || entries[0].ID != last.ID || len(entries[0].Deliveries) != 1 {
		t.Fatalf("log %+v", entries)
	}
	if after, _ := st.Log(ctx, last.ID-2, 10); len(after) != 2 {
		t.Fatalf("after: %d", len(after))
	}
	_ = st.ClearLog(ctx)
	if e, _ := st.Log(ctx, 0, 10); len(e) != 0 {
		t.Fatal("clear")
	}
	if v, _ := st.GetKV(ctx, "x"); v != "" {
		t.Fatal("kv default")
	}
	_ = st.SetKV(ctx, "x", "1")
	_ = st.SetKV(ctx, "x", "2")
	if v, _ := st.GetKV(ctx, "x"); v != "2" {
		t.Fatal("kv")
	}
}
