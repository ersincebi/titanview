package storage

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
)

// ValidFlagColors enumerates 7 standard flag colors.
var ValidFlagColors = map[string]bool{
	"red":    true,
	"blue":   true,
	"green":  true,
	"orange": true,
	"purple": true,
	"cyan":   true,
	"pink":   true,
}

// WatchlistEntry represents either a symbol item or a section header inside a Watchlist.
type WatchlistEntry struct {
	Type      string `json:"type"`                // "symbol" | "section"
	Symbol    string `json:"symbol,omitempty"`    // for type=="symbol"
	ID        string `json:"id,omitempty"`        // for type=="section"
	Title     string `json:"title,omitempty"`     // for type=="section"
	Collapsed bool   `json:"collapsed,omitempty"` // for type=="section"
}

// SavedWatchlist is a user watchlist with ordered symbols and custom sections.
type SavedWatchlist struct {
	ID        string           `json:"id"`
	Name      string           `json:"name"`
	Items     []WatchlistEntry `json:"items"`
	IsDefault bool             `json:"isDefault"`
	CreatedAt int64            `json:"createdAt"`
	UpdatedAt int64            `json:"updatedAt"`
}

// SymbolNote is a user trading journal / analysis note attached to a symbol.
type SymbolNote struct {
	ID            string  `json:"id"`
	Symbol        string  `json:"symbol"`
	Title         string  `json:"title"`
	Body          string  `json:"body"`
	Tags          string  `json:"tags"`
	Sentiment     string  `json:"sentiment"` // "bull" | "bear" | "neutral"
	SnapshotPrice float64 `json:"snapshotPrice"`
	Timeframe     string  `json:"timeframe"`
	Pinned        bool    `json:"pinned"`
	CreatedAt     int64   `json:"createdAt"`
	UpdatedAt     int64   `json:"updatedAt"`
}

// SavedScreenerPreset persists a custom screener screen (filters, column set, market, timeframe, sort).
type SavedScreenerPreset struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Market    string          `json:"market"`
	Timeframe string          `json:"timeframe"`
	ColumnSet string          `json:"columnSet"`
	Config    json.RawMessage `json:"config"`
	CreatedAt int64           `json:"createdAt"`
	UpdatedAt int64           `json:"updatedAt"`
}

var (
	ErrWatchlistNotFound = errors.New("watchlist not found")
	ErrLastWatchlist     = errors.New("son kalan izleme listesi silinemez")
	ErrInvalidFlagColor  = errors.New("geçersiz bayrak rengi")
	ErrNoteNotFound      = errors.New("note not found")
	ErrPresetNotFound    = errors.New("screener preset not found")
)

func newShortID(prefix string) string {
	var b [6]byte
	_, _ = rand.Read(b[:])
	return prefix + "_" + hex.EncodeToString(b[:])
}

func symEntry(sym string) WatchlistEntry {
	return WatchlistEntry{Type: "symbol", Symbol: sym}
}

func secEntry(id, title string) WatchlistEntry {
	return WatchlistEntry{Type: "section", ID: id, Title: title}
}

