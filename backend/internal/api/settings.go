package api

import (
	"encoding/json"
	"io"
	"net/http"
	"regexp"

	"github.com/ersincebi/titanview/backend/internal/storage"
)

var settingKeyRe = regexp.MustCompile(`^[a-z0-9_]{1,40}$`)

// GET /api/settings?key=workspace  -> {"key","value":<json>,"updatedAt"}  (404 when unset)
// PUT /api/settings?key=workspace  body = any JSON value (<= storage.MaxSettingBytes)
// Survives browser-data clearing: the UI workspace (layout, script code, alerts…) lives in SQLite.
func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	key := r.URL.Query().Get("key")
	if !settingKeyRe.MatchString(key) {
		writeJSONError(w, http.StatusBadRequest, "key: 1-40 chars of [a-z0-9_]")
		return
	}
	switch r.Method {
	case http.MethodGet:
		val, at, ok, err := s.Coord.Store.GetSetting(r.Context(), key)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !ok {
			writeJSONError(w, http.StatusNotFound, "setting not set")
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"key": key, "value": json.RawMessage(val), "updatedAt": at})
	case http.MethodPut:
		body, err := io.ReadAll(io.LimitReader(r.Body, storage.MaxSettingBytes+1))
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "read body")
			return
		}
		if len(body) > storage.MaxSettingBytes {
			writeJSONError(w, http.StatusRequestEntityTooLarge, "setting too large")
			return
		}
		if !json.Valid(body) {
			writeJSONError(w, http.StatusBadRequest, "invalid json")
			return
		}
		if err := s.Coord.Store.SetSetting(r.Context(), key, string(body)); err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"key": key, "bytes": len(body)})
	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
