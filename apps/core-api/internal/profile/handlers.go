package profile

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

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
		r.Get("/users/me/presentations", h.presentations)
		r.Get("/users/{id}", h.getByID)
	})
}

func (h *handlers) get(w http.ResponseWriter, r *http.Request) {
	principal, _ := auth.PrincipalFromContext(r.Context())
	h.writeUser(w, r, principal.ID)
}

func (h *handlers) getByID(w http.ResponseWriter, r *http.Request) {
	principal, _ := auth.PrincipalFromContext(r.Context())
	id := chi.URLParam(r, "id")
	if id != principal.ID && principal.Role != "ADMIN" && principal.Role != "ORG_ADMIN" && principal.Role != "SYSTEM_ADMIN" {
		writeJSON(w, http.StatusForbidden, map[string]any{"statusCode": 403, "message": "Access denied"})
		return
	}
	h.writeUser(w, r, id)
}

func (h *handlers) writeUser(w http.ResponseWriter, r *http.Request, id string) {
	var selectedID, email, role string
	var name, image, organizationID *string
	var preferences json.RawMessage
	var createdAt any
	err := h.pool.QueryRow(r.Context(), `
		SELECT id,email,name,image,role::text,preferences,"organizationId","createdAt"
		FROM "User" WHERE id=$1`, id).
		Scan(&selectedID, &email, &name, &image, &role, &preferences, &organizationID, &createdAt)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": selectedID, "email": email, "name": name, "image": image, "role": role,
		"preferences": preferences, "organizationId": organizationID, "createdAt": createdAt,
	})
}

func (h *handlers) presentations(w http.ResponseWriter, r *http.Request) {
	principal, _ := auth.PrincipalFromContext(r.Context())
	page, ok := positiveQuery(r, "page", 1)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]any{"statusCode": 400, "message": "page must be a positive integer"})
		return
	}
	limit, ok := positiveQuery(r, "limit", 10)
	if !ok || limit > 100 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"statusCode": 400, "message": "limit must be between 1 and 100"})
		return
	}
	var total int
	if err := h.pool.QueryRow(r.Context(), `SELECT COUNT(*) FROM "Presentation" WHERE "userId"=$1`, principal.ID).Scan(&total); err != nil {
		writeError(w, err)
		return
	}
	rows, err := h.pool.Query(r.Context(), `
		SELECT p.id,p.title,p.status::text,p."sourceType"::text,p."createdAt",p."updatedAt",COUNT(s.id)
		FROM "Presentation" p LEFT JOIN "Slide" s ON s."presentationId"=p.id
		WHERE p."userId"=$1 GROUP BY p.id
		ORDER BY p."updatedAt" DESC OFFSET $2 LIMIT $3`, principal.ID, (page-1)*limit, limit)
	if err != nil {
		writeError(w, err)
		return
	}
	defer rows.Close()
	values := []map[string]any{}
	for rows.Next() {
		var id, title, status, sourceType string
		var createdAt, updatedAt any
		var slideCount int
		if err := rows.Scan(&id, &title, &status, &sourceType, &createdAt, &updatedAt, &slideCount); err != nil {
			writeError(w, err)
			return
		}
		values = append(values, map[string]any{
			"id": id, "title": title, "status": status, "sourceType": sourceType,
			"createdAt": createdAt, "updatedAt": updatedAt, "_count": map[string]int{"slides": slideCount},
		})
	}
	if err := rows.Err(); err != nil {
		writeError(w, err)
		return
	}
	totalPages := 0
	if total > 0 {
		totalPages = (total + limit - 1) / limit
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"data": values, "total": total, "page": page, "limit": limit, "totalPages": totalPages,
	})
}

func positiveQuery(r *http.Request, name string, fallback int) (int, bool) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return fallback, true
	}
	value, err := strconv.Atoi(raw)
	return value, err == nil && value > 0
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
