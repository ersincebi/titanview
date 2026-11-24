package trading

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

// Store persists the paper account, its fill log and encrypted broker credentials.
// Tables are created here (idempotent) so the core schema version is untouched.
type Store struct {
	db *sql.DB
}

const (
	kvPaper   = "paper_account"
	kvBinance = "binance_credentials"
)

// NewStore creates the trading tables on an existing SQLite handle.
func NewStore(db *sql.DB) (*Store, error) {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS trading_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS trading_fills (id TEXT PRIMARY KEY, time INTEGER NOT NULL, body TEXT NOT NULL)`,
		`CREATE INDEX IF NOT EXISTS idx_trading_fills_time ON trading_fills(time)`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			return nil, err
		}
	}
	return &Store{db: db}, nil
}

func (s *Store) get(ctx context.Context, key string) (string, bool, error) {
	var v string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM trading_kv WHERE key = ?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	return v, err == nil, err
}

func (s *Store) put(ctx context.Context, key, value string) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO trading_kv(key, value, updated_at) VALUES(?,?,?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, key, value, time.Now().Unix())
	return err
}

func (s *Store) del(ctx context.Context, key string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM trading_kv WHERE key = ?`, key)
	return err
}

// LoadAccount returns the saved paper account (a fresh one when none exists).
func (s *Store) LoadAccount(ctx context.Context) (Account, error) {
	v, ok, err := s.get(ctx, kvPaper)
	if err != nil {
		return Account{}, err
	}
	if !ok {
		return NewAccount(DefaultInitialBalance, 0), nil
	}
	var a Account
	if err := json.Unmarshal([]byte(v), &a); err != nil {
		return Account{}, err
	}
	if a.Orders == nil {
		a.Orders = []Order{}
	}
	if a.Positions == nil {
		a.Positions = []Position{}
	}
	if a.Fills == nil {
		a.Fills = []Fill{}
	}
	if a.Closed == nil {
		a.Closed = []Order{}
	}
	return a, nil
}

// SaveAccount stores the account and appends new fills to the permanent log.
func (s *Store) SaveAccount(ctx context.Context, a Account, newFills []Fill) error {
	b, err := json.Marshal(a)
	if err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `INSERT INTO trading_kv(key, value, updated_at) VALUES(?,?,?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, kvPaper, string(b), time.Now().Unix()); err != nil {
		return err
	}
	for _, f := range newFills {
		fb, _ := json.Marshal(f)
		if _, err := tx.ExecContext(ctx, `INSERT OR REPLACE INTO trading_fills(id, time, body) VALUES(?,?,?)`, f.ID, f.Time, string(fb)); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ClearFills empties the permanent fill log (account reset).
func (s *Store) ClearFills(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM trading_fills`)
	return err
}

// FillLog returns up to limit fills, newest first.
func (s *Store) FillLog(ctx context.Context, limit int) ([]Fill, error) {
	if limit <= 0 || limit > 10000 {
		limit = 1000
	}
	rows, err := s.db.QueryContext(ctx, `SELECT body FROM trading_fills ORDER BY time DESC, id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Fill{}
	for rows.Next() {
		var body string
		if err := rows.Scan(&body); err != nil {
			return nil, err
		}
		var f Fill
		if json.Unmarshal([]byte(body), &f) == nil {
			out = append(out, f)
		}
	}
	return out, rows.Err()
}
