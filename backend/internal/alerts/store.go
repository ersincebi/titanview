package alerts

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

// Store persists alerts, the firing log, Web Push subscriptions and small key/value config in SQLite.
type Store struct {
	db *sql.DB
}

// ErrNotFound is returned for unknown alert ids.
var ErrNotFound = errors.New("alert not found")

// MaxLog bounds the log table (oldest rows are pruned).
const MaxLog = 2000

// NewStore creates the alert tables (idempotent) on an existing SQLite handle.
func NewStore(db *sql.DB) (*Store, error) {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS alerts (id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS alert_log (id INTEGER PRIMARY KEY AUTOINCREMENT, alert_id TEXT NOT NULL, time INTEGER NOT NULL, body TEXT NOT NULL)`,
		`CREATE INDEX IF NOT EXISTS idx_alert_log_alert ON alert_log(alert_id)`,
		`CREATE TABLE IF NOT EXISTS alert_push_subs (endpoint TEXT PRIMARY KEY, body TEXT NOT NULL, created_at INTEGER NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS alert_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			return nil, err
		}
	}
	return &Store{db: db}, nil
}

// List returns every alert, newest first.
func (s *Store) List(ctx context.Context) ([]Alert, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT body FROM alerts ORDER BY updated_at DESC, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Alert{}
	for rows.Next() {
		var body string
		if err := rows.Scan(&body); err != nil {
			return nil, err
		}
		var a Alert
		if json.Unmarshal([]byte(body), &a) == nil {
			out = append(out, a)
		}
	}
	return out, rows.Err()
}

// Get loads one alert.
func (s *Store) Get(ctx context.Context, id string) (Alert, error) {
	var body string
	err := s.db.QueryRowContext(ctx, `SELECT body FROM alerts WHERE id = ?`, id).Scan(&body)
	if errors.Is(err, sql.ErrNoRows) {
		return Alert{}, ErrNotFound
	}
	if err != nil {
		return Alert{}, err
	}
	var a Alert
	return a, json.Unmarshal([]byte(body), &a)
}

// Put inserts or replaces an alert.
func (s *Store) Put(ctx context.Context, a Alert) error {
	body, err := json.Marshal(a)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO alerts(id, body, updated_at) VALUES(?,?,?)
		ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`, a.ID, string(body), a.UpdatedAt)
	return err
}

// Delete removes an alert (its log entries are preserved).
func (s *Store) Delete(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM alerts WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// AppendLog stores a firing and returns it with its id; old rows beyond MaxLog are pruned.
func (s *Store) AppendLog(ctx context.Context, e LogEntry) (LogEntry, error) {
	body, err := json.Marshal(e)
	if err != nil {
		return e, err
	}
	res, err := s.db.ExecContext(ctx, `INSERT INTO alert_log(alert_id, time, body) VALUES(?,?,?)`, e.AlertID, e.Time, string(body))
	if err != nil {
		return e, err
	}
	e.ID, _ = res.LastInsertId()
	_, _ = s.db.ExecContext(ctx, `DELETE FROM alert_log WHERE id <= ?`, e.ID-MaxLog)
	return e, nil
}

// UpdateLog rewrites an entry (deliveries are filled in after the channels answer).
func (s *Store) UpdateLog(ctx context.Context, e LogEntry) error {
	body, err := json.Marshal(e)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `UPDATE alert_log SET body = ? WHERE id = ?`, string(body), e.ID)
	return err
}

// Log returns entries with id > after, newest first, at most limit.
func (s *Store) Log(ctx context.Context, after int64, limit int) ([]LogEntry, error) {
	if limit <= 0 || limit > MaxLog {
		limit = 200
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, body FROM alert_log WHERE id > ? ORDER BY id DESC LIMIT ?`, after, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LogEntry{}
	for rows.Next() {
		var id int64
		var body string
		if err := rows.Scan(&id, &body); err != nil {
			return nil, err
		}
		var e LogEntry
		if json.Unmarshal([]byte(body), &e) == nil {
			e.ID = id
			out = append(out, e)
		}
	}
	return out, rows.Err()
}

// ClearLog empties the log.
func (s *Store) ClearLog(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM alert_log`)
	return err
}

// PushSubscription is a browser PushSubscription.toJSON().
type PushSubscription struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

// AddPushSub stores (or refreshes) a subscription.
func (s *Store) AddPushSub(ctx context.Context, sub PushSubscription) error {
	body, _ := json.Marshal(sub)
	_, err := s.db.ExecContext(ctx, `INSERT INTO alert_push_subs(endpoint, body, created_at) VALUES(?,?,?)
		ON CONFLICT(endpoint) DO UPDATE SET body = excluded.body`, sub.Endpoint, string(body), time.Now().Unix())
	return err
}

// RemovePushSub deletes a subscription by endpoint.
func (s *Store) RemovePushSub(ctx context.Context, endpoint string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM alert_push_subs WHERE endpoint = ?`, endpoint)
	return err
}

// PushSubs lists every subscription.
func (s *Store) PushSubs(ctx context.Context) ([]PushSubscription, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT body FROM alert_push_subs ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PushSubscription
	for rows.Next() {
		var body string
		if err := rows.Scan(&body); err != nil {
			return nil, err
		}
		var p PushSubscription
		if json.Unmarshal([]byte(body), &p) == nil {
			out = append(out, p)
		}
	}
	return out, rows.Err()
}

// GetKV reads a config value ("" when unset).
func (s *Store) GetKV(ctx context.Context, key string) (string, error) {
	var v string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM alert_kv WHERE key = ?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return v, err
}

// SetKV writes a config value.
func (s *Store) SetKV(ctx context.Context, key, value string) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO alert_kv(key, value) VALUES(?,?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}
