package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/ersincebi/titanview/backend/internal/sources"
)

type updateSourcesRequest struct {
	Unofficial  bool `json:"unofficial"`
	AcceptTerms bool `json:"acceptTerms"`
}

// writeUnofficialDisabledError writes a structured 403 JSON response when err
// stems from the unofficial data-sources opt-in gate being disabled.
func writeUnofficialDisabledError(w http.ResponseWriter, err error) bool {
	if !errors.Is(err, sources.ErrUnofficialDisabled) {
		return false
	}
	writeJSON(w, http.StatusForbidden, map[string]interface{}{
		"error":              sources.ErrUnofficialDisabled.Error(),
		"code":               "unofficial_sources_disabled",
		"unofficialDisabled": true,
	})
	return true
}

// GET /api/sources           -> {"unofficial": bool, "acceptedAt": int64, "hosts": [...], "envOverride"?: bool}
// PUT|POST /api/sources      body: {"unofficial": bool, "acceptTerms": bool}
// Enabling unofficial endpoints (Yahoo Finance, Google News, İş Yatırım) requires acceptTerms=true.
func (s *Server) handleSources(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, sources.Current())
	case http.MethodPut, http.MethodPost:
		cur := sources.Current()
		if cur.EnvOverride != nil {
			writeJSONError(w, http.StatusConflict, "unofficial data sources are locked by environment variable or CLI flag ("+sources.EnvVar+")")
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, 4096))
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "read body")
			return
		}
		var req updateSourcesRequest
		if err := json.Unmarshal(body, &req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid json")
			return
		}
		if req.Unofficial && !req.AcceptTerms {
			writeJSONError(w, http.StatusBadRequest, "acceptTerms must be true to enable unofficial data sources")
			return
		}
		var acceptedAt int64
		if req.Unofficial {
			acceptedAt = time.Now().Unix()
		}
		if s.Coord != nil && s.Coord.Store != nil {
			encoded := sources.EncodeSetting(req.Unofficial, acceptedAt)
			if err := s.Coord.Store.SetSetting(r.Context(), sources.SettingKey, encoded); err != nil {
				writeJSONError(w, http.StatusInternalServerError, err.Error())
				return
			}
		}
		sources.Set(req.Unofficial, acceptedAt)
		s.cache.clear()
		s.quotes.clear()
		writeJSON(w, http.StatusOK, sources.Current())
	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
