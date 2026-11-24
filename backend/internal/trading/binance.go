package trading

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Binance REST endpoints.
const (
	BinanceLiveURL    = "https://api.binance.com"
	BinanceTestnetURL = "https://testnet.binance.vision"
)

// ConfirmTTL is how long a previewed order may be confirmed.
const ConfirmTTL = 60 * time.Second

// ErrNotConfigured means no API key was saved.
var ErrNotConfigured = errors.New("Binance API anahtarı tanımlı değil")

// Credentials are stored sealed; Secret never leaves the server.
type Credentials struct {
	APIKey  string `json:"apiKey"`
	Secret  string `json:"secret"`
	Testnet bool   `json:"testnet"`
}

// BinanceStatus is the public view of the saved credentials.
type BinanceStatus struct {
	Configured bool   `json:"configured"`
	Testnet    bool   `json:"testnet"`
	KeyHint    string `json:"keyHint,omitempty"`
	BaseURL    string `json:"baseUrl,omitempty"`
}

// BinanceOrder is a spot order request (same vocabulary as paper orders).
type BinanceOrder struct {
	Symbol     string  `json:"symbol"`
	Side       string  `json:"side"`
	Type       string  `json:"type"`
	Qty        float64 `json:"qty"`
	LimitPrice float64 `json:"limitPrice"`
	StopPrice  float64 `json:"stopPrice"`
}

// Preview is returned before a real order; Token must be sent back to place it.
type Preview struct {
	Token     string       `json:"token"`
	Order     BinanceOrder `json:"order"`
	Params    string       `json:"params"` // exact query sent to Binance (without signature)
	Notional  float64      `json:"notional"`
	Testnet   bool         `json:"testnet"`
	ExpiresAt int64        `json:"expiresAt"`
	Summary   string       `json:"summary"`
}

var binanceSymRe = regexp.MustCompile(`^[A-Z0-9]{5,20}$`)

// Binance is a signed spot client plus the credential store and confirm tokens.
type Binance struct {
	Store  *Store
	Sealer *Sealer
	HTTP   *http.Client
	Now    func() time.Time
	// BaseOverride replaces the live/testnet URL (tests).
	BaseOverride string

	mu      sync.Mutex
	pending map[string]pendingOrder
}

type pendingOrder struct {
	order   BinanceOrder
	params  url.Values
	testnet bool
	expires time.Time
}

// NewBinance creates the client.
func NewBinance(st *Store, s *Sealer) *Binance {
	return &Binance{Store: st, Sealer: s, HTTP: &http.Client{Timeout: 15 * time.Second}, Now: time.Now, pending: map[string]pendingOrder{}}
}

// SaveCredentials validates shape and stores them sealed.
func (b *Binance) SaveCredentials(ctx context.Context, c Credentials) error {
	c.APIKey, c.Secret = strings.TrimSpace(c.APIKey), strings.TrimSpace(c.Secret)
	if len(c.APIKey) < 16 || len(c.APIKey) > 128 || len(c.Secret) < 16 || len(c.Secret) > 128 {
		return errors.New("API anahtarı ve gizli anahtar 16–128 karakter olmalı")
	}
	raw, _ := json.Marshal(c)
	sealed, err := b.Sealer.Seal(raw)
	if err != nil {
		return err
	}
	return b.Store.put(ctx, kvBinance, sealed)
}

// DeleteCredentials removes the key.
func (b *Binance) DeleteCredentials(ctx context.Context) error {
	b.mu.Lock()
	b.pending = map[string]pendingOrder{}
	b.mu.Unlock()
	return b.Store.del(ctx, kvBinance)
}

func (b *Binance) creds(ctx context.Context) (Credentials, error) {
	v, ok, err := b.Store.get(ctx, kvBinance)
	if err != nil {
		return Credentials{}, err
	}
	if !ok {
		return Credentials{}, ErrNotConfigured
	}
	raw, err := b.Sealer.Open(v)
	if err != nil {
		return Credentials{}, errors.New("kayıtlı anahtar çözülemedi (TITAN_SECRET_KEY değişti mi?)")
	}
	var c Credentials
	return c, json.Unmarshal(raw, &c)
}

func (b *Binance) base(testnet bool) string {
	if b.BaseOverride != "" {
		return b.BaseOverride
	}
	if testnet {
		return BinanceTestnetURL
	}
	return BinanceLiveURL
}

// Status reports whether a key is saved (never the secret).
func (b *Binance) Status(ctx context.Context) (BinanceStatus, error) {
	c, err := b.creds(ctx)
	if errors.Is(err, ErrNotConfigured) {
		return BinanceStatus{}, nil
	}
	if err != nil {
		return BinanceStatus{}, err
	}
	return BinanceStatus{Configured: true, Testnet: c.Testnet, KeyHint: KeyHint(c.APIKey), BaseURL: b.base(c.Testnet)}, nil
}

