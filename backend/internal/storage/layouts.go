package storage

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// MaxLayoutBytes bounds one stored saved-layout state blob (512 KB).
const MaxLayoutBytes = 512 * 1024

// ErrLayoutNotFound is returned when a layout ID or share token cannot be resolved.
var ErrLayoutNotFound = errors.New("layout not found")

// SavedLayout is a full multi-chart layout record persisted in SQLite.
type SavedLayout struct {
	ID         string          `json:"id"`
	Name       string          `json:"name"`
	State      json.RawMessage `json:"state"`
	GridID     string          `json:"gridId"`
	ChartCount int             `json:"chartCount"`
	Symbols    string          `json:"symbols"`
	Autosave   bool            `json:"autosave"`
	IsShared   bool            `json:"isShared"`
	ShareToken string          `json:"shareToken,omitempty"`
	CreatedAt  int64           `json:"createdAt"`
	UpdatedAt  int64           `json:"updatedAt"`
}

// LayoutSummary is the lightweight metadata returned by ListLayouts.
type LayoutSummary struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	GridID     string `json:"gridId"`
	ChartCount int    `json:"chartCount"`
	Symbols    string `json:"symbols"`
	Autosave   bool   `json:"autosave"`
	IsShared   bool   `json:"isShared"`
	ShareToken string `json:"shareToken,omitempty"`
	CreatedAt  int64  `json:"createdAt"`
	UpdatedAt  int64  `json:"updatedAt"`
}

func newLayoutID() string {
	var b [6]byte
	_, _ = rand.Read(b[:])
	return "lay_" + hex.EncodeToString(b[:])
}

