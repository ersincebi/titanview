package alerts

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// TelegramConfig is stored in alert_kv ("telegram"); the token never leaves the server in API responses.
type TelegramConfig struct {
	Enabled bool   `json:"enabled"`
	Token   string `json:"token,omitempty"`
	ChatID  string `json:"chatId"`
}

// Notifier delivers firings to external channels.
type Notifier struct {
	Store *Store
	HTTP  *http.Client
	// TelegramBase defaults to https://api.telegram.org (tests point it at httptest).
	TelegramBase string
	// PushSubject is the VAPID "sub" claim (mailto: or https: contact).
	PushSubject string
	// RetryDelay between the two webhook attempts.
	RetryDelay time.Duration

	vapidMu sync.Mutex
	vapid   *VAPID
}

// NewNotifier creates a notifier with sane timeouts.
func NewNotifier(st *Store) *Notifier {
	return &Notifier{
		Store:        st,
		HTTP:         &http.Client{Timeout: 5 * time.Second},
		TelegramBase: "https://api.telegram.org",
		PushSubject:  "mailto:alerts@titanview.invalid",
		RetryDelay:   2 * time.Second,
	}
}

// VAPID returns the persistent application server key, generating it on first use.
func (n *Notifier) VAPID(ctx context.Context) (*VAPID, error) {
	n.vapidMu.Lock()
	defer n.vapidMu.Unlock()
	if n.vapid != nil {
		return n.vapid, nil
	}
	priv, err := n.Store.GetKV(ctx, "vapid_private")
	if err != nil {
		return nil, err
	}
	var v *VAPID
	if priv != "" {
		v, err = ParseVAPID(priv, n.PushSubject)
	} else {
		v, err = GenerateVAPID(n.PushSubject)
		if err == nil {
			err = n.Store.SetKV(ctx, "vapid_private", v.PrivateB64())
		}
	}
	if err != nil {
		return nil, err
	}
	n.vapid = v
	return v, nil
}

// Telegram loads the Telegram config.
func (n *Notifier) Telegram(ctx context.Context) (TelegramConfig, error) {
	var c TelegramConfig
	raw, err := n.Store.GetKV(ctx, "telegram")
	if err != nil || raw == "" {
		return c, err
	}
	return c, json.Unmarshal([]byte(raw), &c)
}

// SetTelegram saves the Telegram config; an empty token keeps the stored one.
func (n *Notifier) SetTelegram(ctx context.Context, c TelegramConfig) error {
	if c.Token == "" {
		old, _ := n.Telegram(ctx)
		c.Token = old.Token
	}
	c.ChatID = strings.TrimSpace(c.ChatID)
	c.Token = strings.TrimSpace(c.Token)
	raw, _ := json.Marshal(c)
	return n.Store.SetKV(ctx, "telegram", string(raw))
}

// Deliver sends one firing to every external channel the alert selected and reports each outcome.
func (n *Notifier) Deliver(ctx context.Context, e LogEntry) []Delivery {
	var out []Delivery
	var mu sync.Mutex
	var wg sync.WaitGroup
	add := func(d Delivery) {
		mu.Lock()
		out = append(out, d)
		mu.Unlock()
	}
	if e.Notify.Webhook != "" {
		wg.Add(1)
		go func() {
			defer wg.Done()
			add(n.webhook(ctx, e.Notify.Webhook, e.Message))
		}()
	}
	if e.Notify.Telegram {
		wg.Add(1)
		go func() {
			defer wg.Done()
			add(n.telegram(ctx, e))
		}()
	}
	if e.Notify.Ntfy {
		wg.Add(1)
		go func() {
			defer wg.Done()
			add(n.ntfy(ctx, e))
		}()
	}
	if e.Notify.Push {
		wg.Add(1)
		go func() {
			defer wg.Done()
			add(n.push(ctx, e))
		}()
	}
	wg.Wait()
	return out
}

// webhook POSTs the message using JSON bodies as application/json, anything else as text/plain.
func (n *Notifier) webhook(ctx context.Context, u, msg string) Delivery {
	ct := "text/plain; charset=utf-8"
	if json.Valid([]byte(msg)) && strings.HasPrefix(strings.TrimSpace(msg), "{") {
		ct = "application/json"
	}
	var last error
	for attempt := 0; attempt < 2; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return Delivery{Channel: "webhook", Detail: ctx.Err().Error()}
			case <-time.After(n.RetryDelay):
			}
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, strings.NewReader(msg))
		if err != nil {
			return Delivery{Channel: "webhook", Detail: err.Error()}
		}
		req.Header.Set("Content-Type", ct)
		req.Header.Set("User-Agent", "TitanView-Alerts/1")
		resp, err := n.HTTP.Do(req)
		if err != nil {
			last = err
			continue
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		resp.Body.Close()
		if resp.StatusCode < 300 {
			return Delivery{Channel: "webhook", OK: true, Detail: fmt.Sprintf("HTTP %d", resp.StatusCode)}
		}
		last = fmt.Errorf("HTTP %d", resp.StatusCode)
		if resp.StatusCode < 500 && resp.StatusCode != http.StatusTooManyRequests {
			break // 4xx: retrying will not help
		}
	}
	return Delivery{Channel: "webhook", Detail: last.Error()}
}

