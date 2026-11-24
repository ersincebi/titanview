package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
	_ "github.com/mattn/go-sqlite3"
)

// SQLiteStore manages the local SQLite database for candles, custom TitanScript scripts, drawings, and symbols.
type SQLiteStore struct {
	db *sql.DB
}

// SavedScript represents a user-saved TitanScript indicator or strategy.
type SavedScript struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Code      string `json:"code"`
	IsOverlay bool   `json:"isOverlay"`
	UpdatedAt int64  `json:"updatedAt"`
}

// SavedDrawing represents a chart drawing object persisted per symbol, timeframe & optional layout scope.
type SavedDrawing struct {
	ID         string `json:"id"`
	Symbol     string `json:"symbol"`
	Timeframe  string `json:"timeframe"`
	ToolType   string `json:"toolType"`
	PointsJSON string `json:"pointsJson"`
	StyleJSON  string `json:"styleJson"`
	LayoutID   string `json:"layoutId,omitempty"`
	CreatedAt  int64  `json:"createdAt"`
}

// CacheStats reports the health and size of the local SQLite cache.
type CacheStats struct {
	TotalCandles  int64   `json:"totalCandles"`
	TotalSymbols  int64   `json:"totalSymbols"`
	SavedScripts  int64   `json:"savedScripts"`
	SavedDrawings int64   `json:"savedDrawings"`
	DiskSizeBytes int64   `json:"diskSizeBytes"`
	DiskSizeMB    float64 `json:"diskSizeMb"`
	TotalRequests int64   `json:"totalRequests,omitempty"`
	CacheHits     int64   `json:"cacheHits,omitempty"`
	CacheHitRatio float64 `json:"cacheHitRatio,omitempty"`
	ActiveClients int     `json:"activeClients,omitempty"`
	ActiveWorkers int     `json:"activeWorkers,omitempty"`
}

