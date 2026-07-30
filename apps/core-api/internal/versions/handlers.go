package versions

import (
	"context"
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
		r.Get("/presentations/{presentationId}/versions", h.list)
		r.Post("/presentations/{presentationId}/versions", h.create)
		r.Get("/versions/{id}", h.get)
		r.Get("/versions/{id1}/compare/{id2}", h.compare)
		r.Post("/versions/{id}/restore", h.restore)
		r.Delete("/versions/{id}", h.delete)
	})
}

func (h *handlers) get(w http.ResponseWriter, r *http.Request) {
	principal, _ := auth.PrincipalFromContext(r.Context())
	row := h.pool.QueryRow(r.Context(), `
		SELECT v.id,v."presentationId",v."versionNumber",v.name,v.snapshot,v."createdBy",v."createdAt",p."userId",p."isPublic"
		FROM "Version" v JOIN "Presentation" p ON p.id=v."presentationId" WHERE v.id=$1`, chi.URLParam(r, "id"))
	var ownerID string
	var isPublic bool
	var versionID, presentationID, createdBy string
	var versionNumber int
	var name *string
	var saved json.RawMessage
	var createdAt any
	if err := row.Scan(&versionID, &presentationID, &versionNumber, &name, &saved, &createdBy, &createdAt, &ownerID, &isPublic); err != nil {
		writeError(w, err)
		return
	}
	if ownerID != principal.ID && !isPublic {
		writeForbidden(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": versionID, "presentationId": presentationID,
		"versionNumber": versionNumber, "name": name, "snapshot": saved, "createdBy": createdBy, "createdAt": createdAt})
}

func (h *handlers) compare(w http.ResponseWriter, r *http.Request) {
	principal, _ := auth.PrincipalFromContext(r.Context())
	first, ok := h.versionForCompare(w, r, chi.URLParam(r, "id1"), principal.ID)
	if !ok {
		return
	}
	second, ok := h.versionForCompare(w, r, chi.URLParam(r, "id2"), principal.ID)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"version1":       map[string]any{"id": first.id, "name": first.name, "createdAt": first.createdAt},
		"version2":       map[string]any{"id": second.id, "name": second.name, "createdAt": second.createdAt},
		"slideCountDiff": len(second.snapshot.Slides) - len(first.snapshot.Slides),
		"titleChanged":   first.snapshot.Title != second.snapshot.Title,
		"slidesAdded":    countSlideDelta(second.snapshot.Slides, first.snapshot.Slides),
		"slidesRemoved":  countSlideDelta(first.snapshot.Slides, second.snapshot.Slides),
	})
}

type comparableVersion struct {
	id        string
	name      *string
	createdAt any
	snapshot  snapshot
}

func (h *handlers) versionForCompare(w http.ResponseWriter, r *http.Request, id, userID string) (comparableVersion, bool) {
	var value comparableVersion
	var raw json.RawMessage
	var owner string
	var isPublic bool
	err := h.pool.QueryRow(r.Context(), `SELECT v.id,v.name,v."createdAt",v.snapshot,p."userId",p."isPublic" FROM "Version" v JOIN "Presentation" p ON p.id=v."presentationId" WHERE v.id=$1`, id).Scan(&value.id, &value.name, &value.createdAt, &raw, &owner, &isPublic)
	if err != nil {
		writeError(w, err)
		return value, false
	}
	if owner != userID && !isPublic {
		writeForbidden(w)
		return value, false
	}
	if err := json.Unmarshal(raw, &value.snapshot); err != nil {
		writeError(w, err)
		return value, false
	}
	return value, true
}

func countSlideDelta(current, previous []snapshotSlide) int {
	known := map[string]bool{}
	for _, slide := range previous {
		known[slide.ID] = true
	}
	count := 0
	for _, slide := range current {
		if !known[slide.ID] {
			count++
		}
	}
	return count
}

type snapshot struct {
	Title       string          `json:"title"`
	Description *string         `json:"description"`
	TemplateID  *string         `json:"templateId"`
	Slides      []snapshotSlide `json:"slides"`
}