// APIError is a Binance error body.
type APIError struct {
	Status int    `json:"status"`
	Code   int    `json:"code"`
	Msg    string `json:"msg"`
}

func (e *APIError) Error() string {
	return fmt.Sprintf("Binance %d (kod %d): %s", e.Status, e.Code, e.Msg)
}

// signed performs a SIGNED request and decodes JSON into out.
func (b *Binance) signed(ctx context.Context, c Credentials, method, path string, q url.Values, out interface{}) error {
	if q == nil {
		q = url.Values{}
	}
	q.Set("timestamp", strconv.FormatInt(b.Now().UnixMilli(), 10))
	q.Set("recvWindow", "5000")
	payload := q.Encode()
	mac := hmac.New(sha256.New, []byte(c.Secret))
	mac.Write([]byte(payload))
	full := payload + "&signature=" + hex.EncodeToString(mac.Sum(nil))
	u := b.base(c.Testnet) + path
	var body io.Reader
	if method == http.MethodGet || method == http.MethodDelete {
		u += "?" + full
	} else {
		body = strings.NewReader(full)
	}
	req, err := http.NewRequestWithContext(ctx, method, u, body)
	if err != nil {
		return err
	}
	req.Header.Set("X-MBX-APIKEY", c.APIKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	resp, err := b.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode/100 != 2 {
		e := &APIError{Status: resp.StatusCode}
		if json.Unmarshal(raw, e) != nil || e.Msg == "" {
			e.Msg = strings.TrimSpace(string(raw))
			if len(e.Msg) > 200 {
				e.Msg = e.Msg[:200]
			}
		}
		return e
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(raw, out)
}

// Balance is one non-zero asset.
type Balance struct {
	Asset  string  `json:"asset"`
	Free   float64 `json:"free"`
	Locked float64 `json:"locked"`
}

// Account returns non-zero balances.
func (b *Binance) Account(ctx context.Context) ([]Balance, error) {
	c, err := b.creds(ctx)
	if err != nil {
		return nil, err
	}
	var raw struct {
		Balances []struct {
			Asset  string `json:"asset"`
			Free   string `json:"free"`
			Locked string `json:"locked"`
		} `json:"balances"`
	}
	if err := b.signed(ctx, c, http.MethodGet, "/api/v3/account", url.Values{"omitZeroBalances": {"true"}}, &raw); err != nil {
		return nil, err
	}
	out := []Balance{}
	for _, x := range raw.Balances {
		f, _ := strconv.ParseFloat(x.Free, 64)
		l, _ := strconv.ParseFloat(x.Locked, 64)
		if f > 0 || l > 0 {
			out = append(out, Balance{Asset: x.Asset, Free: f, Locked: l})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Asset < out[j].Asset })
	return out, nil
}

// OpenOrders returns raw Binance open orders (optionally one symbol).
func (b *Binance) OpenOrders(ctx context.Context, symbol string) ([]map[string]interface{}, error) {
	c, err := b.creds(ctx)
	if err != nil {
		return nil, err
	}
	q := url.Values{}
	if symbol != "" {
		symbol = strings.ToUpper(symbol)
		if !binanceSymRe.MatchString(symbol) {
			return nil, errors.New("geçersiz Binance sembolü")
		}
		q.Set("symbol", symbol)
	}
	out := []map[string]interface{}{}
	return out, b.signed(ctx, c, http.MethodGet, "/api/v3/openOrders", q, &out)
}

// CancelOrder cancels one order.
func (b *Binance) CancelOrder(ctx context.Context, symbol string, orderID int64) (map[string]interface{}, error) {
	c, err := b.creds(ctx)
	if err != nil {
		return nil, err
	}
	symbol = strings.ToUpper(symbol)
	if !binanceSymRe.MatchString(symbol) || orderID <= 0 {
		return nil, errors.New("sembol ve orderId gerekli")
	}
	out := map[string]interface{}{}
	return out, b.signed(ctx, c, http.MethodDelete, "/api/v3/order", url.Values{"symbol": {symbol}, "orderId": {strconv.FormatInt(orderID, 10)}}, &out)
}

func fmtNum(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

// orderParams maps our order vocabulary to Binance spot parameters.
func orderParams(o *BinanceOrder) (url.Values, error) {
	o.Symbol = strings.ToUpper(strings.TrimSpace(o.Symbol))
	o.Side = strings.ToLower(strings.TrimSpace(o.Side))
	o.Type = strings.ToLower(strings.TrimSpace(o.Type))
	if !binanceSymRe.MatchString(o.Symbol) {
		return nil, errors.New("Binance spot sembolü gerekli (ör. BTCUSDT); BIST aracı kurumu desteklenmiyor")
	}
	if o.Side != SideBuy && o.Side != SideSell {
		return nil, errors.New("yön buy veya sell olmalı")
	}
	for _, v := range []float64{o.Qty, o.LimitPrice, o.StopPrice} {
		if !finite(v) || v < 0 {
			return nil, errors.New("geçersiz sayı")
		}
	}
	if !(o.Qty > 0) {
		return nil, errors.New("adet sıfırdan büyük olmalı")
	}
	q := url.Values{}
	q.Set("symbol", o.Symbol)
	q.Set("side", strings.ToUpper(o.Side))
	q.Set("quantity", fmtNum(o.Qty))
	q.Set("newOrderRespType", "FULL")
	switch o.Type {
	case TypeMarket:
		q.Set("type", "MARKET")
	case TypeLimit:
		if !(o.LimitPrice > 0) {
			return nil, errors.New("limit fiyatı gerekli")
		}
		q.Set("type", "LIMIT")
		q.Set("timeInForce", "GTC")
		q.Set("price", fmtNum(o.LimitPrice))
	case TypeStop:
		if !(o.StopPrice > 0) {
			return nil, errors.New("stop fiyatı gerekli")
		}
		q.Set("type", "STOP_LOSS")
		q.Set("stopPrice", fmtNum(o.StopPrice))
	case TypeStopLimit:
		if !(o.StopPrice > 0) || !(o.LimitPrice > 0) {
			return nil, errors.New("stop ve limit fiyatı gerekli")
		}
		q.Set("type", "STOP_LOSS_LIMIT")
		q.Set("timeInForce", "GTC")
		q.Set("price", fmtNum(o.LimitPrice))
		q.Set("stopPrice", fmtNum(o.StopPrice))
	default:
		return nil, errors.New("emir türü market, limit, stop veya stop_limit olmalı")
	}
	return q, nil
}

func cloneValues(v url.Values) url.Values {
	out := url.Values{}
	for k, xs := range v {
		out[k] = append([]string{}, xs...)
	}
	return out
}

// PreviewOrder validates the order with Binance /api/v3/order/test (nothing is placed)
// and returns a one-time token bound to these exact parameters.
func (b *Binance) PreviewOrder(ctx context.Context, o BinanceOrder, refPrice float64) (Preview, error) {
	c, err := b.creds(ctx)
	if err != nil {
		return Preview{}, err
	}
	params, err := orderParams(&o)
	if err != nil {
		return Preview{}, err
	}
	if err := b.signed(ctx, c, http.MethodPost, "/api/v3/order/test", cloneValues(params), nil); err != nil {
		return Preview{}, err
	}
	tokRaw := make([]byte, 18)
	if _, err := rand.Read(tokRaw); err != nil {
		return Preview{}, err
	}
	tok := hex.EncodeToString(tokRaw)
	exp := b.Now().Add(ConfirmTTL)
	b.mu.Lock()
	for k, p := range b.pending { // prune expired
		if b.Now().After(p.expires) {
			delete(b.pending, k)
		}
	}
	b.pending[tok] = pendingOrder{order: o, params: params, testnet: c.Testnet, expires: exp}
	b.mu.Unlock()
	px := refPrice
	if o.LimitPrice > 0 {
		px = o.LimitPrice
	} else if o.StopPrice > 0 {
		px = o.StopPrice
	}
	env := "CANLI"
	if c.Testnet {
		env = "TESTNET"
	}
	sum := fmt.Sprintf("[%s] %s %s %s %s adet", env, o.Symbol, strings.ToUpper(o.Side), strings.ToUpper(params.Get("type")), fmtNum(o.Qty))
	return Preview{Token: tok, Order: o, Params: params.Encode(), Notional: px * o.Qty, Testnet: c.Testnet, ExpiresAt: exp.Unix(), Summary: sum}, nil
}

// ConfirmOrder places the previewed order. The token is single-use and expires after ConfirmTTL.
func (b *Binance) ConfirmOrder(ctx context.Context, token string) (map[string]interface{}, error) {
	b.mu.Lock()
	p, ok := b.pending[token]
	delete(b.pending, token)
	b.mu.Unlock()
	if !ok {
		return nil, errors.New("onay belirteci geçersiz veya kullanılmış")
	}
	if b.Now().After(p.expires) {
		return nil, errors.New("onay süresi doldu; emri yeniden önizleyin")
	}
	c, err := b.creds(ctx)
	if err != nil {
		return nil, err
	}
	if c.Testnet != p.testnet {
		return nil, errors.New("ortam (testnet/canlı) önizlemeden sonra değişti; yeniden önizleyin")
	}
	out := map[string]interface{}{}
	return out, b.signed(ctx, c, http.MethodPost, "/api/v3/order", cloneValues(p.params), &out)
}