// NewSQLiteStore opens/creates the SQLite database file and configures WAL mode and tables.
func NewSQLiteStore(dbPath string) (*SQLiteStore, error) {
	if dbPath != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
			return nil, fmt.Errorf("failed to create db directory: %w", err)
		}
	}

	dsn := dbPath
	if dbPath != ":memory:" {
		dsn = fmt.Sprintf("%s?_journal_mode=WAL&_synchronous=NORMAL&_busy_timeout=5000&_foreign_keys=on", dbPath)
	}

	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite: %w", err)
	}

	db.SetMaxOpenConns(16)
	db.SetMaxIdleConns(8)
	db.SetConnMaxLifetime(30 * time.Minute)

	store := &SQLiteStore{db: db}
	if err := store.initSchema(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *SQLiteStore) initSchema() error {
	pragmas := []string{
		"PRAGMA journal_mode = WAL;",
		"PRAGMA synchronous = NORMAL;",
		"PRAGMA temp_store = MEMORY;",
		"PRAGMA cache_size = -64000;",
		"PRAGMA busy_timeout = 5000;",
	}
	for _, p := range pragmas {
		if _, err := s.db.Exec(p); err != nil {
			return fmt.Errorf("pragma %s failed: %w", p, err)
		}
	}

	schema := `
	CREATE TABLE IF NOT EXISTS candles (
		symbol    TEXT    NOT NULL,
		timeframe TEXT    NOT NULL,
		timestamp INTEGER NOT NULL,
		open      REAL    NOT NULL,
		high      REAL    NOT NULL,
		low       REAL    NOT NULL,
		close     REAL    NOT NULL,
		volume    REAL    NOT NULL,
		PRIMARY KEY (symbol, timeframe, timestamp)
	) WITHOUT ROWID;

	CREATE TABLE IF NOT EXISTS fetched_ranges (
		symbol    TEXT    NOT NULL,
		timeframe TEXT    NOT NULL,
		min_ts    INTEGER NOT NULL,
		max_ts    INTEGER NOT NULL,
		PRIMARY KEY (symbol, timeframe)
	) WITHOUT ROWID;

	CREATE TABLE IF NOT EXISTS scripts (
		id         TEXT PRIMARY KEY,
		name       TEXT NOT NULL,
		code       TEXT NOT NULL,
		is_overlay INTEGER NOT NULL DEFAULT 1,
		updated_at INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS script_versions (
		script_id  TEXT    NOT NULL,
		version    INTEGER NOT NULL,
		name       TEXT    NOT NULL,
		code       TEXT    NOT NULL,
		created_at INTEGER NOT NULL,
		PRIMARY KEY (script_id, version)
	) WITHOUT ROWID;

	CREATE TABLE IF NOT EXISTS drawings (
		id          TEXT PRIMARY KEY,
		symbol      TEXT NOT NULL,
		timeframe   TEXT NOT NULL,
		tool_type   TEXT NOT NULL,
		points_json TEXT NOT NULL,
		style_json  TEXT NOT NULL,
		layout_id   TEXT NOT NULL DEFAULT '',
		created_at  INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_drawings_sym_tf ON drawings(symbol, timeframe);

	CREATE TABLE IF NOT EXISTS layouts (
		id          TEXT PRIMARY KEY,
		name        TEXT NOT NULL,
		state_json  TEXT NOT NULL,
		grid_id     TEXT NOT NULL DEFAULT 'single',
		chart_count INTEGER NOT NULL DEFAULT 1,
		symbols     TEXT NOT NULL DEFAULT '',
		autosave    INTEGER NOT NULL DEFAULT 1,
		is_shared   INTEGER NOT NULL DEFAULT 0,
		share_token TEXT NOT NULL DEFAULT '',
		created_at  INTEGER NOT NULL,
		updated_at  INTEGER NOT NULL
	);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_layouts_share_token ON layouts(share_token) WHERE share_token != '';

	CREATE TABLE IF NOT EXISTS app_settings (
		key        TEXT PRIMARY KEY,
		value      TEXT NOT NULL,
		updated_at INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS collect_symbols (
		symbol   TEXT PRIMARY KEY,
		added_at INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS watchlists (
		id         TEXT PRIMARY KEY,
		name       TEXT NOT NULL,
		items_json TEXT NOT NULL,
		is_default INTEGER NOT NULL DEFAULT 0,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS symbol_flags (
		symbol     TEXT PRIMARY KEY,
		color      TEXT NOT NULL,
		updated_at INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS symbol_notes (
		id             TEXT PRIMARY KEY,
		symbol         TEXT NOT NULL,
		title          TEXT NOT NULL,
		body           TEXT NOT NULL,
		tags           TEXT NOT NULL DEFAULT '',
		sentiment      TEXT NOT NULL DEFAULT 'neutral',
		snapshot_price REAL NOT NULL DEFAULT 0,
		timeframe      TEXT NOT NULL DEFAULT '',
		pinned         INTEGER NOT NULL DEFAULT 0,
		created_at     INTEGER NOT NULL,
		updated_at     INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_symbol_notes_sym ON symbol_notes(symbol, updated_at DESC);

	CREATE TABLE IF NOT EXISTS screener_presets (
		id          TEXT PRIMARY KEY,
		name        TEXT NOT NULL,
		market      TEXT NOT NULL DEFAULT 'ALL',
		timeframe   TEXT NOT NULL DEFAULT '1d',
		column_set  TEXT NOT NULL DEFAULT 'overview',
		config_json TEXT NOT NULL,
		created_at  INTEGER NOT NULL,
		updated_at  INTEGER NOT NULL
	);
	`
	if _, err := s.db.Exec(schema); err != nil {
		return err
	}
	return s.migrate()
}

// currentSchemaVersion is bumped whenever a migration is added to migrate().
const currentSchemaVersion = 8