type snapshotSlide struct {
	ID      string          `json:"id"`
	Order   int             `json:"order"`
	Type    string          `json:"type"`
	Title   *string         `json:"title"`
	Content json.RawMessage `json:"content"`
	Layout  string          `json:"layout"`
	Notes   *string         `json:"notes"`
	Blocks  []snapshotBlock `json:"blocks"`
}

type snapshotBlock struct {
	Type    string          `json:"type"`
	Order   int             `json:"order"`
	Content json.RawMessage `json:"content"`
	Style   json.RawMessage `json:"style"`
}

func (h *handlers) list(w http.ResponseWriter, r *http.Request) {
	principal, _ := auth.PrincipalFromContext(r.Context())
	presentationID := chi.URLParam(r, "presentationId")
	if !h.checkPresentationAccess(w, r, presentationID, principal.ID, true) {
		return
	}
	rows, err := h.pool.Query(r.Context(), `
		SELECT id,"versionNumber",name,"createdBy","createdAt"
		FROM "Version" WHERE "presentationId"=$1 ORDER BY "versionNumber" DESC`, presentationID)
	if err != nil {
		writeError(w, err)
		return
	}
	defer rows.Close()
	result := []map[string]any{}
	for rows.Next() {
		var id, createdBy string
		var versionNumber int
		var name *string
		var createdAt any
		if err := rows.Scan(&id, &versionNumber, &name, &createdBy, &createdAt); err != nil {
			writeError(w, err)
			return
		}
		result = append(result, map[string]any{
			"id": id, "versionNumber": versionNumber, "name": name,
			"createdBy": createdBy, "createdAt": createdAt,
		})
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
		Name *string `json:"name"`
	}
	if !decode(w, r, &input) {
		return
	}
	snapshot, err := h.snapshot(r.Context(), presentationID)
	if err != nil {
		writeError(w, err)
		return
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		writeError(w, err)
		return
	}
	var versionNumber int
	if err := h.pool.QueryRow(r.Context(), `SELECT COALESCE(max("versionNumber"),0)+1 FROM "Version" WHERE "presentationId"=$1`, presentationID).
		Scan(&versionNumber); err != nil {
		writeError(w, err)
		return
	}
	name := "Version " + strconv.Itoa(versionNumber)
	if input.Name != nil && *input.Name != "" {
		name = *input.Name
	}
	row := h.pool.QueryRow(r.Context(), `
		INSERT INTO "Version"(id,"presentationId","versionNumber",name,snapshot,"createdBy","createdAt")
		VALUES($1,$2,$3,$4,$5::jsonb,$6,now())
		RETURNING id,"presentationId","versionNumber",name,snapshot,"createdBy","createdAt"`,
		newID(), presentationID, versionNumber, name, raw, principal.ID)
	result, err := scanVersion(row)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (h *handlers) snapshot(ctx context.Context, presentationID string) (snapshot, error) {
	result := snapshot{Slides: []snapshotSlide{}}
	if err := h.pool.QueryRow(ctx, `SELECT title,description,"templateId" FROM "Presentation" WHERE id=$1`, presentationID).
		Scan(&result.Title, &result.Description, &result.TemplateID); err != nil {
		return result, err
	}
	rows, err := h.pool.Query(ctx, `
		SELECT id,"order",type::text,title,content,layout,notes
		FROM "Slide" WHERE "presentationId"=$1 ORDER BY "order"`, presentationID)
	if err != nil {
		return result, err
	}
	index := map[string]int{}
	for rows.Next() {
		var id string
		var slide snapshotSlide
		slide.Blocks = []snapshotBlock{}
		if err := rows.Scan(&id, &slide.Order, &slide.Type, &slide.Title, &slide.Content, &slide.Layout, &slide.Notes); err != nil {
			rows.Close()
			return result, err
		}
		slide.ID = id
		index[id] = len(result.Slides)
		result.Slides = append(result.Slides, slide)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return result, err
	}
	rows.Close()

	rows, err = h.pool.Query(ctx, `
		SELECT b."slideId",b.type::text,b."order",b.content,b.style
		FROM "Block" b JOIN "Slide" s ON s.id=b."slideId"
		WHERE s."presentationId"=$1 ORDER BY s."order",b."order"`, presentationID)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var slideID string
		var block snapshotBlock
		if err := rows.Scan(&slideID, &block.Type, &block.Order, &block.Content, &block.Style); err != nil {
			return result, err
		}
		if i, ok := index[slideID]; ok {
			result.Slides[i].Blocks = append(result.Slides[i].Blocks, block)
		}
	}
	return result, rows.Err()
}