// DefaultWatchlists returns the initial default sectioned watchlists when the table is empty.
func DefaultWatchlists(now int64) []SavedWatchlist {
	return []SavedWatchlist{
		{
			ID:        "wl_main",
			Name:      "Ana İzleme Listesi",
			IsDefault: true,
			CreatedAt: now,
			UpdatedAt: now,
			Items: []WatchlistEntry{
				secEntry("sec_bist", "BIST LİDERLER"),
				symEntry("XU100.IS"),
				symEntry("THYAO.IS"),
				symEntry("ASELS.IS"),
				symEntry("GARAN.IS"),
				symEntry("EREGL.IS"),
				symEntry("KCHOL.IS"),
				symEntry("TUPRS.IS"),
				symEntry("AKBNK.IS"),
				symEntry("BIMAS.IS"),
				symEntry("FROTO.IS"),
				symEntry("SISE.IS"),
				secEntry("sec_crypto", "KRİPTO ANA"),
				symEntry("BTCUSDT"),
				symEntry("ETHUSDT"),
				symEntry("SOLUSDT"),
				symEntry("BNBUSDT"),
				symEntry("XRPUSDT"),
				symEntry("AVAXUSDT"),
				symEntry("LINKUSDT"),
				symEntry("SUIUSDT"),
				secEntry("sec_us", "ABD TEKNOLOJİ & ETF"),
				symEntry("NVDA"),
				symEntry("AAPL"),
				symEntry("MSFT"),
				symEntry("TSLA"),
				symEntry("AMZN"),
				symEntry("META"),
				symEntry("GOOGL"),
				symEntry("AMD"),
				symEntry("SPY"),
				symEntry("QQQ"),
				secEntry("sec_fx", "ALTIN & DÖVİZ"),
				symEntry("USDTRY=X"),
				symEntry("EURTRY=X"),
				symEntry("GC=F"),
				symEntry("SI=F"),
				symEntry("BZ=F"),
				symEntry("DX-Y.NYB"),
			},
		},
		{
			ID:        "wl_bist30",
			Name:      "BIST 30 Sektörel",
			IsDefault: false,
			CreatedAt: now,
			UpdatedAt: now,
			Items: []WatchlistEntry{
				secEntry("sec_bist_bank", "BANKACILIK & HOLDİNG"),
				symEntry("GARAN.IS"),
				symEntry("AKBNK.IS"),
				symEntry("ISCTR.IS"),
				symEntry("YKBNK.IS"),
				symEntry("KCHOL.IS"),
				symEntry("SAHOL.IS"),
				secEntry("sec_bist_ind", "SANAYİ, SAVUNMA & ENERJİ"),
				symEntry("ASELS.IS"),
				symEntry("TUPRS.IS"),
				symEntry("EREGL.IS"),
				symEntry("FROTO.IS"),
				symEntry("TOASO.IS"),
				symEntry("SISE.IS"),
				symEntry("ASTOR.IS"),
				symEntry("SASA.IS"),
				secEntry("sec_bist_svc", "ULAŞTIRMA, İLETİŞİM & PERAKENDE"),
				symEntry("THYAO.IS"),
				symEntry("PGSUS.IS"),
				symEntry("BIMAS.IS"),
				symEntry("MGROS.IS"),
				symEntry("TCELL.IS"),
				symEntry("TTKOM.IS"),
			},
		},
		{
			ID:        "wl_crypto_ai",
			Name:      "Kripto & Yapay Zeka",
			IsDefault: false,
			CreatedAt: now,
			UpdatedAt: now,
			Items: []WatchlistEntry{
				secEntry("sec_l1", "KATMAN-1 (LAYER 1)"),
				symEntry("BTCUSDT"),
				symEntry("ETHUSDT"),
				symEntry("SOLUSDT"),
				symEntry("BNBUSDT"),
				symEntry("AVAXUSDT"),
				symEntry("SUIUSDT"),
				symEntry("ADAUSDT"),
				secEntry("sec_ai", "YAPAY ZEKA & ALTYAPI"),
				symEntry("RENDERUSDT"),
				symEntry("FETUSDT"),
				symEntry("LINKUSDT"),
				symEntry("XRPUSDT"),
				symEntry("DOGEUSDT"),
			},
		},
	}
}

