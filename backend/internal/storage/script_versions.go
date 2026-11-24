package storage

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// MaxScriptVersions bounds the per-script history kept in SQLite (oldest are pruned).
const MaxScriptVersions = 100

// ErrScriptNotFound is returned when a script (or a version of it) does not exist.
var ErrScriptNotFound = errors.New("script not found")

// ScriptVersion is one saved snapshot of a script's source (Script editor history).
type ScriptVersion struct {
	ScriptID  string `json:"scriptId"`
	Version   int    `json:"version"`
	Name      string `json:"name"`
	Code      string `json:"code"`
	CreatedAt int64  `json:"createdAt"`
}

// recordScriptVersion appends a snapshot when the code differs from the latest one.
func (s *SQLiteStore) recordScriptVersion(ctx context.Context, sc SavedScript) error {
	var lastVer int
	var lastCode string
	err := s.db.QueryRowContext(ctx,
		`SELECT version, code FROM script_versions WHERE script_id = ? ORDER BY version DESC LIMIT 1`, sc.ID,
	).Scan(&lastVer, &lastCode)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if err == nil && lastCode == sc.Code {
		return nil
	}
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO script_versions (script_id, version, name, code, created_at) VALUES (?, ?, ?, ?, ?)`,
		sc.ID, lastVer+1, sc.Name, sc.Code, time.Now().Unix(),
	); err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx,
		`DELETE FROM script_versions WHERE script_id = ? AND version <= ?`, sc.ID, lastVer+1-MaxScriptVersions)
	return err
}

// ListScriptVersions returns the history of a script, newest first.
func (s *SQLiteStore) ListScriptVersions(ctx context.Context, id string) ([]ScriptVersion, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT script_id, version, name, code, created_at FROM script_versions WHERE script_id = ? ORDER BY version DESC`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ScriptVersion{}
	for rows.Next() {
		var v ScriptVersion
		if err := rows.Scan(&v.ScriptID, &v.Version, &v.Name, &v.Code, &v.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// RenameScript changes a saved script's display name without creating a new version.
func (s *SQLiteStore) RenameScript(ctx context.Context, id, name string) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE scripts SET name = ?, updated_at = ? WHERE id = ?`, name, time.Now().Unix(), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrScriptNotFound
	}
	return nil
}