func (n *Notifier) telegram(ctx context.Context, e LogEntry) Delivery {
	cfg, err := n.Telegram(ctx)
	if err != nil {
		return Delivery{Channel: "telegram", Detail: err.Error()}
	}
	if err := n.SendTelegram(ctx, cfg, telegramText(e)); err != nil {
		return Delivery{Channel: "telegram", Detail: err.Error()}
	}
	return Delivery{Channel: "telegram", OK: true}
}

func telegramText(e LogEntry) string {
	head := e.Name
	if head == "" {
		head = e.Symbol
	}
	return fmt.Sprintf("🔔 %s\n%s · %s\n%s", head, e.Symbol, e.Interval, e.Message)
}

// SendTelegram posts text through the Bot API.
func (n *Notifier) SendTelegram(ctx context.Context, cfg TelegramConfig, text string) error {
	if !cfg.Enabled || cfg.Token == "" || cfg.ChatID == "" {
		return errors.New("Telegram yapılandırılmamış (bot anahtarı + sohbet kimliği)")
	}
	body, _ := json.Marshal(map[string]any{"chat_id": cfg.ChatID, "text": text, "disable_web_page_preview": true})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, n.TelegramBase+"/bot"+cfg.Token+"/sendMessage", bytes.NewReader(body))
	if err != nil {
		return errors.New("Telegram isteği kurulamadı")
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := n.HTTP.Do(req)
	if err != nil {
		// never echo the URL: it carries the bot token
		return errors.New("Telegram'a ulaşılamadı")
	}
	defer resp.Body.Close()
	var r struct {
		OK          bool   `json:"ok"`
		Description string `json:"description"`
	}
	_ = json.NewDecoder(io.LimitReader(resp.Body, 8192)).Decode(&r)
	if !r.OK {
		if r.Description == "" {
			r.Description = fmt.Sprintf("HTTP %d", resp.StatusCode)
		}
		return fmt.Errorf("Telegram: %s", r.Description)
	}
	return nil
}

// PushPayload is what the service worker receives.
type PushPayload struct {
	Title   string `json:"title"`
	Body    string `json:"body"`
	AlertID string `json:"alertId"`
	Symbol  string `json:"symbol"`
	Tag     string `json:"tag"`
	Time    int64  `json:"time"`
}

func (n *Notifier) push(ctx context.Context, e LogEntry) Delivery {
	title := e.Name
	if title == "" {
		title = "Alarm: " + e.Symbol
	}
	payload, _ := json.Marshal(PushPayload{Title: title, Body: e.Message, AlertID: e.AlertID, Symbol: e.Symbol, Tag: "alert-" + e.AlertID, Time: e.Time})
	sent, failed, err := n.PushAll(ctx, payload)
	if err != nil {
		return Delivery{Channel: "push", Detail: err.Error()}
	}
	if sent == 0 {
		detail := "abone tarayıcı yok"
		if failed > 0 {
			detail = fmt.Sprintf("%d abonelik başarısız", failed)
		}
		return Delivery{Channel: "push", Detail: detail}
	}
	return Delivery{Channel: "push", OK: true, Detail: fmt.Sprintf("%d tarayıcı", sent)}
}

// PushAll sends payload to every subscription; gone subscriptions are deleted.
func (n *Notifier) PushAll(ctx context.Context, payload []byte) (sent, failed int, err error) {
	v, err := n.VAPID(ctx)
	if err != nil {
		return 0, 0, err
	}
	subs, err := n.Store.PushSubs(ctx)
	if err != nil {
		return 0, 0, err
	}
	for _, s := range subs {
		switch perr := SendPush(ctx, n.HTTP, v, s, payload); {
		case perr == nil:
			sent++
		case errors.Is(perr, ErrGone):
			_ = n.Store.RemovePushSub(ctx, s.Endpoint)
			failed++
		default:
			failed++
		}
	}
	return sent, failed, nil
}

// Broadcaster fans new log entries out to SSE listeners (the open UIs).
type Broadcaster struct {
	mu   sync.Mutex
	subs map[chan LogEntry]struct{}
}

// NewBroadcaster creates an empty broadcaster.
func NewBroadcaster() *Broadcaster { return &Broadcaster{subs: map[chan LogEntry]struct{}{}} }

// Subscribe registers a listener; call cancel when done.
func (b *Broadcaster) Subscribe() (<-chan LogEntry, func()) {
	ch := make(chan LogEntry, 32)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()
	return ch, func() {
		b.mu.Lock()
		if _, ok := b.subs[ch]; ok {
			delete(b.subs, ch)
			close(ch)
		}
		b.mu.Unlock()
	}
}

// Publish sends e to every listener without blocking (slow listeners drop entries and re-read the log).
func (b *Broadcaster) Publish(e LogEntry) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.subs {
		select {
		case ch <- e:
		default:
		}
	}
}

// Count reports active listeners.
func (b *Broadcaster) Count() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.subs)
}