func sanitizeWatchlistEntries(items []WatchlistEntry) []WatchlistEntry {
	out := make([]WatchlistEntry, 0, len(items))
	seenSym := map[string]bool{}
	secIdx := 0
	for _, it := range items {
		switch strings.ToLower(strings.TrimSpace(it.Type)) {
		case "section":
			title := strings.TrimSpace(it.Title)
			if title == "" {
				title = "BÖLÜM"
			}
			secIdx++
			id := strings.TrimSpace(it.ID)
			if id == "" {
				id = fmt.Sprintf("sec_%d", secIdx)
			}
			out = append(out, WatchlistEntry{
				Type:      "section",
				ID:        id,
				Title:     title,
				Collapsed: it.Collapsed,
			})
		default:
			raw := strings.TrimSpace(it.Symbol)
			if raw == "" {
				continue
			}
			info := domain.ResolveSymbolInfo(raw)
			sym := info.Symbol
			if sym == "" || seenSym[sym] {
				continue
			}
			seenSym[sym] = true
			out = append(out, WatchlistEntry{
				Type:   "symbol",
				Symbol: sym,
			})
		}
	}
	return out
}

// ListWatchlists returns all saved watchlists, seeding DefaultWatchlists if none exist.
func (s *SQLiteStore) ListWatchlists(ctx context.Context) ([]SavedWatchlist, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, items_json, is_default, created_at, updated_at
		FROM watchlists
		ORDER BY is_default DESC, created_at ASC, id ASC
	`)
	if err != nil {
		return nil, err
	}
	var out []SavedWatchlist
	for rows.Next() {
		var wl SavedWatchlist
		var itemsStr string
		var defInt int
		if err := rows.Scan(&wl.ID, &wl.Name, &itemsStr, &defInt, &wl.CreatedAt, &wl.UpdatedAt); err != nil {
			_ = rows.Close()
			return nil, err
		}
		wl.IsDefault = defInt != 0
		_ = json.Unmarshal([]byte(itemsStr), &wl.Items)
		if wl.Items == nil {
			wl.Items = []WatchlistEntry{}
		}
		out = append(out, wl)
	}
	_ = rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		now := time.Now().Unix()
		defaults := DefaultWatchlists(now)
		for _, d := range defaults {
			if _, err := s.SaveWatchlist(ctx, d); err != nil {
				return nil, err
			}
		}
		return defaults, nil
	}
	return out, nil
}

// GetWatchlist returns a single watchlist by ID.
func (s *SQLiteStore) GetWatchlist(ctx context.Context, id string) (*SavedWatchlist, error) {
	var wl SavedWatchlist
	var itemsStr string
	var defInt int
	err := s.db.QueryRowContext(ctx, `
		SELECT id, name, items_json, is_default, created_at, updated_at
		FROM watchlists
		WHERE id = ?
	`, id).Scan(&wl.ID, &wl.Name, &itemsStr, &defInt, &wl.CreatedAt, &wl.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrWatchlistNotFound
	}
	if err != nil {
		return nil, err
	}
	wl.IsDefault = defInt != 0
	_ = json.Unmarshal([]byte(itemsStr), &wl.Items)
	if wl.Items == nil {
		wl.Items = []WatchlistEntry{}
	}
	return &wl, nil
}

// SaveWatchlist creates or updates a watchlist.
func (s *SQLiteStore) SaveWatchlist(ctx context.Context, wl SavedWatchlist) (*SavedWatchlist, error) {
	if strings.TrimSpace(wl.ID) == "" {
		wl.ID = newShortID("wl")
	}
	wl.Name = strings.TrimSpace(wl.Name)
	if wl.Name == "" {
		wl.Name = "Yeni İzleme Listesi"
	}
	wl.Items = sanitizeWatchlistEntries(wl.Items)
	rawItems, err := json.Marshal(wl.Items)
	if err != nil {
		return nil, err
	}
	now := time.Now().Unix()
	if wl.CreatedAt == 0 {
		wl.CreatedAt = now
	}
	wl.UpdatedAt = now
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO watchlists (id, name, items_json, is_default, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name       = excluded.name,
			items_json = excluded.items_json,
			updated_at = excluded.updated_at
	`, wl.ID, wl.Name, string(rawItems), boolToInt(wl.IsDefault), wl.CreatedAt, wl.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &wl, nil
}