// migrate applies versioned, idempotent migrations tracked in schema_version.
func (s *SQLiteStore) migrate() error {
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`); err != nil {
		return err
	}
	var ver int
	err := s.db.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM schema_version`).Scan(&ver)
	if err != nil {
		return err
	}
	if ver >= currentSchemaVersion {
		return nil
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if ver < 2 {
		// v2: earlier builds persisted simulated ticks and seeded fake candles (also marked as
		// "fetched"). The candle cache is re-fetchable, so drop it fully. Drawings/scripts are kept.
		for _, q := range []string{`DELETE FROM candles`, `DELETE FROM fetched_ranges`} {
			if _, err := tx.Exec(q); err != nil {
				return err
			}
		}
	}
	if ver < 3 {
		// v3: track when the live edge was last refreshed so the forming bar never goes stale.
		var has int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('fetched_ranges') WHERE name = 'fetched_at'`).Scan(&has); err != nil {
			return err
		}
		if has == 0 {
			if _, err := tx.Exec(`ALTER TABLE fetched_ranges ADD COLUMN fetched_at INTEGER NOT NULL DEFAULT 0`); err != nil {
				return err
			}
		}
	}
	if ver < 4 {
		// v4: Yahoo 4h bars are now session-aligned (BIST 10:00, US 09:30); drop UTC-aligned 4h cache for them.
		for _, q := range []string{
			`DELETE FROM candles WHERE timeframe = '4h' AND (symbol LIKE '%.IS' OR (symbol NOT LIKE '%USDT' AND symbol NOT LIKE '%USDC' AND symbol NOT LIKE '%BTC' AND symbol NOT LIKE '%FDUSD'))`,
			`DELETE FROM fetched_ranges WHERE timeframe = '4h' AND (symbol LIKE '%.IS' OR (symbol NOT LIKE '%USDT' AND symbol NOT LIKE '%USDC' AND symbol NOT LIKE '%BTC' AND symbol NOT LIKE '%FDUSD'))`,
		} {
			if _, err := tx.Exec(q); err != nil {
				return err
			}
		}
	}
	if ver < 5 {
		// v5: Yahoo's trailing off-grid "last trade" point had been stored as flat zero-volume bars.
		const stock = `symbol NOT LIKE '%USDT' AND symbol NOT LIKE '%USDC' AND symbol NOT LIKE '%BTC' AND symbol NOT LIKE '%FDUSD'`
		q := `DELETE FROM candles WHERE ` + stock + ` AND (
			(timeframe IN ('15m','30m','1h','4h') AND timestamp % 900 != 0) OR
			(timeframe = '5m' AND timestamp % 300 != 0) OR
			(timeframe IN ('1m','3m') AND timestamp % 60 != 0))`
		if _, err := tx.Exec(q); err != nil {
			return err
		}
		// BIST closing-auction prints after 18:00 Istanbul (15:00 UTC): flat, zero volume.
		if _, err := tx.Exec(`DELETE FROM candles WHERE symbol LIKE '%.IS' AND timeframe NOT IN ('1d','1w')
			AND volume = 0 AND open = high AND high = low AND (timestamp + 10800) % 86400 >= 64800`); err != nil {
			return err
		}
	}
	if ver < 6 {
		// v6: the live WebSocket persisted forming bars; a bar that closed while disconnected kept its
		// partial OHLC (e.g. BTCUSDT 1d 2026-11-12). Bars written after the last REST refresh are now
		// re-verified; reset every series' refresh mark once so existing caches heal without deletion.
		if _, err := tx.Exec(`UPDATE fetched_ranges SET fetched_at = 0`); err != nil {
			return err
		}
	}
	if ver < 7 {
		// v7: Faz 25 — saved multi-chart layouts + per-layout/slot drawing sync scopes.
		var hasLayoutCol int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('drawings') WHERE name = 'layout_id'`).Scan(&hasLayoutCol); err != nil {
			return err
		}
		if hasLayoutCol == 0 {
			if _, err := tx.Exec(`ALTER TABLE drawings ADD COLUMN layout_id TEXT NOT NULL DEFAULT ''`); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(`CREATE INDEX IF NOT EXISTS idx_drawings_sym_layout ON drawings(symbol, layout_id)`); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`DELETE FROM schema_version`); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO schema_version (version) VALUES (?)`, currentSchemaVersion); err != nil {
		return err
	}
	return tx.Commit()
}

// Close closes the underlying SQLite connection.
func (s *SQLiteStore) Close() error {
	return s.db.Close()
}

// GetCoverage returns the minimum and maximum timestamp currently cached in SQLite for (symbol, timeframe),
// merging both actual candle timestamps and recorded fetched_ranges (so closed market weekends/nights aren't re-fetched).
// Optimized to use O(log N) B-Tree index leaf seeks instead of full-table COUNT(*) scans.
func (s *SQLiteStore) GetCoverage(ctx context.Context, symbol, timeframe string) (minTs int64, maxTs int64, count int64, err error) {
	sym := domain.NormalizeSymbol(symbol)
	tf := domain.NormalizeTimeframe(timeframe)

	// Ultra-fast B-Tree index boundary lookup for MIN & MAX, plus COUNT(*)
	const query = `
		SELECT
			COALESCE((SELECT timestamp FROM candles WHERE symbol = ? AND timeframe = ? ORDER BY timestamp ASC LIMIT 1), 0),
			COALESCE((SELECT timestamp FROM candles WHERE symbol = ? AND timeframe = ? ORDER BY timestamp DESC LIMIT 1), 0),
			COUNT(*)
		FROM candles
		WHERE symbol = ? AND timeframe = ?
	`
	row := s.db.QueryRowContext(ctx, query, sym, tf, sym, tf, sym, tf)
	if err = row.Scan(&minTs, &maxTs, &count); err != nil {
		return
	}

	if count > 0 {
		var rMin, rMax int64
		if errRange := s.db.QueryRowContext(
			ctx,
			`SELECT min_ts, max_ts FROM fetched_ranges WHERE symbol = ? AND timeframe = ?`,
			sym, tf,
		).Scan(&rMin, &rMax); errRange == nil {
			if rMin > 0 && rMin < minTs {
				minTs = rMin
			}
			if rMax > maxTs {
				maxTs = rMax
			}
		}
	}
	return
}

// RecordFetchedRange updates the known fetched range for (symbol, timeframe) so non-trading weekend/overnight edges aren't repeatedly requested.
func (s *SQLiteStore) RecordFetchedRange(ctx context.Context, symbol, timeframe string, fromSec, toSec int64) error {
	return s.recordRange(ctx, symbol, timeframe, fromSec, toSec, true)
}

// RecordFetchedRangeHistoric records an older-history fetch without moving the live-edge refresh mark:
// bars written by the live feed after the last edge refresh stay "unverified" until the edge is re-fetched.
func (s *SQLiteStore) RecordFetchedRangeHistoric(ctx context.Context, symbol, timeframe string, fromSec, toSec int64) error {
	return s.recordRange(ctx, symbol, timeframe, fromSec, toSec, false)
}

func (s *SQLiteStore) recordRange(ctx context.Context, symbol, timeframe string, fromSec, toSec int64, touch bool) error {
	sym := domain.NormalizeSymbol(symbol)
	tf := domain.NormalizeTimeframe(timeframe)
	now := time.Now().Unix()
	fetched := now
	if !touch {
		fetched = 0
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO fetched_ranges (symbol, timeframe, min_ts, max_ts, fetched_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(symbol, timeframe) DO UPDATE SET
			min_ts = MIN(fetched_ranges.min_ts, excluded.min_ts),
			max_ts = MAX(fetched_ranges.max_ts, excluded.max_ts),
			fetched_at = CASE WHEN ? THEN excluded.fetched_at ELSE fetched_ranges.fetched_at END
	`, sym, tf, fromSec, toSec, fetched, touch)
	return err
}

