package profile

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/auth"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/httpjson"
)

type handlers struct {
	pool *pgxpool.Pool
}

func RegisterRoutes(router chi.Router, store *db.Store, authService *auth.Service) {
	h := &handlers{}
	if store != nil {
		h.pool = store.Pool()
	}
	router.Group(func(r chi.Router) {
		r.Use(auth.RequireUser(authService))
		r.Get("/users/me", h.get)
		r.Put("/users/me", h.update)
	})
}

func (h *handlers) get(w http.ResponseWriter, r *http.Request) {
	principal, _ := auth.PrincipalFromContext(r.Context())
	var id, email, role string
	var name, image, organizationID *string
	var preferences json.RawMessage
	var createdAt any
	err := h.pool.QueryRow(r.Context(), `
		SELECT id,email,name,image,role::text,preferences,"organizationId","createdAt"
		FROM "User" WHERE id=$1`, principal.ID).
		Scan(&id, &email, &name, &image, &role, &preferences, &organizationID, &createdAt)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": id, "email": email, "name": name, "image": image, "role": role,
		"preferences": preferences, "organizationId": organizationID, "createdAt": createdAt,
	})
}

func (h *handlers) update(w http.ResponseWriter, r *http.Request) {
	principal, _ := auth.PrincipalFromContext(r.Context())
	var input struct {
		Name        *string         `json:"name"`
		Image       *string         `json:"image"`
		Preferences json.RawMessage `json:"preferences"`
	}
	if err := httpjson.Decode(r, w, 2<<20, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"statusCode": 400, "message": "Invalid JSON body"})
		return
	}
	var preferences any
	if len(input.Preferences) > 0 && string(input.Preferences) != "null" {
		var object map[string]any
		if err := json.Unmarshal(input.Preferences, &object); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"statusCode": 400, "message": "preferences must be an object"})
			return
		}
		preferences = string(input.Preferences)
	}
	var id, email, role string
	var name, image, organizationID *string
	var savedPreferences json.RawMessage
	err := h.pool.QueryRow(r.Context(), `
		UPDATE "User" SET
			name=COALESCE($2,name),image=COALESCE($3,image),
			preferences=COALESCE($4::jsonb,preferences),"updatedAt"=now()
		WHERE id=$1
		RETURNING id,email,name,image,role::text,preferences,"organizationId"`,
		principal.ID, input.Name, input.Image, preferences).
		Scan(&id, &email, &name, &image, &role, &savedPreferences, &organizationID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": id, "email": email, "name": name, "image": image, "role": role,
		"preferences": savedPreferences, "organizationId": organizationID,
	})
}

func writeError(w http.ResponseWriter, err error) {
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]any{"statusCode": 404, "message": "User not found"})
		return
	}
	writeJSON(w, http.StatusInternalServerError, map[string]any{"statusCode": 500, "message": "Internal server error"})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
