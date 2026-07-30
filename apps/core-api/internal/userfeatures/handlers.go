package userfeatures

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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

		r.Get("/slides/{slideId}/blocks", h.listBlocks)
		r.Post("/slides/{slideId}/blocks", h.createBlock)
		r.Post("/slides/{slideId}/blocks/reorder", h.reorderBlocks)
		r.Get("/blocks/{id}", h.getBlock)
		r.Patch("/blocks/{id}", h.updateBlock)
		r.Delete("/blocks/{id}", h.deleteBlock)
		r.Post("/blocks/{id}/duplicate", h.duplicateBlock)

		r.Get("/presentations/{presentationId}/collaborators", h.listCollaborators)
		r.Post("/presentations/{presentationId}/collaborators", h.inviteCollaborator)
		r.Patch("/collaborators/{id}", h.updateCollaborator)
		r.Delete("/collaborators/{id}", h.deleteCollaborator)

		r.Route("/favorites", func(r chi.Router) {
			r.Get("/", h.listFavorites)
			r.Post("/", h.createFavorite)
			r.Patch("/{id}", h.updateFavorite)
			r.Delete("/{id}", h.deleteFavorite)
			r.Post("/reorder", h.reorderFavorites)
		})
		r.Route("/export-presets", func(r chi.Router) {
			r.Get("/", h.listExportPresets)
			r.Get("/default", h.defaultExportPreset)
			r.Get("/{id}", h.getExportPreset)
			r.Post("/", h.createExportPreset)
			r.Patch("/{id}", h.updateExportPreset)
			r.Delete("/{id}", h.deleteExportPreset)
		})
		r.Route("/input-prompts", func(r chi.Router) {
			r.Get("/", h.listInputPrompts)
			r.Get("/recent", h.recentInputPrompts)
			r.Get("/{id}", h.getInputPrompt)
			r.Post("/", h.createInputPrompt)
			r.Patch("/{id}", h.updateInputPrompt)
			r.Delete("/{id}", h.deleteInputPrompt)
		})
		r.Route("/recent-works", func(r chi.Router) {
			r.Get("/", h.listRecentWorks)
			r.Post("/{presentationId}", h.recordRecentWork)
			r.Delete("/{presentationId}", h.deleteRecentWork)
			r.Delete("/", h.clearRecentWorks)
		})
		r.Route("/organizations/{organizationId}/color-palettes", func(r chi.Router) {
			r.Get("/", h.listColorPalettes)
			r.Get("/{id}", h.getColorPalette)
			r.Post("/", h.createColorPalette)
			r.Patch("/{id}", h.updateColorPalette)
			r.Delete("/{id}", h.deleteColorPalette)
		})
		r.Route("/organizations/{organizationId}/font-sets", func(r chi.Router) {
			r.Get("/", h.listFontSets)
			r.Get("/{id}", h.getFontSet)
			r.Post("/", h.createFontSet)
			r.Patch("/{id}", h.updateFontSet)
			r.Delete("/{id}", h.deleteFontSet)
		})
	})
}

type block struct {
	ID        string          `json:"id"`
	SlideID   string          `json:"slideId"`
	Type      string          `json:"type"`
	Order     int             `json:"order"`
	Content   json.RawMessage `json:"content"`
	Style     json.RawMessage `json:"style"`
	CreatedAt any             `json:"createdAt"`
	UpdatedAt any             `json:"updatedAt"`
}

func (h *handlers) listBlocks(w http.ResponseWriter, r *http.Request) {
	if !h.slideAccess(w, r, chi.URLParam(r, "slideId"), false) {
		return
	}
	rows, err := h.pool.Query(r.Context(), blockSelect+` WHERE "slideId"=$1 ORDER BY "order"`, chi.URLParam(r, "slideId"))
	if err != nil {
		writeError(w, err)
		return
	}
	defer rows.Close()
	result := []block{}
	for rows.Next() {
		value, err := scanBlock(rows)
		if err != nil {
			writeError(w, err)
			return
		}
		result = append(result, value)
	}
	if err := rows.Err(); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *handlers) getBlock(w http.ResponseWriter, r *http.Request) {
	value, ownerID, public, err := h.blockByID(r, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, err)
		return
	}
	if ownerID != userID(r) && !public {
		writeForbidden(w, "Access denied")
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func (h *handlers) createBlock(w http.ResponseWriter, r *http.Request) {
	slideID := chi.URLParam(r, "slideId")
	if !h.slideAccess(w, r, slideID, true) {
		return
	}
	var input struct {
		Type    string          `json:"type"`
		Order   *int            `json:"order"`
		Content json.RawMessage `json:"content"`
		Style   json.RawMessage `json:"style"`
	}
	if !decode(w, r, &input) {
		return
	}
	if !blockTypes[input.Type] || invalidOrder(input.Order) ||
		!optionalObject(input.Content) || !optionalObject(input.Style) {
		writeBadRequest(w, "type, order, content, or style is invalid")
		return
	}
	order := input.Order
	if order == nil {
		value := 0
		if err := h.pool.QueryRow(r.Context(), `SELECT COALESCE(MAX("order")+1,0) FROM "Block" WHERE "slideId"=$1`, slideID).Scan(&value); err != nil {
			writeError(w, err)
			return
		}
		order = &value
	}
	if len(input.Content) == 0 {
		input.Content = json.RawMessage(`{}`)
	}
	if len(input.Style) == 0 {
		input.Style = json.RawMessage(`{}`)
	}
	id := newID()
	value, err := scanBlock(h.pool.QueryRow(r.Context(), `
		INSERT INTO "Block"(id,"slideId",type,"order",content,style,"createdAt","updatedAt")
		VALUES($1,$2,$3::"BlockType",$4,$5::jsonb,$6::jsonb,now(),now())
		RETURNING id,"slideId",type::text,"order",content,style,"createdAt","updatedAt"`,
		id, slideID, input.Type, *order, input.Content, input.Style))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, value)
}