// LastFetchedAt returns the unix time of the last upstream refresh attempt for (symbol, timeframe); 0 if never.
func (s *SQLiteStore) LastFetchedAt(ctx context.Context, symbol, timeframe string) int64 {
	var at int64
	_ = s.db.QueryRowContext(ctx,
		`SELECT fetched_at FROM fetched_ranges WHERE symbol = ? AND timeframe = ?`,
		domain.NormalizeSymbol(symbol), domain.NormalizeTimeframe(timeframe)).Scan(&at)
	return at
}

// TouchFetchedAt records a refresh attempt (even an empty one, e.g. market closed) without changing the range.
func (s *SQLiteStore) TouchFetchedAt(ctx context.Context, symbol, timeframe string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE fetched_ranges SET fetched_at = ? WHERE symbol = ? AND timeframe = ?`,
		time.Now().Unix(), domain.NormalizeSymbol(symbol), domain.NormalizeTimeframe(timeframe))
	return err
}

// ComputeMissingGaps determines which sub-ranges of [reqFrom, reqTo] are not yet cached in SQLite.
// If the requested range is already covered in disk, it returns an empty slice (0 upstream API requests!).
func ComputeMissingGaps(existingMin, existingMax, count, reqFrom, reqTo, tfSec int64) []domain.GapRange {
	if reqTo <= reqFrom {
		return nil
	}
	if tfSec <= 0 {
		tfSec = 900
	}
	if count == 0 || existingMin == 0 || existingMax == 0 {
		return []domain.GapRange{{From: reqFrom, To: reqTo}}
	}

	var gaps []domain.GapRange
	// Leading gap (older history than what we have cached)
	if reqFrom < existingMin-tfSec {
		leftEnd := existingMin - tfSec
		if leftEnd > reqTo {
			leftEnd = reqTo
		}
		if leftEnd > reqFrom {
			gaps = append(gaps, domain.GapRange{From: reqFrom, To: leftEnd})
		}
	}

	// Trailing gap (newer candles than what we have cached)
	if reqTo > existingMax+tfSec {
		rightStart := existingMax
		if rightStart < reqFrom {
			rightStart = reqFrom
		}
		if reqTo > rightStart {
			gaps = append(gaps, domain.GapRange{From: rightStart, To: reqTo})
		}
	}

	return gaps
}

// BatchUpsertCandles inserts or updates a batch of candles inside a single ACID transaction.
func (s *SQLiteStore) BatchUpsertCandles(ctx context.Context, candles []domain.Candle) error {
	if len(candles) == 0 {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO candles (symbol, timeframe, timestamp, open, high, low, close, volume)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(symbol, timeframe, timestamp) DO UPDATE SET
			open   = excluded.open,
			high   = excluded.high,
			low    = excluded.low,
			close  = excluded.close,
			volume = excluded.volume
	`)
	if err != nil {
		return fmt.Errorf("prepare upsert: %w", err)
	}
	defer stmt.Close()

	for _, c := range candles {
		sym := domain.NormalizeSymbol(c.Symbol)
		tf := domain.NormalizeTimeframe(c.Timeframe)
		if _, err := stmt.ExecContext(ctx, sym, tf, c.Timestamp, c.Open, c.High, c.Low, c.Close, c.Volume); err != nil {
			return fmt.Errorf("exec upsert for %s %d: %w", sym, c.Timestamp, err)
		}
	}

	return tx.Commit()
}

