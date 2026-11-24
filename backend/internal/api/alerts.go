package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ersincebi/titanview/backend/internal/alerts"
	"github.com/ersincebi/titanview/backend/internal/domain"
	"github.com/ersincebi/titanview/backend/internal/scriptjs"
)

// AlertService bundles the server-side alert engine (Faz 23).
type AlertService struct {
	Engine   *alerts.Engine
	Store    *alerts.Store
	Notifier *alerts.Notifier
	Bus      *alerts.Broadcaster
}

// coordHistory adapts the cache coordinator to alerts.History.
type coordHistory struct{ s *Server }

func (h coordHistory) Candles(ctx context.Context, symbol, interval string, bars int) ([]domain.Candle, error) {
	step := domain.TimeframeSeconds(interval)
	now := time.Now().Unix()
	span := int64(bars) * step
	if domain.ResolveSymbolInfo(symbol).Provider != domain.ProviderBinance && step < 86400 {
		span *= 4 // sessions + weekends: ~1/4 of wall-clock time has bars
	} else if step >= 86400 && domain.ResolveSymbolInfo(symbol).Provider != domain.ProviderBinance {
		span = span * 3 / 2
	}
	res, err := h.s.Coord.GetHistory(ctx, symbol, interval, now-span, now)
	if err != nil {
		return nil, err
	}
	cs := res.Candles
	if len(cs) > bars {
		cs = cs[len(cs)-bars:]
	}
	return cs, nil
}

// EnableAlerts creates the alert engine on the server's SQLite database. Call Run on the returned engine.
func (s *Server) EnableAlerts() (*alerts.Engine, error) {
	st, err := alerts.NewStore(s.Coord.Store.DB())
	if err != nil {
		return nil, err
	}
	n := alerts.NewNotifier(st)
	bus := alerts.NewBroadcaster()
	var live alerts.Live
	if s.Hub != nil {
		live = s.Hub
	}
	eng := alerts.NewEngine(st, n, bus, coordHistory{s}, live, scriptjs.NewPool(2))
	eng.Scripts = func(ctx context.Context) []scriptjs.Script {
		list, err := s.Coord.Store.ListScripts(ctx)
		if err != nil {
			return nil
		}
		out := make([]scriptjs.Script, 0, len(list))
		for _, sc := range list {
			out = append(out, scriptjs.Script{Name: sc.Name, Code: sc.Code})
		}
		return out
	}
	s.Alerts = &AlertService{Engine: eng, Store: st, Notifier: n, Bus: bus}
	return eng, nil
}

func (s *Server) alertsReady(w http.ResponseWriter) bool {
	if s.Alerts == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "alert engine disabled")
		return false
	}
	return true
}

func readAlert(w http.ResponseWriter, r *http.Request) (alerts.Alert, bool) {
	var a alerts.Alert
	body, err := io.ReadAll(io.LimitReader(r.Body, 512<<10))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "read body")
		return a, false
	}
	if err := json.Unmarshal(body, &a); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid alert json")
		return a, false
	}
	return a, true
}