func (h *handlers) updateBlock(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	_, ownerID, _, err := h.blockByID(r, id)
	if err != nil {
		writeError(w, err)
		return
	}
	if ownerID != userID(r) {
		writeForbidden(w, "Access denied")
		return
	}
	var input struct {
		Type    *string         `json:"type"`
		Order   *int            `json:"order"`
		Content json.RawMessage `json:"content"`
		Style   json.RawMessage `json:"style"`
	}
	if !decode(w, r, &input) {
		return
	}
	if (input.Type != nil && !blockTypes[*input.Type]) || invalidOrder(input.Order) ||
		!optionalObject(input.Content) || !optionalObject(input.Style) {
		writeBadRequest(w, "type, order, content, or style is invalid")
		return
	}
	value, err := scanBlock(h.pool.QueryRow(r.Context(), `
		UPDATE "Block" SET
			type=COALESCE($2::"BlockType",type),"order"=COALESCE($3,"order"),
			content=COALESCE($4::jsonb,content),style=COALESCE($5::jsonb,style),"updatedAt"=now()
		WHERE id=$1
		RETURNING id,"slideId",type::text,"order",content,style,"createdAt","updatedAt"`,
		id, input.Type, input.Order, nullableJSON(input.Content), nullableJSON(input.Style)))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func (h *handlers) deleteBlock(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	value, ownerID, _, err := h.blockByID(r, id)
	if err != nil {
		writeError(w, err)
		return
	}
	if ownerID != userID(r) {
		writeForbidden(w, "Access denied")
		return
	}
	tx, err := h.pool.Begin(r.Context())
	if err == nil {
		_, err = tx.Exec(r.Context(), `DELETE FROM "Block" WHERE id=$1`, id)
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `UPDATE "Block" SET "order"="order"-1,"updatedAt"=now() WHERE "slideId"=$1 AND "order">$2`, value.SlideID, value.Order)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	} else if tx != nil {
		_ = tx.Rollback(r.Context())
	}
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *handlers) reorderBlocks(w http.ResponseWriter, r *http.Request) {
	slideID := chi.URLParam(r, "slideId")
	if !h.slideAccess(w, r, slideID, true) {
		return
	}
	var input struct {
		BlockOrders []struct {
			BlockID string `json:"blockId"`
			Order   int    `json:"order"`
		} `json:"blockOrders"`
	}
	if !decode(w, r, &input) {
		return
	}
	if input.BlockOrders == nil {
		writeBadRequest(w, "blockOrders must be an array")
		return
	}
	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	for _, item := range input.BlockOrders {
		if item.BlockID == "" || item.Order < 0 {
			writeBadRequest(w, "blockId and non-negative order are required")
			return
		}
		tag, err := tx.Exec(r.Context(), `UPDATE "Block" SET "order"=$3,"updatedAt"=now() WHERE id=$1 AND "slideId"=$2`, item.BlockID, slideID, item.Order)
		if err != nil {
			writeError(w, err)
			return
		}
		if tag.RowsAffected() != 1 {
			writeBadRequest(w, "block does not belong to slide")
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, err)
		return
	}
	h.listBlocks(w, r)
}

func (h *handlers) duplicateBlock(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	value, ownerID, _, err := h.blockByID(r, id)
	if err != nil {
		writeError(w, err)
		return
	}
	if ownerID != userID(r) {
		writeForbidden(w, "Access denied")
		return
	}
	var order int
	if err := h.pool.QueryRow(r.Context(), `SELECT COALESCE(MAX("order")+1,0) FROM "Block" WHERE "slideId"=$1`, value.SlideID).Scan(&order); err != nil {
		writeError(w, err)
		return
	}
	duplicate, err := scanBlock(h.pool.QueryRow(r.Context(), `
		INSERT INTO "Block"(id,"slideId",type,"order",content,style,"createdAt","updatedAt")
		VALUES($1,$2,$3::"BlockType",$4,$5::jsonb,$6::jsonb,now(),now())
		RETURNING id,"slideId",type::text,"order",content,style,"createdAt","updatedAt"`,
		newID(), value.SlideID, value.Type, order, value.Content, value.Style))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, duplicate)
}

func (h *handlers) blockByID(r *http.Request, id string) (block, string, bool, error) {
	var value block
	var ownerID string
	var public bool
	err := h.pool.QueryRow(r.Context(), `
		SELECT b.id,b."slideId",b.type::text,b."order",b.content,b.style,b."createdAt",b."updatedAt",
		       p."userId",p."isPublic"
		FROM "Block" b JOIN "Slide" s ON s.id=b."slideId"
		JOIN "Presentation" p ON p.id=s."presentationId" WHERE b.id=$1`, id).
		Scan(&value.ID, &value.SlideID, &value.Type, &value.Order, &value.Content, &value.Style,
			&value.CreatedAt, &value.UpdatedAt, &ownerID, &public)
	return value, ownerID, public, err
}

func (h *handlers) slideAccess(w http.ResponseWriter, r *http.Request, slideID string, write bool) bool {
	var ownerID string
	var public bool
	err := h.pool.QueryRow(r.Context(), `
		SELECT p."userId",p."isPublic" FROM "Slide" s
		JOIN "Presentation" p ON p.id=s."presentationId" WHERE s.id=$1`, slideID).
		Scan(&ownerID, &public)
	if err != nil {
		writeError(w, err)
		return false
	}
	if ownerID != userID(r) && (write || !public) {
		writeForbidden(w, "Access denied")
		return false
	}
	return true
}

const blockSelect = `SELECT id,"slideId",type::text,"order",content,style,"createdAt","updatedAt" FROM "Block"`

func scanBlock(row interface{ Scan(...any) error }) (block, error) {
	var value block
	err := row.Scan(&value.ID, &value.SlideID, &value.Type, &value.Order, &value.Content, &value.Style, &value.CreatedAt, &value.UpdatedAt)
	return value, err
}

var blockTypes = map[string]bool{"TEXT": true, "IMAGE": true, "CHART": true, "TABLE": true, "ICON": true, "SHAPE": true}

type collaborator struct {
	ID             string         `json:"id"`
	PresentationID string         `json:"presentationId"`
	UserID         string         `json:"userId"`
	Role           string         `json:"role"`
	InvitedBy      string         `json:"invitedBy"`
	JoinedAt       any            `json:"joinedAt"`
	User           map[string]any `json:"user"`
}