// QueryCandles retrieves ordered candles from SQLite for the specified symbol, timeframe, and [from, to] range.
// CountCandlesInRange: [from, to] aralığındaki önbellek mum sayısı (iç boşluk tespiti, Faz 30).
func (s *SQLiteStore) CountCandlesInRange(ctx context.Context, symbol, timeframe string, from, to int64) (int64, error) {
	var n int64
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM candles WHERE symbol = ? AND timeframe = ? AND timestamp >= ? AND timestamp <= ?`, symbol, timeframe, from, to).Scan(&n)
	return n, err
}

func (s *SQLiteStore) QueryCandles(ctx context.Context, symbol, timeframe string, from, to int64) ([]domain.Candle, error) {
	sym := domain.NormalizeSymbol(symbol)
	tf := domain.NormalizeTimeframe(timeframe)

	rows, err := s.db.QueryContext(ctx, `
		SELECT timestamp, open, high, low, close, volume
		FROM candles
		WHERE symbol = ? AND timeframe = ? AND timestamp >= ? AND timestamp <= ?
		ORDER BY timestamp ASC
	`, sym, tf, from, to)
	if err != nil {
		return nil, fmt.Errorf("query candles: %w", err)
	}
	defer rows.Close()

	var result []domain.Candle
	for rows.Next() {
		var c domain.Candle
		c.Symbol = sym
		c.Timeframe = tf
		if err := rows.Scan(&c.Timestamp, &c.Open, &c.High, &c.Low, &c.Close, &c.Volume); err != nil {
			return nil, fmt.Errorf("scan candle: %w", err)
		}
		result = append(result, c)
	}
	return result, rows.Err()
}

// GetLatestCandles returns the last N candles for a symbol/timeframe regardless of 'from' timestamp (useful when market is closed on weekends).
func (s *SQLiteStore) GetLatestCandles(ctx context.Context, symbol, timeframe string, limit int) ([]domain.Candle, error) {
	sym := domain.NormalizeSymbol(symbol)
	tf := domain.NormalizeTimeframe(timeframe)
	if limit <= 0 {
		limit = 500
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT timestamp, open, high, low, close, volume
		FROM (
			SELECT timestamp, open, high, low, close, volume
			FROM candles
			WHERE symbol = ? AND timeframe = ?
			ORDER BY timestamp DESC
			LIMIT ?
		)
		ORDER BY timestamp ASC
	`, sym, tf, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []domain.Candle
	for rows.Next() {
		var c domain.Candle
		c.Symbol = sym
		c.Timeframe = tf
		if err := rows.Scan(&c.Timestamp, &c.Open, &c.High, &c.Low, &c.Close, &c.Volume); err != nil {
			return nil, err
		}
		result = append(result, c)
	}
	return result, rows.Err()
}

