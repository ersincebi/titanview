package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/ersincebi/titanview/backend/internal/storage"
)

// GET  /api/layouts         → list saved layout summaries
// POST /api/layouts         → create a new saved layout
func (s *Server) handleLayouts(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.Coord.Store.ListLayouts(r.Context())
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"layouts": list})

	case http.MethodPost:
		body, err := io.ReadAll(io.LimitReader(r.Body, storage.MaxLayoutBytes+4096))
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "read body")
			return
		}
		var req struct {
			Name       string          `json:"name"`
			State      json.RawMessage `json:"state"`
			GridID     string          `json:"gridId"`
			ChartCount int             `json:"chartCount"`
			Symbols    string          `json:"symbols"`
			Autosave   *bool           `json:"autosave"`
		}
		if err := json.Unmarshal(body, &req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid json")
			return
		}
		req.Name = strings.TrimSpace(req.Name)
		if len(req.Name) > 120 {
			writeJSONError(w, http.StatusBadRequest, "name too long (max 120 chars)")
			return
		}
		if len(req.State) > 0 && !json.Valid(req.State) {
			writeJSONError(w, http.StatusBadRequest, "invalid state json")
			return
		}
		if len(req.State) > storage.MaxLayoutBytes {
			writeJSONError(w, http.StatusRequestEntityTooLarge, "layout state too large")
			return
		}
		autosave := true
		if req.Autosave != nil {
			autosave = *req.Autosave
		}
		created, err := s.Coord.Store.CreateLayout(r.Context(), storage.SavedLayout{
			Name:       req.Name,
			State:      req.State,
			GridID:     req.GridID,
			ChartCount: req.ChartCount,
			Symbols:    req.Symbols,
			Autosave:   autosave,
		})
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, created)

	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// Dispatches:
//   GET    /api/layouts/shared/{token} → read-only shared layout snapshot + drawings
//   GET    /api/layouts/{id}           → full layout
//   PUT    /api/layouts/{id}           → update / rename / save state
//   DELETE /api/layouts/{id}           → delete layout
//   POST   /api/layouts/{id}/copy      → duplicate layout
//   POST   /api/layouts/{id}/share     → enable/disable shareable link
func (s *Server) handleLayoutSub(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/layouts/")
	rest = strings.Trim(rest, "/")
	if rest == "" {
		s.handleLayouts(w, r)
		return
	}
	parts := strings.Split(rest, "/")

	// GET /api/layouts/shared/{token}
	if parts[0] == "shared" {
		if len(parts) != 2 || parts[1] == "" {
			writeJSONError(w, http.StatusNotFound, "shared layout not found")
			return
		}
		if r.Method != http.MethodGet {
			writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		lay, err := s.Coord.Store.GetSharedLayout(r.Context(), parts[1])
		if err != nil {
			if errors.Is(err, storage.ErrLayoutNotFound) {
				writeJSONError(w, http.StatusNotFound, "shared layout not found")
				return
			}
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		var syms []string
		for _, tok := range strings.Split(lay.Symbols, ",") {
			if tok = strings.TrimSpace(tok); tok != "" {
				syms = append(syms, tok)
			}
		}
		drawings, _ := s.Coord.Store.ListDrawingsForSharedLayout(r.Context(), lay.ID, syms)
		if drawings == nil {
			drawings = []storage.SavedDrawing{}
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"layout":   lay,
			"drawings": drawings,
			"readOnly": true,
		})
		return
	}

	id := parts[0]
	if len(parts) == 2 {
		switch parts[1] {
		case "copy":
			if r.Method != http.MethodPost {
				writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
				return
			}
			var req struct {
				Name string `json:"name"`
			}
			_ = json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&req)
			copied, err := s.Coord.Store.CopyLayout(r.Context(), id, req.Name)
			if err != nil {
				if errors.Is(err, storage.ErrLayoutNotFound) {
					writeJSONError(w, http.StatusNotFound, err.Error())
					return
				}
				writeJSONError(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeJSON(w, http.StatusCreated, copied)
			return

		case "share":
			if r.Method != http.MethodPost {
				writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
				return
			}
			var req struct {
				Shared     bool `json:"shared"`
				Regenerate bool `json:"regenerate"`
			}
			if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&req); err != nil {
				writeJSONError(w, http.StatusBadRequest, "invalid json")
				return
			}
			updated, err := s.Coord.Store.SetLayoutSharing(r.Context(), id, req.Shared, req.Regenerate)
			if err != nil {
				if errors.Is(err, storage.ErrLayoutNotFound) {
					writeJSONError(w, http.StatusNotFound, err.Error())
					return
				}
				writeJSONError(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"id":         updated.ID,
				"isShared":   updated.IsShared,
				"shareToken": updated.ShareToken,
				"updatedAt":  updated.UpdatedAt,
			})
			return
		default:
			writeJSONError(w, http.StatusNotFound, "endpoint not found")
			return
		}
	}

	if len(parts) != 1 {
		writeJSONError(w, http.StatusNotFound, "endpoint not found")
		return
	}

	switch r.Method {
	case http.MethodGet:
		lay, err := s.Coord.Store.GetLayout(r.Context(), id)
		if err != nil {
			if errors.Is(err, storage.ErrLayoutNotFound) {
				writeJSONError(w, http.StatusNotFound, err.Error())
				return
			}
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, lay)

	case http.MethodPut:
		body, err := io.ReadAll(io.LimitReader(r.Body, storage.MaxLayoutBytes+4096))
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "read body")
			return
		}
		var req struct {
			Name       *string         `json:"name"`
			State      json.RawMessage `json:"state"`
			GridID     *string         `json:"gridId"`
			ChartCount *int            `json:"chartCount"`
			Symbols    *string         `json:"symbols"`
			Autosave   *bool           `json:"autosave"`
		}
		if err := json.Unmarshal(body, &req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid json")
			return
		}
		if req.Name != nil && len(strings.TrimSpace(*req.Name)) > 120 {
			writeJSONError(w, http.StatusBadRequest, "name too long (max 120 chars)")
			return
		}
		if len(req.State) > 0 && !json.Valid(req.State) {
			writeJSONError(w, http.StatusBadRequest, "invalid state json")
			return
		}
		if len(req.State) > storage.MaxLayoutBytes {
			writeJSONError(w, http.StatusRequestEntityTooLarge, "layout state too large")
			return
		}
		updated, err := s.Coord.Store.UpdateLayout(r.Context(), id, storage.UpdateLayoutPatch{
			Name:       req.Name,
			State:      req.State,
			GridID:     req.GridID,
			ChartCount: req.ChartCount,
			Symbols:    req.Symbols,
			Autosave:   req.Autosave,
		})
		if err != nil {
			if errors.Is(err, storage.ErrLayoutNotFound) {
				writeJSONError(w, http.StatusNotFound, err.Error())
				return
			}
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, updated)

	case http.MethodDelete:
		if err := s.Coord.Store.DeleteLayout(r.Context(), id); err != nil {
			if errors.Is(err, storage.ErrLayoutNotFound) {
				writeJSONError(w, http.StatusNotFound, err.Error())
				return
			}
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})

	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
