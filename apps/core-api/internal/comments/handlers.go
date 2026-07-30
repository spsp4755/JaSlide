package comments

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

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
		r.Get("/presentations/{presentationId}/comments", h.listByPresentation)
		r.Get("/slides/{slideId}/comments", h.listBySlide)
		r.Post("/presentations/{presentationId}/comments", h.create)
		r.Patch("/comments/{id}", h.update)
		r.Delete("/comments/{id}", h.delete)
		r.Post("/comments/{id}/resolve", h.resolve(true))
		r.Post("/comments/{id}/unresolve", h.resolve(false))
	})
}

type commentResponse struct {
	ID             string         `json:"id"`
	PresentationID string         `json:"presentationId"`
	SlideID        *string        `json:"slideId"`
	UserID         string         `json:"userId"`
	Content        string         `json:"content"`
	ParentID       *string        `json:"parentId"`
	IsResolved     bool           `json:"isResolved"`
	CreatedAt      any            `json:"createdAt"`
	UpdatedAt      any            `json:"updatedAt"`
	User           map[string]any `json:"user"`
}

func (h *handlers) listByPresentation(w http.ResponseWriter, r *http.Request) {
	principal, _ := auth.PrincipalFromContext(r.Context())
	presentationID := chi.URLParam(r, "presentationId")
	if !h.checkPresentationAccess(w, r, presentationID, principal.ID, true) {
		return
	}
	h.list(w, r, `c."presentationId"=$1`, presentationID)
}

func (h *handlers) listBySlide(w http.ResponseWriter, r *http.Request) {
	principal, _ := auth.PrincipalFromContext(r.Context())
	slideID := chi.URLParam(r, "slideId")
	var ownerID string
	var public bool
	err := h.pool.QueryRow(r.Context(), `
		SELECT p."userId",p."isPublic"
		FROM "Slide" s JOIN "Presentation" p ON p.id=s."presentationId" WHERE s.id=$1`, slideID).
		Scan(&ownerID, &public)
	if err != nil {
		writeError(w, err)
		return
	}
	if ownerID != principal.ID && !public {
		writeForbidden(w)
		return
	}
	h.list(w, r, `c."slideId"=$1`, slideID)
}

func (h *handlers) list(w http.ResponseWriter, r *http.Request, where string, arg any) {
	rows, err := h.pool.Query(r.Context(), `
		SELECT c.id,c."presentationId",c."slideId",c."userId",c.content,c."parentId",
		       c."isResolved",c."createdAt",c."updatedAt",u.id,u.name,u.email,u.image
		FROM "Comment" c JOIN "User" u ON u.id=c."userId"
		WHERE `+where+` ORDER BY c."createdAt" ASC`, arg)
	if err != nil {
		writeError(w, err)
		return
	}
	defer rows.Close()
	result := []commentResponse{}
	for rows.Next() {
		comment, err := scanComment(rows)
		if err != nil {
			writeError(w, err)
			return
		}
		result = append(result, comment)
	}
	if err := rows.Err(); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *handlers) create(w http.ResponseWriter, r *http.Request) {
	principal, _ := auth.PrincipalFromContext(r.Context())
	presentationID := chi.URLParam(r, "presentationId")
	if !h.checkPresentationAccess(w, r, presentationID, principal.ID, false) {
		return
	}
	var input struct {
		Content  string  `json:"content"`
		SlideID  *string `json:"slideId"`
		ParentID *string `json:"parentId"`
	}
	if !decode(w, r, &input) {
		return
	}
	id := newID()
	_, err := h.pool.Exec(r.Context(), `
		INSERT INTO "Comment"(id,"presentationId","slideId","userId",content,"parentId","isResolved","createdAt","updatedAt")
		VALUES($1,$2,$3,$4,$5,$6,false,now(),now())`,
		id, presentationID, input.SlideID, principal.ID, input.Content, input.ParentID)
	if err != nil {
		writeError(w, err)
		return
	}
	comment, err := h.findByID(r, id)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, comment)
}

func (h *handlers) update(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Content    *string `json:"content"`
		IsResolved *bool   `json:"isResolved"`
	}
	if !decode(w, r, &input) {
		return
	}
	h.updateComment(w, r, input.Content, input.IsResolved)
}

func (h *handlers) resolve(value bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h.updateComment(w, r, nil, &value)
	}
}