// SaveScript upserts a custom TitanScript into SQLite.
func (s *SQLiteStore) SaveScript(ctx context.Context, sc SavedScript) error {
	overlayInt := 0
	if sc.IsOverlay {
		overlayInt = 1
	}
	if sc.UpdatedAt == 0 {
		sc.UpdatedAt = time.Now().Unix()
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO scripts (id, name, code, is_overlay, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name = excluded.name,
			code = excluded.code,
			is_overlay = excluded.is_overlay,
			updated_at = excluded.updated_at
	`, sc.ID, sc.Name, sc.Code, overlayInt, sc.UpdatedAt)
	if err != nil {
		return err
	}
	return s.recordScriptVersion(ctx, sc)
}

// ListScripts returns all saved custom TitanScript scripts.
func (s *SQLiteStore) ListScripts(ctx context.Context) ([]SavedScript, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, code, is_overlay, updated_at FROM scripts ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []SavedScript
	for rows.Next() {
		var item SavedScript
		var overlayInt int
		if err := rows.Scan(&item.ID, &item.Name, &item.Code, &overlayInt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		item.IsOverlay = overlayInt != 0
		out = append(out, item)
	}
	return out, rows.Err()
}

// DeleteScript removes a saved TitanScript by its ID.
func (s *SQLiteStore) DeleteScript(ctx context.Context, id string) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM script_versions WHERE script_id = ?`, id); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM scripts WHERE id = ?`, id)
	return err
}

// SaveDrawing persists a drawing object in SQLite.
func (s *SQLiteStore) SaveDrawing(ctx context.Context, d SavedDrawing) error {
	if d.CreatedAt == 0 {
		d.CreatedAt = time.Now().Unix()
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO drawings (id, symbol, timeframe, tool_type, points_json, style_json, layout_id, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			points_json = excluded.points_json,
			style_json  = excluded.style_json,
			layout_id   = excluded.layout_id
	`, d.ID, domain.NormalizeSymbol(d.Symbol), domain.NormalizeTimeframe(d.Timeframe), d.ToolType, d.PointsJSON, d.StyleJSON, d.LayoutID, d.CreatedAt)
	return err
}

// ListDrawings returns all global saved drawings for a symbol (backward compatible).
func (s *SQLiteStore) ListDrawings(ctx context.Context, symbol string) ([]SavedDrawing, error) {
	return s.ListDrawingsForScope(ctx, symbol, "", true)
}