func newShareToken() string {
	var b [18]byte
	_, _ = rand.Read(b[:])
	return base64.RawURLEncoding.EncodeToString(b[:])
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// ListLayouts returns all saved layouts ordered by most recently updated.
func (s *SQLiteStore) ListLayouts(ctx context.Context) ([]LayoutSummary, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, grid_id, chart_count, symbols, autosave, is_shared, share_token, created_at, updated_at
		FROM layouts
		ORDER BY updated_at DESC, created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []LayoutSummary{}
	for rows.Next() {
		var it LayoutSummary
		var autoInt, sharedInt int
		if err := rows.Scan(&it.ID, &it.Name, &it.GridID, &it.ChartCount, &it.Symbols, &autoInt, &sharedInt, &it.ShareToken, &it.CreatedAt, &it.UpdatedAt); err != nil {
			return nil, err
		}
		it.Autosave = autoInt != 0
		it.IsShared = sharedInt != 0
		if !it.IsShared {
			it.ShareToken = ""
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// GetLayout returns one saved layout by ID.
func (s *SQLiteStore) GetLayout(ctx context.Context, id string) (*SavedLayout, error) {
	return s.scanLayout(s.db.QueryRowContext(ctx, `
		SELECT id, name, state_json, grid_id, chart_count, symbols, autosave, is_shared, share_token, created_at, updated_at
		FROM layouts
		WHERE id = ?
	`, id))
}

// GetSharedLayout returns a layout only when public read-only sharing is enabled and token matches.
func (s *SQLiteStore) GetSharedLayout(ctx context.Context, token string) (*SavedLayout, error) {
	if strings.TrimSpace(token) == "" {
		return nil, ErrLayoutNotFound
	}
	return s.scanLayout(s.db.QueryRowContext(ctx, `
		SELECT id, name, state_json, grid_id, chart_count, symbols, autosave, is_shared, share_token, created_at, updated_at
		FROM layouts
		WHERE is_shared = 1 AND share_token = ?
	`, token))
}

func (s *SQLiteStore) scanLayout(row *sql.Row) (*SavedLayout, error) {
	var l SavedLayout
	var stateStr string
	var autoInt, sharedInt int
	err := row.Scan(&l.ID, &l.Name, &stateStr, &l.GridID, &l.ChartCount, &l.Symbols, &autoInt, &sharedInt, &l.ShareToken, &l.CreatedAt, &l.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrLayoutNotFound
	}
	if err != nil {
		return nil, err
	}
	l.State = json.RawMessage(stateStr)
	l.Autosave = autoInt != 0
	l.IsShared = sharedInt != 0
	if !l.IsShared {
		l.ShareToken = ""
	}
	return &l, nil
}

// CreateLayout inserts a new saved layout and returns the stored record.
func (s *SQLiteStore) CreateLayout(ctx context.Context, l SavedLayout) (*SavedLayout, error) {
	if l.ID == "" {
		l.ID = newLayoutID()
	}
	l.Name = strings.TrimSpace(l.Name)
	if l.Name == "" {
		l.Name = "Adsız"
	}
	if l.GridID == "" {
		l.GridID = "single"
	}
	if l.ChartCount <= 0 {
		l.ChartCount = 1
	}
	if len(l.State) == 0 {
		l.State = json.RawMessage("{}")
	}
	if len(l.State) > MaxLayoutBytes {
		return nil, fmt.Errorf("layout state exceeds %d bytes", MaxLayoutBytes)
	}
	now := time.Now().Unix()
	if l.CreatedAt == 0 {
		l.CreatedAt = now
	}
	l.UpdatedAt = now
	token := ""
	if l.IsShared {
		if l.ShareToken != "" {
			token = l.ShareToken
		} else {
			token = newShareToken()
		}
		l.ShareToken = token
	} else {
		l.ShareToken = ""
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO layouts (id, name, state_json, grid_id, chart_count, symbols, autosave, is_shared, share_token, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, l.ID, l.Name, string(l.State), l.GridID, l.ChartCount, l.Symbols, boolToInt(l.Autosave), boolToInt(l.IsShared), token, l.CreatedAt, l.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &l, nil
}

// UpdateLayoutPatch carries optional fields to update on an existing layout.
type UpdateLayoutPatch struct {
	Name       *string
	State      json.RawMessage
	GridID     *string
	ChartCount *int
	Symbols    *string
	Autosave   *bool
}

// UpdateLayout applies partial updates to an existing layout.
func (s *SQLiteStore) UpdateLayout(ctx context.Context, id string, patch UpdateLayoutPatch) (*SavedLayout, error) {
	cur, err := s.GetLayout(ctx, id)
	if err != nil {
		return nil, err
	}
	if patch.Name != nil {
		n := strings.TrimSpace(*patch.Name)
		if n != "" {
			cur.Name = n
		}
	}
	if len(patch.State) > 0 {
		if len(patch.State) > MaxLayoutBytes {
			return nil, fmt.Errorf("layout state exceeds %d bytes", MaxLayoutBytes)
		}
		cur.State = patch.State
	}
	if patch.GridID != nil && *patch.GridID != "" {
		cur.GridID = *patch.GridID
	}
	if patch.ChartCount != nil && *patch.ChartCount > 0 {
		cur.ChartCount = *patch.ChartCount
	}
	if patch.Symbols != nil {
		cur.Symbols = *patch.Symbols
	}
	if patch.Autosave != nil {
		cur.Autosave = *patch.Autosave
	}
	cur.UpdatedAt = time.Now().Unix()

	_, err = s.db.ExecContext(ctx, `
		UPDATE layouts
		SET name = ?, state_json = ?, grid_id = ?, chart_count = ?, symbols = ?, autosave = ?, updated_at = ?
		WHERE id = ?
	`, cur.Name, string(cur.State), cur.GridID, cur.ChartCount, cur.Symbols, boolToInt(cur.Autosave), cur.UpdatedAt, id)
	if err != nil {
		return nil, err
	}
	return cur, nil
}

// CopyLayout duplicates an existing layout (and its layout-scoped drawings) under a new ID and name.
func (s *SQLiteStore) CopyLayout(ctx context.Context, sourceID, newName string) (*SavedLayout, error) {
	src, err := s.GetLayout(ctx, sourceID)
	if err != nil {
		return nil, err
	}
	name := strings.TrimSpace(newName)
	if name == "" {
		name = src.Name + " (kopya)"
	}
	copyRec, err := s.CreateLayout(ctx, SavedLayout{
		Name:       name,
		State:      src.State,
		GridID:     src.GridID,
		ChartCount: src.ChartCount,
		Symbols:    src.Symbols,
		Autosave:   src.Autosave,
		IsShared:   false,
	})
	if err != nil {
		return nil, err
	}
	// Duplicate layout-scoped drawings so the copy starts with the exact same visual annotations.
	rows, err := s.db.QueryContext(ctx, `
		SELECT symbol, timeframe, tool_type, points_json, style_json, layout_id, created_at
		FROM drawings
		WHERE layout_id = ? OR layout_id LIKE ?
	`, sourceID, sourceID+"#slot:%")
	if err == nil {
		defer rows.Close()
		var toCopy []SavedDrawing
		for rows.Next() {
			var d SavedDrawing
			if scanErr := rows.Scan(&d.Symbol, &d.Timeframe, &d.ToolType, &d.PointsJSON, &d.StyleJSON, &d.LayoutID, &d.CreatedAt); scanErr == nil {
				d.ID = fmt.Sprintf("draw_%s_%d", newLayoutID()[4:], len(toCopy))
				d.LayoutID = strings.Replace(d.LayoutID, sourceID, copyRec.ID, 1)
				toCopy = append(toCopy, d)
			}
		}
		for _, d := range toCopy {
			_ = s.SaveDrawing(ctx, d)
		}
	}
	return copyRec, nil
}

// SetLayoutSharing enables or disables the shareable read-only link for a layout.
func (s *SQLiteStore) SetLayoutSharing(ctx context.Context, id string, shared, regenerate bool) (*SavedLayout, error) {
	var existingToken string
	var isSharedInt int
	err := s.db.QueryRowContext(ctx, `SELECT is_shared, share_token FROM layouts WHERE id = ?`, id).Scan(&isSharedInt, &existingToken)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrLayoutNotFound
	}
	if err != nil {
		return nil, err
	}

	token := existingToken
	if shared && (token == "" || regenerate) {
		token = newShareToken()
	}
	now := time.Now().Unix()
	if _, err := s.db.ExecContext(ctx, `
		UPDATE layouts SET is_shared = ?, share_token = ?, updated_at = ? WHERE id = ?
	`, boolToInt(shared), token, now, id); err != nil {
		return nil, err
	}
	return s.GetLayout(ctx, id)
}

// DeleteLayout removes a saved layout and its layout-scoped drawings.
func (s *SQLiteStore) DeleteLayout(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM layouts WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrLayoutNotFound
	}
	_, _ = s.db.ExecContext(ctx, `DELETE FROM drawings WHERE layout_id = ? OR layout_id LIKE ?`, id, id+"#slot:%")
	return nil
}

// ListDrawingsForSharedLayout collects layout-scoped + global drawings for the given symbols.
func (s *SQLiteStore) ListDrawingsForSharedLayout(ctx context.Context, layoutID string, symbols []string) ([]SavedDrawing, error) {
	seen := map[string]bool{}
	var out []SavedDrawing
	for _, sym := range symbols {
		if strings.TrimSpace(sym) == "" {
			continue
		}
		list, err := s.ListDrawingsForScope(ctx, sym, layoutID, true)
		if err != nil {
			return nil, err
		}
		for _, d := range list {
			if !seen[d.ID] {
				seen[d.ID] = true
				out = append(out, d)
			}
		}
	}
	return out, nil
}