func (h *handlers) updateComment(w http.ResponseWriter, r *http.Request, content *string, resolved *bool) {
	principal, _ := auth.PrincipalFromContext(r.Context())
	id := chi.URLParam(r, "id")
	var commentOwner, presentationOwner string
	err := h.pool.QueryRow(r.Context(), `
		SELECT c."userId",p."userId"
		FROM "Comment" c JOIN "Presentation" p ON p.id=c."presentationId" WHERE c.id=$1`, id).
		Scan(&commentOwner, &presentationOwner)
	if err != nil {
		writeError(w, err)
		return
	}
	if principal.ID != commentOwner && principal.ID != presentationOwner {
		writeForbidden(w)
		return
	}
	if resolved != nil && principal.ID != presentationOwner {
		writeJSON(w, http.StatusForbidden, map[string]any{
			"statusCode": 403, "message": "Only presentation owner can resolve comments",
		})
		return
	}
	if _, err := h.pool.Exec(r.Context(), `
		UPDATE "Comment" SET content=COALESCE($2,content),"isResolved"=COALESCE($3,"isResolved"),"updatedAt"=now()
		WHERE id=$1`, id, content, resolved); err != nil {
		writeError(w, err)
		return
	}
	comment, err := h.findByID(r, id)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, comment)
}

func (h *handlers) delete(w http.ResponseWriter, r *http.Request) {
	principal, _ := auth.PrincipalFromContext(r.Context())
	id := chi.URLParam(r, "id")
	var commentOwner, presentationOwner string
	err := h.pool.QueryRow(r.Context(), `
		SELECT c."userId",p."userId"
		FROM "Comment" c JOIN "Presentation" p ON p.id=c."presentationId" WHERE c.id=$1`, id).
		Scan(&commentOwner, &presentationOwner)
	if err != nil {
		writeError(w, err)
		return
	}
	if principal.ID != commentOwner && principal.ID != presentationOwner {
		writeForbidden(w)
		return
	}
	if _, err := h.pool.Exec(r.Context(), `DELETE FROM "Comment" WHERE id=$1`, id); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *handlers) findByID(r *http.Request, id string) (commentResponse, error) {
	row := h.pool.QueryRow(r.Context(), `
		SELECT c.id,c."presentationId",c."slideId",c."userId",c.content,c."parentId",
		       c."isResolved",c."createdAt",c."updatedAt",u.id,u.name,u.email,u.image
		FROM "Comment" c JOIN "User" u ON u.id=c."userId" WHERE c.id=$1`, id)
	return scanComment(row)
}

type scanner interface {
	Scan(...any) error
}

func scanComment(row scanner) (commentResponse, error) {
	var result commentResponse
	var userID, email string
	var name, image *string
	err := row.Scan(
		&result.ID, &result.PresentationID, &result.SlideID, &result.UserID, &result.Content,
		&result.ParentID, &result.IsResolved, &result.CreatedAt, &result.UpdatedAt,
		&userID, &name, &email, &image,
	)
	result.User = map[string]any{"id": userID, "name": name, "email": email, "image": image}
	return result, err
}

func (h *handlers) checkPresentationAccess(w http.ResponseWriter, r *http.Request, presentationID, userID string, allowPublic bool) bool {
	var ownerID string
	var public, collaborator bool
	err := h.pool.QueryRow(r.Context(), `
		SELECT p."userId",p."isPublic",
		       EXISTS(SELECT 1 FROM "Collaborator" c WHERE c."presentationId"=p.id AND c."userId"=$2)
		FROM "Presentation" p WHERE p.id=$1`, presentationID, userID).
		Scan(&ownerID, &public, &collaborator)
	if err != nil {
		writeError(w, err)
		return false
	}
	if ownerID != userID && !collaborator && !(allowPublic && public) {
		writeForbidden(w)
		return false
	}
	return true
}

func decode(w http.ResponseWriter, r *http.Request, value any) bool {
	if err := httpjson.Decode(r, w, 2<<20, value); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"statusCode": 400, "message": "Invalid JSON body"})
		return false
	}
	return true
}

func writeError(w http.ResponseWriter, err error) {
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]any{"statusCode": 404, "message": "Not found"})
		return
	}
	writeJSON(w, http.StatusInternalServerError, map[string]any{"statusCode": 500, "message": "Internal server error"})
}

func writeForbidden(w http.ResponseWriter) {
	writeJSON(w, http.StatusForbidden, map[string]any{"statusCode": 403, "message": "Access denied"})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func newID() string {
	var raw [12]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "c" + strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return "c" + hex.EncodeToString(raw[:])
}