// ListDrawingsForScope returns drawings matching symbol and scope:
// - layoutID == "": global drawings (layout_id = ”)
// - layoutID != "" && includeGlobal: global drawings + drawings for layoutID
// - layoutID != "" && !includeGlobal: strictly drawings for layoutID (e.g. chart-local slot scope)
func (s *SQLiteStore) ListDrawingsForScope(ctx context.Context, symbol, layoutID string, includeGlobal bool) ([]SavedDrawing, error) {
	sym := domain.NormalizeSymbol(symbol)
	var (
		rows *sql.Rows
		err  error
	)
	if layoutID == "" {
		rows, err = s.db.QueryContext(ctx, `
			SELECT id, symbol, timeframe, tool_type, points_json, style_json, layout_id, created_at
			FROM drawings
			WHERE symbol = ? AND layout_id = ''
			ORDER BY created_at ASC
		`, sym)
	} else if includeGlobal {
		rows, err = s.db.QueryContext(ctx, `
			SELECT id, symbol, timeframe, tool_type, points_json, style_json, layout_id, created_at
			FROM drawings
			WHERE symbol = ? AND (layout_id = '' OR layout_id = ?)
			ORDER BY created_at ASC
		`, sym, layoutID)
	} else {
		rows, err = s.db.QueryContext(ctx, `
			SELECT id, symbol, timeframe, tool_type, points_json, style_json, layout_id, created_at
			FROM drawings
			WHERE symbol = ? AND layout_id = ?
			ORDER BY created_at ASC
		`, sym, layoutID)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []SavedDrawing
	for rows.Next() {
		var d SavedDrawing
		if err := rows.Scan(&d.ID, &d.Symbol, &d.Timeframe, &d.ToolType, &d.PointsJSON, &d.StyleJSON, &d.LayoutID, &d.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// DeleteDrawings deletes either a specific drawing ID or all global drawings for a symbol.
func (s *SQLiteStore) DeleteDrawings(ctx context.Context, symbol, id string) error {
	return s.DeleteDrawingsForScope(ctx, symbol, id, "")
}

// DeleteDrawingsForScope deletes a specific drawing by ID, or all drawings for symbol in the given layout scope.
func (s *SQLiteStore) DeleteDrawingsForScope(ctx context.Context, symbol, id, layoutID string) error {
	if id != "" {
		_, err := s.db.ExecContext(ctx, `DELETE FROM drawings WHERE id = ?`, id)
		return err
	}
	if layoutID != "" {
		_, err := s.db.ExecContext(ctx, `DELETE FROM drawings WHERE symbol = ? AND layout_id = ?`, domain.NormalizeSymbol(symbol), layoutID)
		return err
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM drawings WHERE symbol = ? AND layout_id = ''`, domain.NormalizeSymbol(symbol))
	return err
}

// GetCacheStats returns aggregate counts and disk footprint from the SQLite database.
func (s *SQLiteStore) GetCacheStats(ctx context.Context) (CacheStats, error) {
	var st CacheStats
	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*), COUNT(DISTINCT symbol) FROM candles`).Scan(&st.TotalCandles, &st.TotalSymbols)
	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM scripts`).Scan(&st.SavedScripts)
	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM drawings`).Scan(&st.SavedDrawings)

	var pageCount, pageSize int64
	_ = s.db.QueryRowContext(ctx, `PRAGMA page_count`).Scan(&pageCount)
	_ = s.db.QueryRowContext(ctx, `PRAGMA page_size`).Scan(&pageSize)
	st.DiskSizeBytes = pageCount * pageSize
	if st.DiskSizeBytes > 0 {
		st.DiskSizeMB = math.Round((float64(st.DiskSizeBytes)/(1024.0*1024.0))*100) / 100
	}
	return st, nil
}

// DB exposes the underlying handle for tests and diagnostics.
func (s *SQLiteStore) DB() *sql.DB { return s.db }

// MaxCollectSymbols bounds the background collection list (upstream politeness).
const MaxCollectSymbols = 30

// SetCollectSymbols replaces the list of symbols whose candles are collected in the background.
func (s *SQLiteStore) SetCollectSymbols(ctx context.Context, symbols []string) error {
	seen := map[string]bool{}
	var clean []string
	for _, sym := range symbols {
		n := domain.NormalizeSymbol(sym)
		if n == "" || seen[n] || len(clean) >= MaxCollectSymbols {
			continue
		}
		seen[n] = true
		clean = append(clean, n)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	// keep added_at of symbols that stay; drop the rest
	if _, err := tx.ExecContext(ctx, `DELETE FROM collect_symbols`); err != nil {
		return err
	}
	now := time.Now().Unix()
	for _, sym := range clean {
		if _, err := tx.ExecContext(ctx, `INSERT INTO collect_symbols (symbol, added_at) VALUES (?, ?)`, sym, now); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ListCollectSymbols returns the background-collection list, oldest first.
func (s *SQLiteStore) ListCollectSymbols(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT symbol FROM collect_symbols ORDER BY added_at ASC, symbol ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var sym string
		if err := rows.Scan(&sym); err != nil {
			return nil, err
		}
		out = append(out, sym)
	}
	return out, rows.Err()
}

// MaxSettingBytes bounds one stored setting blob (workspace snapshot: layout, script code, alerts…).
const MaxSettingBytes = 512 * 1024

// GetSetting returns the stored JSON text and its update time; ok=false when the key is unset.
func (s *SQLiteStore) GetSetting(ctx context.Context, key string) (value string, updatedAt int64, ok bool, err error) {
	err = s.db.QueryRowContext(ctx, `SELECT value, updated_at FROM app_settings WHERE key = ?`, key).Scan(&value, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return "", 0, false, nil
	}
	if err != nil {
		return "", 0, false, err
	}
	return value, updatedAt, true, nil
}

// SetSetting upserts one setting blob.
func (s *SQLiteStore) SetSetting(ctx context.Context, key, value string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		key, value, time.Now().Unix())
	return err
}