func alertErr(w http.ResponseWriter, err error) {
	if errors.Is(err, alerts.ErrNotFound) {
		writeJSONError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSONError(w, http.StatusBadRequest, err.Error())
}

// GET /api/alerts | POST /api/alerts | PUT /api/alerts?id= | DELETE /api/alerts?id=
func (s *Server) handleAlerts(w http.ResponseWriter, r *http.Request) {
	if !s.alertsReady(w) {
		return
	}
	eng := s.Alerts.Engine
	id := r.URL.Query().Get("id")
	switch r.Method {
	case http.MethodGet:
		if id != "" {
			a, ok := eng.Get(id)
			if !ok {
				writeJSONError(w, http.StatusNotFound, "alert not found")
				return
			}
			writeJSON(w, http.StatusOK, a)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"alerts": eng.List(), "feeds": eng.Groups()})
	case http.MethodPost:
		a, ok := readAlert(w, r)
		if !ok {
			return
		}
		out, err := eng.Create(r.Context(), a)
		if err != nil {
			alertErr(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, out)
	case http.MethodPut:
		a, ok := readAlert(w, r)
		if !ok {
			return
		}
		out, err := eng.Update(r.Context(), id, a)
		if err != nil {
			alertErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, out)
	case http.MethodDelete:
		if err := eng.Delete(r.Context(), id); err != nil {
			alertErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"deleted": id})
	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// POST /api/alerts/action?do=stop|restart|clone&id=…  or  ?do=stop_all|restart_all|delete_all|delete_inactive
func (s *Server) handleAlertAction(w http.ResponseWriter, r *http.Request) {
	if !s.alertsReady(w) {
		return
	}
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	eng := s.Alerts.Engine
	id, do := r.URL.Query().Get("id"), r.URL.Query().Get("do")
	var (
		out alerts.Alert
		err error
	)
	switch do {
	case "stop":
		out, err = eng.SetActive(r.Context(), id, false)
	case "restart":
		out, err = eng.SetActive(r.Context(), id, true)
	case "clone":
		out, err = eng.Clone(r.Context(), id)
	case "stop_all", "restart_all", "delete_all", "delete_inactive":
		n, berr := eng.Bulk(r.Context(), do)
		if berr != nil {
			alertErr(w, berr)
			return
		}
		writeJSON(w, http.StatusOK, map[string]int{"affected": n})
		return
	default:
		writeJSONError(w, http.StatusBadRequest, "do: stop|restart|clone|stop_all|restart_all|delete_all|delete_inactive")
		return
	}
	if err != nil {
		alertErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// GET /api/alerts/log?after=<id>&limit=  |  DELETE /api/alerts/log
func (s *Server) handleAlertLog(w http.ResponseWriter, r *http.Request) {
	if !s.alertsReady(w) {
		return
	}
	switch r.Method {
	case http.MethodGet:
		after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		list, err := s.Alerts.Store.Log(r.Context(), after, limit)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"log": list})
	case http.MethodDelete:
		if err := s.Alerts.Store.ClearLog(r.Context()); err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"cleared": true})
	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// GET /api/alerts/stream — Server-Sent Events: one "alert" event per firing (and again with deliveries).
func (s *Server) handleAlertStream(w http.ResponseWriter, r *http.Request) {
	if !s.alertsReady(w) {
		return
	}
	fl, ok := w.(http.Flusher)
	if !ok {
		writeJSONError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	ch, cancel := s.Alerts.Bus.Subscribe()
	defer cancel()
	_, _ = fmt.Fprint(w, "retry: 3000\n: connected\n\n")
	fl.Flush()
	ping := time.NewTicker(25 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ping.C:
			_, _ = fmt.Fprint(w, ": ping\n\n")
			fl.Flush()
		case e, open := <-ch:
			if !open {
				return
			}
			b, _ := json.Marshal(e)
			_, _ = fmt.Fprintf(w, "id: %d\nevent: alert\ndata: %s\n\n", e.ID, b)
			fl.Flush()
		}
	}
}

type alertConfigView struct {
	Telegram struct {
		Enabled  bool   `json:"enabled"`
		ChatID   string `json:"chatId"`
		TokenSet bool   `json:"tokenSet"`
		// Token is write-only: accepted on PUT, never returned.
		Token string `json:"token,omitempty"`
	} `json:"telegram"`
	Ntfy struct {
		Enabled  bool   `json:"enabled"`
		Server   string `json:"server"`
		Topic    string `json:"topic"`
		TokenSet bool   `json:"tokenSet"`
		Token    string `json:"token,omitempty"` // write-only
	} `json:"ntfy"`
	PushSubscriptions int `json:"pushSubscriptions"`
}

// GET/PUT /api/alerts/config — Telegram bot settings (the token is write-only).
func (s *Server) handleAlertConfig(w http.ResponseWriter, r *http.Request) {
	if !s.alertsReady(w) {
		return
	}
	n := s.Alerts.Notifier
	switch r.Method {
	case http.MethodGet:
	case http.MethodPut:
		var in alertConfigView
		if err := json.NewDecoder(io.LimitReader(r.Body, 8192)).Decode(&in); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid config json")
			return
		}
		if err := n.SetTelegram(r.Context(), alerts.TelegramConfig{Enabled: in.Telegram.Enabled, ChatID: in.Telegram.ChatID, Token: in.Telegram.Token}); err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if in.Ntfy.Enabled || in.Ntfy.Topic != "" || in.Ntfy.Server != "" {
			if err := n.SetNtfy(r.Context(), alerts.NtfyConfig{Enabled: in.Ntfy.Enabled, Server: in.Ntfy.Server, Topic: in.Ntfy.Topic, Token: in.Ntfy.Token}); err != nil {
				writeJSONError(w, http.StatusBadRequest, err.Error())
				return
			}
		}
	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	cfg, err := n.Telegram(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	var v alertConfigView
	v.Telegram.Enabled, v.Telegram.ChatID, v.Telegram.TokenSet = cfg.Enabled, cfg.ChatID, cfg.Token != ""
	if nc, err := n.Ntfy(r.Context()); err == nil {
		v.Ntfy.Enabled, v.Ntfy.Server, v.Ntfy.Topic, v.Ntfy.TokenSet = nc.Enabled, nc.Server, nc.Topic, nc.Token != ""
	}
	subs, _ := s.Alerts.Store.PushSubs(r.Context())
	v.PushSubscriptions = len(subs)
	writeJSON(w, http.StatusOK, v)
}

// POST /api/alerts/test?channel=telegram|ntfy|push|webhook[&url=] — sends a test message through one channel.
func (s *Server) handleAlertTest(w http.ResponseWriter, r *http.Request) {
	if !s.alertsReady(w) {
		return
	}
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	q := r.URL.Query()
	e := alerts.LogEntry{AlertID: "test", Name: "TitanView test alarmı", Symbol: "TEST", Interval: "-", Time: time.Now().UnixMilli(), Message: "TitanView alarm testi ✅"}
	switch q.Get("channel") {
	case "telegram":
		e.Notify.Telegram = true
	case "push":
		e.Notify.Push = true
	case "ntfy":
		e.Notify.Ntfy = true
	case "webhook":
		e.Notify.Webhook = q.Get("url")
		probe := alerts.Alert{Symbol: "X", Notify: e.Notify, Kind: alerts.KindScript, ScriptEvent: alerts.ScriptAlertCalls, Study: &alerts.Study{Code: "x"}}
		if err := probe.Normalize(); err != nil || e.Notify.Webhook == "" {
			writeJSONError(w, http.StatusBadRequest, "webhook must be an http(s) URL")
			return
		}
	default:
		writeJSONError(w, http.StatusBadRequest, "channel: telegram|ntfy|push|webhook")
		return
	}
	ds := s.Alerts.Notifier.Deliver(r.Context(), e)
	if len(ds) == 0 {
		writeJSONError(w, http.StatusBadRequest, "no channel")
		return
	}
	status := http.StatusOK
	if !ds[0].OK {
		status = http.StatusBadGateway
	}
	writeJSON(w, status, ds[0])
}

// GET /api/alerts/push/key — VAPID public key (applicationServerKey).
func (s *Server) handlePushKey(w http.ResponseWriter, r *http.Request) {
	if !s.alertsReady(w) {
		return
	}
	v, err := s.Alerts.Notifier.VAPID(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"publicKey": v.PublicB64()})
}

// POST /api/alerts/push/subscribe (PushSubscription JSON) | DELETE /api/alerts/push/subscribe?endpoint=
func (s *Server) handlePushSubscribe(w http.ResponseWriter, r *http.Request) {
	if !s.alertsReady(w) {
		return
	}
	switch r.Method {
	case http.MethodPost:
		var sub alerts.PushSubscription
		if err := json.NewDecoder(io.LimitReader(r.Body, 8192)).Decode(&sub); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid subscription")
			return
		}
		if !strings.HasPrefix(sub.Endpoint, "https://") || sub.Keys.P256dh == "" || sub.Keys.Auth == "" {
			writeJSONError(w, http.StatusBadRequest, "subscription needs an https endpoint and keys")
			return
		}
		if err := s.Alerts.Store.AddPushSub(r.Context(), sub); err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, map[string]bool{"subscribed": true})
	case http.MethodDelete:
		if err := s.Alerts.Store.RemovePushSub(r.Context(), r.URL.Query().Get("endpoint")); err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"subscribed": false})
	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