// DeleteWatchlist deletes a watchlist by ID, preventing deletion of the last remaining watchlist.
func (s *SQLiteStore) DeleteWatchlist(ctx context.Context, id string) error {
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM watchlists`).Scan(&count); err != nil {
		return err
	}
	if count <= 1 {
		return ErrLastWatchlist
	}
	res, err := s.db.ExecContext(ctx, `DELETE FROM watchlists WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrWatchlistNotFound
	}
	return nil
}

// ListSymbolFlags returns all flagged symbols as a map[symbol]color.
func (s *SQLiteStore) ListSymbolFlags(ctx context.Context) (map[string]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT symbol, color FROM symbol_flags ORDER BY updated_at DESC, symbol ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var sym, col string
		if err := rows.Scan(&sym, &col); err != nil {
			return nil, err
		}
		if ValidFlagColors[col] {
			out[sym] = col
		}
	}
	return out, rows.Err()
}

// SetSymbolFlag sets or clears (when color == "") one of the 7 flag colors for a symbol.
func (s *SQLiteStore) SetSymbolFlag(ctx context.Context, symbol, color string) error {
	sym := domain.ResolveSymbolInfo(symbol).Symbol
	if sym == "" {
		return errors.New("symbol required")
	}
	col := strings.ToLower(strings.TrimSpace(color))
	if col == "" || col == "none" {
		_, err := s.db.ExecContext(ctx, `DELETE FROM symbol_flags WHERE symbol = ?`, sym)
		return err
	}
	if !ValidFlagColors[col] {
		return ErrInvalidFlagColor
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO symbol_flags (symbol, color, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(symbol) DO UPDATE SET
			color      = excluded.color,
			updated_at = excluded.updated_at
	`, sym, col, time.Now().Unix())
	return err
}

// ListNotes returns all notes (or notes for a specific symbol), ordered by pinned first, then newest.
func (s *SQLiteStore) ListNotes(ctx context.Context, symbol string) ([]SymbolNote, error) {
	var (
		rows *sql.Rows
		err  error
	)
	sym := strings.TrimSpace(symbol)
	if sym != "" {
		sym = domain.ResolveSymbolInfo(sym).Symbol
		rows, err = s.db.QueryContext(ctx, `
			SELECT id, symbol, title, body, tags, sentiment, snapshot_price, timeframe, pinned, created_at, updated_at
			FROM symbol_notes
			WHERE symbol = ?
			ORDER BY pinned DESC, updated_at DESC, created_at DESC
		`, sym)
	} else {
		rows, err = s.db.QueryContext(ctx, `
			SELECT id, symbol, title, body, tags, sentiment, snapshot_price, timeframe, pinned, created_at, updated_at
			FROM symbol_notes
			ORDER BY pinned DESC, updated_at DESC, created_at DESC
		`)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []SymbolNote{}
	for rows.Next() {
		var n SymbolNote
		var pinInt int
		if err := rows.Scan(&n.ID, &n.Symbol, &n.Title, &n.Body, &n.Tags, &n.Sentiment, &n.SnapshotPrice, &n.Timeframe, &pinInt, &n.CreatedAt, &n.UpdatedAt); err != nil {
			return nil, err
		}
		n.Pinned = pinInt != 0
		out = append(out, n)
	}
	return out, rows.Err()
}

// SaveNote inserts or updates a symbol note / journal entry.
func (s *SQLiteStore) SaveNote(ctx context.Context, n SymbolNote) (*SymbolNote, error) {
	if strings.TrimSpace(n.ID) == "" {
		n.ID = newShortID("note")
	}
	n.Symbol = domain.ResolveSymbolInfo(strings.TrimSpace(n.Symbol)).Symbol
	if n.Symbol == "" {
		n.Symbol = "THYAO.IS"
	}
	n.Title = strings.TrimSpace(n.Title)
	n.Body = strings.TrimSpace(n.Body)
	if n.Title == "" && n.Body == "" {
		return nil, errors.New("not başlığı veya içeriği gerekli")
	}
	if n.Title == "" {
		runes := []rune(n.Body)
		if len(runes) > 36 {
			n.Title = string(runes[:36]) + "…"
		} else {
			n.Title = n.Body
		}
	}
	switch n.Sentiment {
	case "bull", "bear", "neutral":
	default:
		n.Sentiment = "neutral"
	}
	now := time.Now().Unix()
	if n.CreatedAt == 0 {
		n.CreatedAt = now
	}
	n.UpdatedAt = now
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO symbol_notes (id, symbol, title, body, tags, sentiment, snapshot_price, timeframe, pinned, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			symbol         = excluded.symbol,
			title          = excluded.title,
			body           = excluded.body,
			tags           = excluded.tags,
			sentiment      = excluded.sentiment,
			snapshot_price = CASE WHEN excluded.snapshot_price > 0 THEN excluded.snapshot_price ELSE symbol_notes.snapshot_price END,
			timeframe      = CASE WHEN excluded.timeframe != '' THEN excluded.timeframe ELSE symbol_notes.timeframe END,
			pinned         = excluded.pinned,
			updated_at     = excluded.updated_at
	`, n.ID, n.Symbol, n.Title, n.Body, strings.TrimSpace(n.Tags), n.Sentiment, n.SnapshotPrice, strings.TrimSpace(n.Timeframe), boolToInt(n.Pinned), n.CreatedAt, n.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &n, nil
}

// DeleteNote deletes a symbol note by ID.
func (s *SQLiteStore) DeleteNote(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM symbol_notes WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNoteNotFound
	}
	return nil
}

// ListScreenerPresets returns all user-saved screener presets.
func (s *SQLiteStore) ListScreenerPresets(ctx context.Context) ([]SavedScreenerPreset, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, market, timeframe, column_set, config_json, created_at, updated_at
		FROM screener_presets
		ORDER BY updated_at DESC, created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SavedScreenerPreset{}
	for rows.Next() {
		var p SavedScreenerPreset
		var cfgStr string
		if err := rows.Scan(&p.ID, &p.Name, &p.Market, &p.Timeframe, &p.ColumnSet, &cfgStr, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		p.Config = json.RawMessage(cfgStr)
		out = append(out, p)
	}
	return out, rows.Err()
}

// SaveScreenerPreset inserts or updates a saved screener screen.
func (s *SQLiteStore) SaveScreenerPreset(ctx context.Context, p SavedScreenerPreset) (*SavedScreenerPreset, error) {
	if strings.TrimSpace(p.ID) == "" {
		p.ID = newShortID("scr")
	}
	p.Name = strings.TrimSpace(p.Name)
	if p.Name == "" {
		p.Name = "Özel Tarayıcı Ekranı"
	}
	if p.Market == "" {
		p.Market = "ALL"
	}
	if p.Timeframe == "" {
		p.Timeframe = "1d"
	}
	if p.ColumnSet == "" {
		p.ColumnSet = "overview"
	}
	if len(p.Config) == 0 {
		p.Config = json.RawMessage("{}")
	}
	now := time.Now().Unix()
	if p.CreatedAt == 0 {
		p.CreatedAt = now
	}
	p.UpdatedAt = now
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO screener_presets (id, name, market, timeframe, column_set, config_json, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name        = excluded.name,
			market      = excluded.market,
			timeframe   = excluded.timeframe,
			column_set  = excluded.column_set,
			config_json = excluded.config_json,
			updated_at  = excluded.updated_at
	`, p.ID, p.Name, p.Market, p.Timeframe, p.ColumnSet, string(p.Config), p.CreatedAt, p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// DeleteScreenerPreset deletes a saved screener preset by ID.
func (s *SQLiteStore) DeleteScreenerPreset(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM screener_presets WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrPresetNotFound
	}
	return nil
}
