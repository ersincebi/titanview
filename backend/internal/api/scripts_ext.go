package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/ersincebi/titanview/backend/internal/storage"
)

// GET /api/scripts/versions?id=  → Script editor version history (newest first).
func (s *Server) handleScriptVersions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	id := r.URL.Query().Get("id")
	if id == "" {
		writeJSONError(w, http.StatusBadRequest, "id query parameter required")
		return
	}
	vs, err := s.Coord.Store.ListScriptVersions(r.Context(), id)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"versions": vs})
}

// POST /api/scripts/rename {"id","name"} → renames a saved script.
func (s *Server) handleScriptRename(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var body struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid json")
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.ID == "" || body.Name == "" || len(body.Name) > 120 {
		writeJSONError(w, http.StatusBadRequest, "id and name (1-120 chars) required")
		return
	}
	if err := s.Coord.Store.RenameScript(r.Context(), body.ID, body.Name); err != nil {
		if errors.Is(err, storage.ErrScriptNotFound) {
			writeJSONError(w, http.StatusNotFound, err.Error())
			return
		}
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": body.ID, "name": body.Name})
}