func (h *handlers) restore(w http.ResponseWriter, r *http.Request) {
	principal, _ := auth.PrincipalFromContext(r.Context())
	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	defer tx.Rollback(r.Context())

	id := chi.URLParam(r, "id")
	var presentationID, ownerID string
	var raw []byte
	err = tx.QueryRow(r.Context(), `
		SELECT v."presentationId",p."userId",v.snapshot
		FROM "Version" v JOIN "Presentation" p ON p.id=v."presentationId"
		WHERE v.id=$1`, id).Scan(&presentationID, &ownerID, &raw)
	if err != nil {
		writeError(w, err)
		return
	}
	if ownerID != principal.ID {
		writeForbidden(w)
		return
	}
	var saved snapshot
	if err := json.Unmarshal(raw, &saved); err != nil {
		writeError(w, err)
		return
	}
	if _, err = tx.Exec(r.Context(), `DELETE FROM "Slide" WHERE "presentationId"=$1`, presentationID); err == nil {
		_, err = tx.Exec(r.Context(), `
			UPDATE "Presentation" SET title=$2,description=$3,"templateId"=$4,"updatedAt"=now() WHERE id=$1`,
			presentationID, saved.Title, saved.Description, saved.TemplateID)
	}
	for _, slide := range saved.Slides {
		if err != nil {
			break
		}
		slideID := newID()
		_, err = tx.Exec(r.Context(), `
			INSERT INTO "Slide"(id,"presentationId","order",type,title,content,layout,notes,"createdAt","updatedAt")
			VALUES($1,$2,$3,$4::"SlideType",$5,$6::jsonb,$7,$8,now(),now())`,
			slideID, presentationID, slide.Order, slide.Type, slide.Title, slide.Content, slide.Layout, slide.Notes)
		for _, block := range slide.Blocks {
			if err != nil {
				break
			}
			_, err = tx.Exec(r.Context(), `
				INSERT INTO "Block"(id,"slideId",type,"order",content,style,"createdAt","updatedAt")
				VALUES($1,$2,$3::"BlockType",$4,$5::jsonb,$6::jsonb,now(),now())`,
				newID(), slideID, block.Type, block.Order, block.Content, block.Style)
		}
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"success": true, "restoredVersionId": id})
}

func (h *handlers) delete(w http.ResponseWriter, r *http.Request) {
	principal, _ := auth.PrincipalFromContext(r.Context())
	id := chi.URLParam(r, "id")
	var ownerID string
	err := h.pool.QueryRow(r.Context(), `
		SELECT p."userId" FROM "Version" v JOIN "Presentation" p ON p.id=v."presentationId" WHERE v.id=$1`, id).
		Scan(&ownerID)
	if err != nil {
		writeError(w, err)
		return
	}
	if ownerID != principal.ID {
		writeForbidden(w)
		return
	}
	if _, err := h.pool.Exec(r.Context(), `DELETE FROM "Version" WHERE id=$1`, id); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *handlers) checkPresentationAccess(w http.ResponseWriter, r *http.Request, presentationID, userID string, allowPublic bool) bool {
	var ownerID string
	var public bool
	err := h.pool.QueryRow(r.Context(), `SELECT "userId","isPublic" FROM "Presentation" WHERE id=$1`, presentationID).
		Scan(&ownerID, &public)
	if err != nil {
		writeError(w, err)
		return false
	}
	if ownerID != userID && !(allowPublic && public) {
		writeForbidden(w)
		return false
	}
	return true
}

func scanVersion(row pgx.Row) (map[string]any, error) {
	var id, presentationID, createdBy string
	var versionNumber int
	var name *string
	var saved json.RawMessage
	var createdAt any
	err := row.Scan(&id, &presentationID, &versionNumber, &name, &saved, &createdBy, &createdAt)
	return map[string]any{
		"id": id, "presentationId": presentationID, "versionNumber": versionNumber,
		"name": name, "snapshot": saved, "createdBy": createdBy, "createdAt": createdAt,
	}, err
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