func (h *handlers) listCollaborators(w http.ResponseWriter, r *http.Request) {
	presentationID := chi.URLParam(r, "presentationId")
	var owner map[string]any
	var ownerID, email string
	var name, image *string
	var public, member bool
	err := h.pool.QueryRow(r.Context(), `
		SELECT u.id,u.name,u.email,u.image,p."isPublic",
		       EXISTS(SELECT 1 FROM "Collaborator" c WHERE c."presentationId"=p.id AND c."userId"=$2)
		FROM "Presentation" p JOIN "User" u ON u.id=p."userId" WHERE p.id=$1`,
		presentationID, userID(r)).Scan(&ownerID, &name, &email, &image, &public, &member)
	if err != nil {
		writeError(w, err)
		return
	}
	if ownerID != userID(r) && !public && !member {
		writeForbidden(w, "Access denied")
		return
	}
	owner = map[string]any{"id": ownerID, "name": name, "email": email, "image": image}
	rows, err := h.pool.Query(r.Context(), collaboratorSelect+` WHERE c."presentationId"=$1 ORDER BY c."joinedAt"`, presentationID)
	if err != nil {
		writeError(w, err)
		return
	}
	defer rows.Close()
	values := []collaborator{}
	for rows.Next() {
		value, err := scanCollaborator(rows)
		if err != nil {
			writeError(w, err)
			return
		}
		values = append(values, value)
	}
	if err := rows.Err(); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"owner": owner, "collaborators": values})
}

func (h *handlers) inviteCollaborator(w http.ResponseWriter, r *http.Request) {
	presentationID := chi.URLParam(r, "presentationId")
	if !h.presentationOwner(w, r, presentationID) {
		return
	}
	var input struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if !decode(w, r, &input) {
		return
	}
	input.Email = strings.TrimSpace(strings.ToLower(input.Email))
	if input.Email == "" {
		writeBadRequest(w, "email is required")
		return
	}
	if input.Role == "" {
		input.Role = "VIEWER"
	}
	if !collaboratorRoles[input.Role] {
		writeBadRequest(w, "role is invalid")
		return
	}
	var invitedID string
	if err := h.pool.QueryRow(r.Context(), `SELECT id FROM "User" WHERE LOWER(email)=LOWER($1)`, input.Email).Scan(&invitedID); err != nil {
		writeError(w, err)
		return
	}
	if invitedID == userID(r) {
		writeBadRequest(w, "Cannot invite yourself")
		return
	}
	value, err := scanCollaborator(h.pool.QueryRow(r.Context(), `
		INSERT INTO "Collaborator"(id,"presentationId","userId",role,"invitedBy","joinedAt")
		VALUES($1,$2,$3,$4::"CollaboratorRole",$5,now())
		RETURNING id,"presentationId","userId",role::text,"invitedBy","joinedAt",
		          (SELECT id FROM "User" WHERE id=$3),(SELECT name FROM "User" WHERE id=$3),
		          (SELECT email FROM "User" WHERE id=$3),(SELECT image FROM "User" WHERE id=$3)`,
		newID(), presentationID, invitedID, input.Role, userID(r)))
	if err != nil {
		if uniqueViolation(err) {
			writeBadRequest(w, "User is already a collaborator")
			return
		}
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, value)
}

