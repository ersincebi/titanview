package alerts

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// NtfyConfig is the phone push channel (Faz 33). ntfy is an open-source push
// service with iOS/Android apps; the user may self-host it. The server posts
// to <Server>/<Topic>; the phone subscribed to that topic gets a native push
// even when TitanView is closed. No Firebase/APNs account is needed.
type NtfyConfig struct {
	Enabled bool   `json:"enabled"`
	Server  string `json:"server"`          // default https://ntfy.sh
	Topic   string `json:"topic"`           // long, unguessable topic name
	Token   string `json:"token,omitempty"` // optional access token (write-only)
}

// DefaultNtfyServer is used when Server is empty.
const DefaultNtfyServer = "https://ntfy.sh"

func (c NtfyConfig) endpoint() (string, error) {
	srv := strings.TrimRight(strings.TrimSpace(c.Server), "/")
	if srv == "" {
		srv = DefaultNtfyServer
	}
	u, err := url.Parse(srv)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return "", errors.New("ntfy sunucusu http(s) adresi olmalı")
	}
	topic := strings.TrimSpace(c.Topic)
	if len(topic) < 6 || strings.ContainsAny(topic, "/?#& ") {
		return "", errors.New("ntfy konusu en az 6 karakter, boşluk ve / ? # & içermez")
	}
	return srv + "/" + url.PathEscape(topic), nil
}

// Ntfy reads the stored ntfy config.
func (n *Notifier) Ntfy(ctx context.Context) (NtfyConfig, error) {
	var c NtfyConfig
	raw, err := n.Store.GetKV(ctx, "ntfy")
	if err != nil || raw == "" {
		return c, err
	}
	return c, json.Unmarshal([]byte(raw), &c)
}

// SetNtfy saves the config; an empty token keeps the stored one.
func (n *Notifier) SetNtfy(ctx context.Context, c NtfyConfig) error {
	if c.Token == "" {
		old, _ := n.Ntfy(ctx)
		c.Token = old.Token
	}
	c.Server, c.Topic, c.Token = strings.TrimSpace(c.Server), strings.TrimSpace(c.Topic), strings.TrimSpace(c.Token)
	if c.Enabled {
		if _, err := c.endpoint(); err != nil {
			return err
		}
	}
	raw, _ := json.Marshal(c)
	return n.Store.SetKV(ctx, "ntfy", string(raw))
}

func (n *Notifier) ntfy(ctx context.Context, e LogEntry) Delivery {
	cfg, err := n.Ntfy(ctx)
	if err != nil {
		return Delivery{Channel: "ntfy", Detail: err.Error()}
	}
	if err := n.SendNtfy(ctx, cfg, e); err != nil {
		return Delivery{Channel: "ntfy", Detail: err.Error()}
	}
	return Delivery{Channel: "ntfy", OK: true}
}

// SendNtfy publishes one firing.
func (n *Notifier) SendNtfy(ctx context.Context, cfg NtfyConfig, e LogEntry) error {
	if !cfg.Enabled {
		return errors.New("ntfy yapılandırılmamış")
	}
	ep, err := cfg.endpoint()
	if err != nil {
		return err
	}
	title := e.Name
	if title == "" {
		title = e.Symbol
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, ep, strings.NewReader(e.Message))
	if err != nil {
		return err
	}
	req.Header.Set("Title", headerSafe(fmt.Sprintf("%s · %s %s", title, e.Symbol, e.Interval)))
	req.Header.Set("Tags", "bell")
	req.Header.Set("Priority", "high")
	req.Header.Set("User-Agent", "TitanView-Alerts/1")
	if cfg.Token != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.Token)
	}
	resp, err := n.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("ntfy HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

// headerSafe keeps a header value on one line (ntfy accepts UTF-8 titles).
func headerSafe(s string) string {
	return strings.Map(func(r rune) rune {
		if r == '\r' || r == '\n' {
			return ' '
		}
		return r
	}, s)
}