func (h *handlers) updateCollaborator(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var ownerID string
	if err := h.pool.QueryRow(r.Context(), `
		SELECT p."userId" FROM "Collaborator" c JOIN "Presentation" p ON p.id=c."presentationId" WHERE c.id=$1`, id).Scan(&ownerID); err != nil {
		writeError(w, err)
		return
	}
	if ownerID != userID(r) {
		writeForbidden(w, "Only the owner can change collaborator roles")
		return
	}
	var input struct {
		Role string `json:"role"`
	}
	if !decode(w, r, &input) {
		return
	}
	if !collaboratorRoles[input.Role] {
		writeBadRequest(w, "role is invalid")
		return
	}
	value, err := scanCollaborator(h.pool.QueryRow(r.Context(), collaboratorUpdateReturning, input.Role, id))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func (h *handlers) deleteCollaborator(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var ownerID, collaboratorID string
	err := h.pool.QueryRow(r.Context(), `
		SELECT p."userId",c."userId" FROM "Collaborator" c
		JOIN "Presentation" p ON p.id=c."presentationId" WHERE c.id=$1`, id).Scan(&ownerID, &collaboratorID)
	if err != nil {
		writeError(w, err)
		return
	}
	if userID(r) != ownerID && userID(r) != collaboratorID {
		writeForbidden(w, "Access denied")
		return
	}
	if _, err := h.pool.Exec(r.Context(), `DELETE FROM "Collaborator" WHERE id=$1`, id); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

const collaboratorSelect = `
	SELECT c.id,c."presentationId",c."userId",c.role::text,c."invitedBy",c."joinedAt",
	       u.id,u.name,u.email,u.image
	FROM "Collaborator" c JOIN "User" u ON u.id=c."userId"`

const collaboratorUpdateReturning = `
	UPDATE "Collaborator" SET role=$1::"CollaboratorRole" WHERE id=$2
	RETURNING id,"presentationId","userId",role::text,"invitedBy","joinedAt",
	          (SELECT id FROM "User" WHERE id="userId"),(SELECT name FROM "User" WHERE id="userId"),
	          (SELECT email FROM "User" WHERE id="userId"),(SELECT image FROM "User" WHERE id="userId")`

func scanCollaborator(row interface{ Scan(...any) error }) (collaborator, error) {
	var value collaborator
	var id, email string
	var name, image *string
	err := row.Scan(&value.ID, &value.PresentationID, &value.UserID, &value.Role, &value.InvitedBy,
		&value.JoinedAt, &id, &name, &email, &image)
	value.User = map[string]any{"id": id, "name": name, "email": email, "image": image}
	return value, err
}

var collaboratorRoles = map[string]bool{"OWNER": true, "EDITOR": true, "COMMENTER": true, "VIEWER": true}

func (h *handlers) presentationOwner(w http.ResponseWriter, r *http.Request, presentationID string) bool {
	var ownerID string
	if err := h.pool.QueryRow(r.Context(), `SELECT "userId" FROM "Presentation" WHERE id=$1`, presentationID).Scan(&ownerID); err != nil {
		writeError(w, err)
		return false
	}
	if ownerID != userID(r) {
		writeForbidden(w, "Only the owner can manage collaborators")
		return false
	}
	return true
}

type favorite struct {
	ID           string `json:"id"`
	UserID       string `json:"userId"`
	ResourceType string `json:"resourceType"`
	ResourceID   string `json:"resourceId"`
	Order        int    `json:"order"`
	CreatedAt    any    `json:"createdAt"`
}

func (h *handlers) listFavorites(w http.ResponseWriter, r *http.Request) {
	query := favoriteSelect + ` WHERE "userId"=$1`
	args := []any{userID(r)}
	if resourceType := r.URL.Query().Get("type"); resourceType != "" {
		query += ` AND "resourceType"=$2`
		args = append(args, resourceType)
	}
	query += ` ORDER BY "resourceType","order"`
	rows, err := h.pool.Query(r.Context(), query, args...)
	if err != nil {
		writeError(w, err)
		return
	}
	defer rows.Close()
	result := []favorite{}
	for rows.Next() {
		value, err := scanFavorite(rows)
		if err != nil {
			writeError(w, err)
			return
		}
		result = append(result, value)
	}
	if err := rows.Err(); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *handlers) createFavorite(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ResourceType string `json:"resourceType"`
		ResourceID   string `json:"resourceId"`
		Order        *int   `json:"order"`
	}
	if !decode(w, r, &input) {
		return
	}
	if !favoriteTypes[input.ResourceType] || strings.TrimSpace(input.ResourceID) == "" || invalidOrder(input.Order) {
		writeBadRequest(w, "Invalid resource type, resourceId, or order")
		return
	}
	order := input.Order
	if order == nil {
		value := 0
		if err := h.pool.QueryRow(r.Context(), `
			SELECT COALESCE(MAX("order")+1,0) FROM "Favorite" WHERE "userId"=$1 AND "resourceType"=$2`,
			userID(r), input.ResourceType).Scan(&value); err != nil {
			writeError(w, err)
			return
		}
		order = &value
	}
	value, err := scanFavorite(h.pool.QueryRow(r.Context(), `
		INSERT INTO "Favorite"(id,"userId","resourceType","resourceId","order","createdAt")
		VALUES($1,$2,$3,$4,$5,now())
		RETURNING id,"userId","resourceType","resourceId","order","createdAt"`,
		newID(), userID(r), input.ResourceType, input.ResourceID, *order))
	if err != nil {
		if uniqueViolation(err) {
			writeBadRequest(w, "Already in favorites")
			return
		}
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, value)
}

func (h *handlers) updateFavorite(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Order *int `json:"order"`
	}
	if !decode(w, r, &input) {
		return
	}
	if invalidOrder(input.Order) {
		writeBadRequest(w, "order must be non-negative")
		return
	}
	value, err := scanFavorite(h.pool.QueryRow(r.Context(), `
		UPDATE "Favorite" SET "order"=COALESCE($3,"order")
		WHERE id=$1 AND "userId"=$2
		RETURNING id,"userId","resourceType","resourceId","order","createdAt"`,
		chi.URLParam(r, "id"), userID(r), input.Order))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func (h *handlers) deleteFavorite(w http.ResponseWriter, r *http.Request) {
	tag, err := h.pool.Exec(r.Context(), `DELETE FROM "Favorite" WHERE id=$1 AND "userId"=$2`, chi.URLParam(r, "id"), userID(r))
	if err != nil {
		writeError(w, err)
		return
	}
	if tag.RowsAffected() != 1 {
		writeError(w, pgx.ErrNoRows)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *handlers) reorderFavorites(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ResourceType string   `json:"resourceType"`
		OrderedIDs   []string `json:"orderedIds"`
	}
	if !decode(w, r, &input) {
		return
	}
	if !favoriteTypes[input.ResourceType] || input.OrderedIDs == nil {
		writeBadRequest(w, "resourceType and orderedIds are required")
		return
	}
	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	for order, id := range input.OrderedIDs {
		tag, err := tx.Exec(r.Context(), `
			UPDATE "Favorite" SET "order"=$4 WHERE id=$1 AND "userId"=$2 AND "resourceType"=$3`,
			id, userID(r), input.ResourceType, order)
		if err != nil {
			writeError(w, err)
			return
		}
		if tag.RowsAffected() != 1 {
			writeBadRequest(w, "favorite does not belong to user or type")
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, err)
		return
	}
	query := r.URL.Query()
	query.Set("type", input.ResourceType)
	r.URL.RawQuery = query.Encode()
	h.listFavorites(w, r)
}

const favoriteSelect = `SELECT id,"userId","resourceType","resourceId","order","createdAt" FROM "Favorite"`

func scanFavorite(row interface{ Scan(...any) error }) (favorite, error) {
	var value favorite
	err := row.Scan(&value.ID, &value.UserID, &value.ResourceType, &value.ResourceID, &value.Order, &value.CreatedAt)
	return value, err
}

var favoriteTypes = map[string]bool{"template": true, "palette": true, "font": true}

type exportPreset struct {
	ID        string          `json:"id"`
	UserID    string          `json:"userId"`
	Name      string          `json:"name"`
	Format    string          `json:"format"`
	Config    json.RawMessage `json:"config"`
	IsDefault bool            `json:"isDefault"`
	CreatedAt any             `json:"createdAt"`
	UpdatedAt any             `json:"updatedAt"`
}

func (h *handlers) listExportPresets(w http.ResponseWriter, r *http.Request) {
	rows, err := h.pool.Query(r.Context(), exportPresetSelect+` WHERE "userId"=$1 ORDER BY format,name`, userID(r))
	if err != nil {
		writeError(w, err)
		return
	}
	defer rows.Close()
	result := []exportPreset{}
	for rows.Next() {
		value, err := scanExportPreset(rows)
		if err != nil {
			writeError(w, err)
			return
		}
		result = append(result, value)
	}
	if err := rows.Err(); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *handlers) getExportPreset(w http.ResponseWriter, r *http.Request) {
	value, err := scanExportPreset(h.pool.QueryRow(r.Context(), exportPresetSelect+` WHERE id=$1 AND "userId"=$2`, chi.URLParam(r, "id"), userID(r)))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func (h *handlers) defaultExportPreset(w http.ResponseWriter, r *http.Request) {
	value, err := scanExportPreset(h.pool.QueryRow(r.Context(), exportPresetSelect+`
		WHERE "userId"=$1 AND format=$2 AND "isDefault"=true LIMIT 1`, userID(r), r.URL.Query().Get("format")))
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusOK, nil)
		return
	}
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func (h *handlers) createExportPreset(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name      string          `json:"name"`
		Format    string          `json:"format"`
		Config    json.RawMessage `json:"config"`
		IsDefault bool            `json:"isDefault"`
	}
	if !decode(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Name) == "" || strings.TrimSpace(input.Format) == "" || !optionalObject(input.Config) {
		writeBadRequest(w, "name, format, and object config are required")
		return
	}
	if len(input.Config) == 0 {
		input.Config = json.RawMessage(`{}`)
	}
	tx, err := h.pool.Begin(r.Context())
	if err == nil && input.IsDefault {
		_, err = tx.Exec(r.Context(), `UPDATE "ExportPreset" SET "isDefault"=false,"updatedAt"=now() WHERE "userId"=$1 AND format=$2 AND "isDefault"=true`, userID(r), input.Format)
	}
	var value exportPreset
	if err == nil {
		value, err = scanExportPreset(tx.QueryRow(r.Context(), `
			INSERT INTO "ExportPreset"(id,"userId",name,format,config,"isDefault","createdAt","updatedAt")
			VALUES($1,$2,$3,$4,$5::jsonb,$6,now(),now())
			RETURNING id,"userId",name,format,config,"isDefault","createdAt","updatedAt"`,
			newID(), userID(r), input.Name, input.Format, input.Config, input.IsDefault))
	}
	if err == nil {
		err = tx.Commit(r.Context())
	} else if tx != nil {
		_ = tx.Rollback(r.Context())
	}
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, value)
}

func (h *handlers) updateExportPreset(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var currentFormat string
	if err := h.pool.QueryRow(r.Context(), `SELECT format FROM "ExportPreset" WHERE id=$1 AND "userId"=$2`, id, userID(r)).Scan(&currentFormat); err != nil {
		writeError(w, err)
		return
	}
	var input struct {
		Name      *string         `json:"name"`
		Format    *string         `json:"format"`
		Config    json.RawMessage `json:"config"`
		IsDefault *bool           `json:"isDefault"`
	}
	if !decode(w, r, &input) {
		return
	}
	if (input.Name != nil && strings.TrimSpace(*input.Name) == "") ||
		(input.Format != nil && strings.TrimSpace(*input.Format) == "") || !optionalObject(input.Config) {
		writeBadRequest(w, "name, format, or config is invalid")
		return
	}
	format := currentFormat
	if input.Format != nil {
		format = *input.Format
	}
	tx, err := h.pool.Begin(r.Context())
	if err == nil && input.IsDefault != nil && *input.IsDefault {
		_, err = tx.Exec(r.Context(), `
			UPDATE "ExportPreset" SET "isDefault"=false,"updatedAt"=now()
			WHERE "userId"=$1 AND format=$2 AND id<>$3 AND "isDefault"=true`, userID(r), format, id)
	}
	var value exportPreset
	if err == nil {
		value, err = scanExportPreset(tx.QueryRow(r.Context(), `
			UPDATE "ExportPreset" SET name=COALESCE($3,name),format=COALESCE($4,format),
				config=COALESCE($5::jsonb,config),"isDefault"=COALESCE($6,"isDefault"),"updatedAt"=now()
			WHERE id=$1 AND "userId"=$2
			RETURNING id,"userId",name,format,config,"isDefault","createdAt","updatedAt"`,
			id, userID(r), input.Name, input.Format, nullableJSON(input.Config), input.IsDefault))
	}
	if err == nil {
		err = tx.Commit(r.Context())
	} else if tx != nil {
		_ = tx.Rollback(r.Context())
	}
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func (h *handlers) deleteExportPreset(w http.ResponseWriter, r *http.Request) {
	tag, err := h.pool.Exec(r.Context(), `DELETE FROM "ExportPreset" WHERE id=$1 AND "userId"=$2`, chi.URLParam(r, "id"), userID(r))
	if err != nil {
		writeError(w, err)
		return
	}
	if tag.RowsAffected() != 1 {
		writeError(w, pgx.ErrNoRows)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

const exportPresetSelect = `SELECT id,"userId",name,format,config,"isDefault","createdAt","updatedAt" FROM "ExportPreset"`

func scanExportPreset(row interface{ Scan(...any) error }) (exportPreset, error) {
	var value exportPreset
	err := row.Scan(&value.ID, &value.UserID, &value.Name, &value.Format, &value.Config, &value.IsDefault, &value.CreatedAt, &value.UpdatedAt)
	return value, err
}

type inputPrompt struct {
	ID        string          `json:"id"`
	UserID    string          `json:"userId"`
	Content   string          `json:"content"`
	Metadata  json.RawMessage `json:"metadata"`
	CreatedAt any             `json:"createdAt"`
}

func (h *handlers) listInputPrompts(w http.ResponseWriter, r *http.Request) {
	h.queryInputPrompts(w, r, parseLimit(r, 0), r.URL.Query().Get("category"))
}

func (h *handlers) recentInputPrompts(w http.ResponseWriter, r *http.Request) {
	h.queryInputPrompts(w, r, parseLimit(r, 10), "")
}

func (h *handlers) queryInputPrompts(w http.ResponseWriter, r *http.Request, limit int, category string) {
	query := inputPromptSelect + ` WHERE "userId"=$1`
	args := []any{userID(r)}
	if category != "" {
		query += ` AND metadata->>'category'=$2`
		args = append(args, category)
	}
	query += ` ORDER BY "createdAt" DESC`
	if limit > 0 {
		query += ` LIMIT ` + strconv.Itoa(limit)
	}
	rows, err := h.pool.Query(r.Context(), query, args...)
	if err != nil {
		writeError(w, err)
		return
	}
	defer rows.Close()
	result := []inputPrompt{}
	for rows.Next() {
		value, err := scanInputPrompt(rows)
		if err != nil {
			writeError(w, err)
			return
		}
		result = append(result, value)
	}
	if err := rows.Err(); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *handlers) getInputPrompt(w http.ResponseWriter, r *http.Request) {
	value, err := scanInputPrompt(h.pool.QueryRow(r.Context(), inputPromptSelect+` WHERE id=$1 AND "userId"=$2`, chi.URLParam(r, "id"), userID(r)))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func (h *handlers) createInputPrompt(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Text     string  `json:"text"`
		Category *string `json:"category"`
	}
	if !decode(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Text) == "" {
		writeBadRequest(w, "text is required")
		return
	}
	metadata, _ := json.Marshal(categoryMetadata(input.Category))
	value, err := scanInputPrompt(h.pool.QueryRow(r.Context(), `
		INSERT INTO "InputPrompt"(id,"userId",content,metadata,"createdAt")
		VALUES($1,$2,$3,$4::jsonb,now())
		RETURNING id,"userId",content,metadata,"createdAt"`,
		newID(), userID(r), input.Text, nullableJSON(metadata)))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, value)
}

func (h *handlers) updateInputPrompt(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Text     *string `json:"text"`
		Category *string `json:"category"`
	}
	if !decode(w, r, &input) {
		return
	}
	if input.Text != nil && strings.TrimSpace(*input.Text) == "" {
		writeBadRequest(w, "text must not be empty")
		return
	}
	var metadata any
	if value := categoryMetadata(input.Category); value != nil {
		raw, _ := json.Marshal(value)
		metadata = string(raw)
	}
	value, err := scanInputPrompt(h.pool.QueryRow(r.Context(), `
		UPDATE "InputPrompt" SET content=COALESCE($3,content),metadata=COALESCE($4::jsonb,metadata)
		WHERE id=$1 AND "userId"=$2
		RETURNING id,"userId",content,metadata,"createdAt"`,
		chi.URLParam(r, "id"), userID(r), input.Text, metadata))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func (h *handlers) deleteInputPrompt(w http.ResponseWriter, r *http.Request) {
	tag, err := h.pool.Exec(r.Context(), `DELETE FROM "InputPrompt" WHERE id=$1 AND "userId"=$2`, chi.URLParam(r, "id"), userID(r))
	if err != nil {
		writeError(w, err)
		return
	}
	if tag.RowsAffected() != 1 {
		writeError(w, pgx.ErrNoRows)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

const inputPromptSelect = `SELECT id,"userId",content,metadata,"createdAt" FROM "InputPrompt"`

func scanInputPrompt(row interface{ Scan(...any) error }) (inputPrompt, error) {
	var value inputPrompt
	err := row.Scan(&value.ID, &value.UserID, &value.Content, &value.Metadata, &value.CreatedAt)
	return value, err
}

func categoryMetadata(category *string) map[string]string {
	if category == nil || strings.TrimSpace(*category) == "" {
		return nil
	}
	return map[string]string{"category": *category}
}

type recentWork struct {
	ID             string         `json:"id"`
	UserID         string         `json:"userId"`
	PresentationID string         `json:"presentationId"`
	IsPinned       bool           `json:"isPinned"`
	AccessedAt     any            `json:"accessedAt"`
	Presentation   map[string]any `json:"presentation"`
}

func (h *handlers) listRecentWorks(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r, 10)
	rows, err := h.pool.Query(r.Context(), recentWorkSelect+`
		WHERE rw."userId"=$1 ORDER BY rw."accessedAt" DESC LIMIT $2`, userID(r), limit)
	if err != nil {
		writeError(w, err)
		return
	}
	defer rows.Close()
	result := []recentWork{}
	for rows.Next() {
		value, err := scanRecentWork(rows)
		if err != nil {
			writeError(w, err)
			return
		}
		result = append(result, value)
	}
	if err := rows.Err(); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *handlers) recordRecentWork(w http.ResponseWriter, r *http.Request) {
	presentationID := chi.URLParam(r, "presentationId")
	var allowed bool
	if err := h.pool.QueryRow(r.Context(), `
		SELECT EXISTS(
			SELECT 1 FROM "Presentation" p WHERE p.id=$1 AND
			(p."userId"=$2 OR p."isPublic" OR EXISTS(
				SELECT 1 FROM "Collaborator" c WHERE c."presentationId"=p.id AND c."userId"=$2
			))
		)`, presentationID, userID(r)).Scan(&allowed); err != nil {
		writeError(w, err)
		return
	}
	if !allowed {
		writeError(w, pgx.ErrNoRows)
		return
	}
	value, err := scanRecentWork(h.pool.QueryRow(r.Context(), `
		INSERT INTO "RecentWork"(id,"userId","presentationId","isPinned","accessedAt")
		VALUES($1,$2,$3,false,now())
		ON CONFLICT("userId","presentationId") DO UPDATE SET "accessedAt"=now()
		RETURNING id,"userId","presentationId","isPinned","accessedAt",
			(SELECT id FROM "Presentation" WHERE id=$3),(SELECT title FROM "Presentation" WHERE id=$3),
			(SELECT description FROM "Presentation" WHERE id=$3),(SELECT status::text FROM "Presentation" WHERE id=$3),
			(SELECT "updatedAt" FROM "Presentation" WHERE id=$3)`,
		newID(), userID(r), presentationID))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, value)
}

func (h *handlers) deleteRecentWork(w http.ResponseWriter, r *http.Request) {
	tag, err := h.pool.Exec(r.Context(), `DELETE FROM "RecentWork" WHERE "userId"=$1 AND "presentationId"=$2`, userID(r), chi.URLParam(r, "presentationId"))
	if err != nil {
		writeError(w, err)
		return
	}
	if tag.RowsAffected() != 1 {
		writeError(w, pgx.ErrNoRows)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *handlers) clearRecentWorks(w http.ResponseWriter, r *http.Request) {
	if _, err := h.pool.Exec(r.Context(), `DELETE FROM "RecentWork" WHERE "userId"=$1`, userID(r)); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

const recentWorkSelect = `
	SELECT rw.id,rw."userId",rw."presentationId",rw."isPinned",rw."accessedAt",
	       p.id,p.title,p.description,p.status::text,p."updatedAt"
	FROM "RecentWork" rw JOIN "Presentation" p ON p.id=rw."presentationId"`

func scanRecentWork(row interface{ Scan(...any) error }) (recentWork, error) {
	var value recentWork
	var id, title, status string
	var description *string
	var updatedAt any
	err := row.Scan(&value.ID, &value.UserID, &value.PresentationID, &value.IsPinned, &value.AccessedAt,
		&id, &title, &description, &status, &updatedAt)
	value.Presentation = map[string]any{
		"id": id, "title": title, "description": description, "status": status, "updatedAt": updatedAt,
	}
	return value, err
}

type colorPalette struct {
	ID             string          `json:"id"`
	Name           string          `json:"name"`
	Colors         json.RawMessage `json:"colors"`
	IsPublic       bool            `json:"isPublic"`
	OrganizationID *string         `json:"organizationId"`
	CreatedAt      any             `json:"createdAt"`
	UpdatedAt      any             `json:"updatedAt"`
}

func (h *handlers) listColorPalettes(w http.ResponseWriter, r *http.Request) {
	if !h.organizationAccess(w, r) {
		return
	}
	rows, err := h.pool.Query(r.Context(), colorPaletteSelect+` WHERE "organizationId"=$1 ORDER BY name`, chi.URLParam(r, "organizationId"))
	if err != nil {
		writeError(w, err)
		return
	}
	defer rows.Close()
	result := []colorPalette{}
	for rows.Next() {
		value, err := scanColorPalette(rows)
		if err != nil {
			writeError(w, err)
			return
		}
		result = append(result, value)
	}
	if err := rows.Err(); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *handlers) getColorPalette(w http.ResponseWriter, r *http.Request) {
	if !h.organizationAccess(w, r) {
		return
	}
	value, err := scanColorPalette(h.pool.QueryRow(r.Context(), colorPaletteSelect+` WHERE id=$1 AND "organizationId"=$2`,
		chi.URLParam(r, "id"), chi.URLParam(r, "organizationId")))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func (h *handlers) createColorPalette(w http.ResponseWriter, r *http.Request) {
	if !h.organizationAccess(w, r) {
		return
	}
	var input struct {
		Name      string   `json:"name"`
		Colors    []string `json:"colors"`
		IsDefault bool     `json:"isDefault"`
	}
	if !decode(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Name) == "" || input.Colors == nil || !validColors(input.Colors) {
		writeBadRequest(w, "name and valid colors are required")
		return
	}
	raw, _ := json.Marshal(input.Colors)
	value, err := scanColorPalette(h.pool.QueryRow(r.Context(), `
		INSERT INTO "ColorPalette"(id,name,colors,"isPublic","organizationId","createdAt","updatedAt")
		VALUES($1,$2,$3::jsonb,$4,$5,now(),now())
		RETURNING id,name,colors,"isPublic","organizationId","createdAt","updatedAt"`,
		newID(), input.Name, raw, input.IsDefault, chi.URLParam(r, "organizationId")))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, value)
}

func (h *handlers) updateColorPalette(w http.ResponseWriter, r *http.Request) {
	if !h.organizationAccess(w, r) {
		return
	}
	var input struct {
		Name      *string  `json:"name"`
		Colors    []string `json:"colors"`
		IsDefault *bool    `json:"isDefault"`
	}
	if !decode(w, r, &input) {
		return
	}
	if (input.Name != nil && strings.TrimSpace(*input.Name) == "") ||
		(input.Colors != nil && !validColors(input.Colors)) {
		writeBadRequest(w, "name or colors are invalid")
		return
	}
	var colors any
	if input.Colors != nil {
		raw, _ := json.Marshal(input.Colors)
		colors = string(raw)
	}
	value, err := scanColorPalette(h.pool.QueryRow(r.Context(), `
		UPDATE "ColorPalette" SET name=COALESCE($3,name),colors=COALESCE($4::jsonb,colors),
			"isPublic"=COALESCE($5,"isPublic"),"updatedAt"=now()
		WHERE id=$1 AND "organizationId"=$2
		RETURNING id,name,colors,"isPublic","organizationId","createdAt","updatedAt"`,
		chi.URLParam(r, "id"), chi.URLParam(r, "organizationId"), input.Name, colors, input.IsDefault))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func (h *handlers) deleteColorPalette(w http.ResponseWriter, r *http.Request) {
	if !h.organizationAccess(w, r) {
		return
	}
	h.deleteOrganizationResource(w, r, "ColorPalette")
}

const colorPaletteSelect = `SELECT id,name,colors,"isPublic","organizationId","createdAt","updatedAt" FROM "ColorPalette"`

func scanColorPalette(row interface{ Scan(...any) error }) (colorPalette, error) {
	var value colorPalette
	err := row.Scan(&value.ID, &value.Name, &value.Colors, &value.IsPublic, &value.OrganizationID, &value.CreatedAt, &value.UpdatedAt)
	return value, err
}

type fontSet struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	TitleFont      string  `json:"titleFont"`
	BodyFont       string  `json:"bodyFont"`
	HeadingFont    *string `json:"headingFont"`
	IsPublic       bool    `json:"isPublic"`
	OrganizationID *string `json:"organizationId"`
	CreatedAt      any     `json:"createdAt"`
	UpdatedAt      any     `json:"updatedAt"`
}

func (h *handlers) listFontSets(w http.ResponseWriter, r *http.Request) {
	if !h.organizationAccess(w, r) {
		return
	}
	rows, err := h.pool.Query(r.Context(), fontSetSelect+` WHERE "organizationId"=$1 ORDER BY name`, chi.URLParam(r, "organizationId"))
	if err != nil {
		writeError(w, err)
		return
	}
	defer rows.Close()
	result := []fontSet{}
	for rows.Next() {
		value, err := scanFontSet(rows)
		if err != nil {
			writeError(w, err)
			return
		}
		result = append(result, value)
	}
	if err := rows.Err(); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *handlers) getFontSet(w http.ResponseWriter, r *http.Request) {
	if !h.organizationAccess(w, r) {
		return
	}
	value, err := scanFontSet(h.pool.QueryRow(r.Context(), fontSetSelect+` WHERE id=$1 AND "organizationId"=$2`,
		chi.URLParam(r, "id"), chi.URLParam(r, "organizationId")))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func (h *handlers) createFontSet(w http.ResponseWriter, r *http.Request) {
	if !h.organizationAccess(w, r) {
		return
	}
	var input struct {
		Name        string  `json:"name"`
		HeadingFont string  `json:"headingFont"`
		BodyFont    string  `json:"bodyFont"`
		AccentFont  *string `json:"accentFont"`
		IsDefault   bool    `json:"isDefault"`
	}
	if !decode(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Name) == "" || strings.TrimSpace(input.HeadingFont) == "" || strings.TrimSpace(input.BodyFont) == "" {
		writeBadRequest(w, "name, headingFont, and bodyFont are required")
		return
	}
	value, err := scanFontSet(h.pool.QueryRow(r.Context(), `
		INSERT INTO "FontSet"(id,name,"titleFont","bodyFont","headingFont","isPublic","organizationId","createdAt","updatedAt")
		VALUES($1,$2,$3,$4,$5,$6,$7,now(),now())
		RETURNING id,name,"titleFont","bodyFont","headingFont","isPublic","organizationId","createdAt","updatedAt"`,
		newID(), input.Name, input.HeadingFont, input.BodyFont, input.AccentFont, input.IsDefault, chi.URLParam(r, "organizationId")))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, value)
}

func (h *handlers) updateFontSet(w http.ResponseWriter, r *http.Request) {
	if !h.organizationAccess(w, r) {
		return
	}
	var input struct {
		Name        *string `json:"name"`
		HeadingFont *string `json:"headingFont"`
		BodyFont    *string `json:"bodyFont"`
		AccentFont  *string `json:"accentFont"`
		IsDefault   *bool   `json:"isDefault"`
	}
	if !decode(w, r, &input) {
		return
	}
	for _, value := range []*string{input.Name, input.HeadingFont, input.BodyFont} {
		if value != nil && strings.TrimSpace(*value) == "" {
			writeBadRequest(w, "font set fields must not be empty")
			return
		}
	}
	value, err := scanFontSet(h.pool.QueryRow(r.Context(), `
		UPDATE "FontSet" SET name=COALESCE($3,name),"titleFont"=COALESCE($4,"titleFont"),
			"bodyFont"=COALESCE($5,"bodyFont"),"headingFont"=COALESCE($6,"headingFont"),
			"isPublic"=COALESCE($7,"isPublic"),"updatedAt"=now()
		WHERE id=$1 AND "organizationId"=$2
		RETURNING id,name,"titleFont","bodyFont","headingFont","isPublic","organizationId","createdAt","updatedAt"`,
		chi.URLParam(r, "id"), chi.URLParam(r, "organizationId"), input.Name, input.HeadingFont,
		input.BodyFont, input.AccentFont, input.IsDefault))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func (h *handlers) deleteFontSet(w http.ResponseWriter, r *http.Request) {
	if !h.organizationAccess(w, r) {
		return
	}
	h.deleteOrganizationResource(w, r, "FontSet")
}

const fontSetSelect = `SELECT id,name,"titleFont","bodyFont","headingFont","isPublic","organizationId","createdAt","updatedAt" FROM "FontSet"`

func scanFontSet(row interface{ Scan(...any) error }) (fontSet, error) {
	var value fontSet
	err := row.Scan(&value.ID, &value.Name, &value.TitleFont, &value.BodyFont, &value.HeadingFont,
		&value.IsPublic, &value.OrganizationID, &value.CreatedAt, &value.UpdatedAt)
	return value, err
}

func (h *handlers) organizationAccess(w http.ResponseWriter, r *http.Request) bool {
	var allowed bool
	if err := h.pool.QueryRow(r.Context(), `
		SELECT EXISTS(SELECT 1 FROM "User" WHERE id=$1 AND "organizationId"=$2)`,
		userID(r), chi.URLParam(r, "organizationId")).Scan(&allowed); err != nil {
		writeError(w, err)
		return false
	}
	if !allowed {
		writeForbidden(w, "Access denied")
		return false
	}
	return true
}

func (h *handlers) deleteOrganizationResource(w http.ResponseWriter, r *http.Request, table string) {
	query := `DELETE FROM "` + table + `" WHERE id=$1 AND "organizationId"=$2`
	tag, err := h.pool.Exec(r.Context(), query, chi.URLParam(r, "id"), chi.URLParam(r, "organizationId"))
	if err != nil {
		writeError(w, err)
		return
	}
	if tag.RowsAffected() != 1 {
		writeError(w, pgx.ErrNoRows)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func userID(r *http.Request) string {
	principal, _ := auth.PrincipalFromContext(r.Context())
	return principal.ID
}

func decode(w http.ResponseWriter, r *http.Request, value any) bool {
	if err := httpjson.Decode(r, w, 2<<20, value); err != nil {
		writeBadRequest(w, "Invalid JSON body")
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

func writeForbidden(w http.ResponseWriter, message string) {
	writeJSON(w, http.StatusForbidden, map[string]any{"statusCode": 403, "message": message})
}

func writeBadRequest(w http.ResponseWriter, message string) {
	writeJSON(w, http.StatusBadRequest, map[string]any{"statusCode": 400, "message": message})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func newID() string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "go-" + strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return "go-" + hex.EncodeToString(value[:])
}

func optionalObject(raw json.RawMessage) bool {
	if len(raw) == 0 || string(raw) == "null" {
		return true
	}
	var object map[string]any
	return json.Unmarshal(raw, &object) == nil && object != nil
}

func nullableJSON(raw json.RawMessage) any {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	return string(raw)
}

func invalidOrder(order *int) bool {
	return order != nil && *order < 0
}

func uniqueViolation(err error) bool {
	var postgresError *pgconn.PgError
	return errors.As(err, &postgresError) && postgresError.Code == "23505"
}

func parseLimit(r *http.Request, fallback int) int {
	raw := r.URL.Query().Get("limit")
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 {
		return fallback
	}
	if value > 100 {
		return 100
	}
	return value
}

func validColors(colors []string) bool {
	for _, color := range colors {
		if len(color) != 7 || color[0] != '#' {
			return false
		}
		for _, char := range color[1:] {
			if !strings.ContainsRune("0123456789abcdefABCDEF", char) {
				return false
			}
		}
	}
	return true
}
