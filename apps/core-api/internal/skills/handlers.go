package skills

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/auth"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/httpjson"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/renderer"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/storagepath"
)

const maxPPTXBytes = 20 << 20

type handlers struct {
	db       *db.Store
	renderer *renderer.Client
	root     string
}

func NewHandlers(store *db.Store, renderer *renderer.Client, root string, authService *auth.Service) http.Handler {
	handler := &handlers{db: store, renderer: renderer, root: filepath.Clean(root)}
	router := chi.NewRouter()
	router.Use(auth.RequireUser(authService))
	router.Get("/", handler.list)
	router.Post("/", handler.create)
	router.Delete("/", handler.deleteMany)
	router.Patch("/{id}", handler.update)
	router.Post("/import-pptx", handler.importPPTX)
	return router
}

func (handler *handlers) list(writer http.ResponseWriter, request *http.Request) {
	user, _ := auth.PrincipalFromContext(request.Context())
	var raw json.RawMessage
	err := handler.db.Pool().QueryRow(request.Context(), `
		SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s."name"),'[]'::jsonb)
		FROM "PresentationSkill" s
		WHERE (s."isPublic" OR s."userId"=$1 OR ($2::text IS NOT NULL AND s."organizationId"=$2))
			AND ($3='' OR s."category"=$3)`,
		user.ID, user.OrganizationID, request.URL.Query().Get("category")).Scan(&raw)
	writeRaw(writer, raw, http.StatusOK, err)
}

func (handler *handlers) create(writer http.ResponseWriter, request *http.Request) {
	var raw map[string]json.RawMessage
	if err := decode(writer, request, &raw); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	if _, exists := raw["packageUrl"]; exists {
		writeError(writer, http.StatusBadRequest, "Unsupported Skill field")
		return
	}
	if _, exists := raw["package"]; exists {
		writeError(writer, http.StatusBadRequest, "Unsupported Skill field")
		return
	}
	allowed := map[string]bool{
		"name": true, "description": true, "category": true, "audience": true,
		"tone": true, "purpose": true, "outlineGuidance": true,
		"recommendedSlideCount": true, "thumbnail": true, "templateId": true, "isPublic": true,
	}
	for field := range raw {
		if !allowed[field] {
			writeError(writer, http.StatusBadRequest, "Unsupported Skill field")
			return
		}
	}
	var input skillInput
	encoded, _ := json.Marshal(raw)
	if json.Unmarshal(encoded, &input) != nil || !input.valid() {
		writeError(writer, http.StatusBadRequest, "Invalid Skill")
		return
	}
	user, _ := auth.PrincipalFromContext(request.Context())
	result, err := createSkill(request.Context(), handler.db, user, input)
	writeRaw(writer, result, http.StatusCreated, err)
}

func (handler *handlers) deleteMany(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		IDs []string `json:"ids"`
	}
	if err := decode(writer, request, &input); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	ids := unique(input.IDs)
	if len(ids) == 0 {
		writeError(writer, http.StatusBadRequest, "Select at least one Skill")
		return
	}
	user, _ := auth.PrincipalFromContext(request.Context())
	result, err := handler.db.Pool().Exec(request.Context(),
		`DELETE FROM "PresentationSkill" WHERE "id"=ANY($1) AND "userId"=$2`, ids, user.ID)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "Internal server error")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]int64{"deleted": result.RowsAffected()})
}

func (handler *handlers) update(writer http.ResponseWriter, request *http.Request) {
	user, _ := auth.PrincipalFromContext(request.Context())
	id := chi.URLParam(request, "id")
	var input skillUpdateInput
	if err := decode(writer, request, &input); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	if input.Name != nil && strings.TrimSpace(*input.Name) == "" {
		writeError(writer, http.StatusBadRequest, "Name is required")
		return
	}
	var isPublic *bool
	var organizationID *string
	scopeChanged := false
	if input.Scope != nil {
		value, orgID, err := scopeColumns(*input.Scope, user.OrganizationID)
		if err != nil {
			writeError(writer, http.StatusBadRequest, err.Error())
			return
		}
		isPublic, organizationID, scopeChanged = &value, orgID, true
	}

	ctx := request.Context()
	tx, err := handler.db.Pool().Begin(ctx)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "Internal server error")
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var templateID *string
	if err := tx.QueryRow(ctx,
		`SELECT "templateId" FROM "PresentationSkill" WHERE "id"=$1 AND "userId"=$2`,
		id, user.ID,
	).Scan(&templateID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(writer, http.StatusNotFound, "Skill not found")
			return
		}
		writeError(writer, http.StatusInternalServerError, "Internal server error")
		return
	}

	var raw json.RawMessage
	if err := tx.QueryRow(ctx, `
		UPDATE "PresentationSkill" SET
			"name"=COALESCE($3,"name"),
			"isPublic"=COALESCE($4,"isPublic"),
			"organizationId"=CASE WHEN $5 THEN $6 ELSE "organizationId" END,
			"updatedAt"=NOW()
		WHERE "id"=$1 AND "userId"=$2
		RETURNING to_jsonb("PresentationSkill")`,
		id, user.ID, input.Name, isPublic, scopeChanged, organizationID,
	).Scan(&raw); err != nil {
		writeError(writer, http.StatusInternalServerError, "Internal server error")
		return
	}

	if templateID != nil {
		if _, err := tx.Exec(ctx, `
			UPDATE "Template" SET
				"name"=COALESCE($3,"name"),
				"isPublic"=COALESCE($4,"isPublic"),
				"organizationId"=CASE WHEN $5 THEN $6 ELSE "organizationId" END,
				"updatedAt"=NOW()
			WHERE "id"=$1 AND "userId"=$2`,
			*templateID, user.ID, input.Name, isPublic, scopeChanged, organizationID,
		); err != nil {
			writeError(writer, http.StatusInternalServerError, "Internal server error")
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(writer, http.StatusInternalServerError, "Internal server error")
		return
	}
	writeRaw(writer, raw, http.StatusOK, nil)
}

func (handler *handlers) importPPTX(writer http.ResponseWriter, request *http.Request) {
	request.Body = http.MaxBytesReader(writer, request.Body, maxPPTXBytes+(1<<20))
	if err := request.ParseMultipartForm(maxPPTXBytes); err != nil {
		writeError(writer, http.StatusBadRequest, "PPTX file up to 20MB required")
		return
	}
	file, header, err := request.FormFile("file")
	if err != nil || strings.ToLower(filepath.Ext(header.Filename)) != ".pptx" {
		writeError(writer, http.StatusBadRequest, "PPTX file up to 20MB required")
		return
	}
	defer file.Close()
	content, err := io.ReadAll(io.LimitReader(file, maxPPTXBytes+1))
	if err != nil || len(content) == 0 || len(content) > maxPPTXBytes {
		writeError(writer, http.StatusBadRequest, "PPTX file up to 20MB required")
		return
	}
	var extracted struct {
		Config json.RawMessage `json:"config"`
	}
	if err := handler.renderer.PostFile(
		request.Context(), "/api/extract/style", header.Filename,
		renderer.PPTXContentType, content, &extracted,
	); err != nil {
		writeRendererError(writer, err)
		return
	}
	config := configObject(extracted.Config)
	if !validTemplateConfig(config) {
		writeError(writer, http.StatusBadRequest, "Invalid PPTX style tokens")
		return
	}
	key, err := handler.storeFile(header.Filename, content)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "Could not store template")
		return
	}
	source, _ := config["source"].(map[string]any)
	if source == nil {
		source = map[string]any{"kind": "pptx"}
	}
	source["storageKey"], config["source"] = key, source
	config["pptxTemplate"] = map[string]any{"storageKey": key, "originalname": header.Filename}
	configRaw, _ := json.Marshal(config)
	user, _ := auth.PrincipalFromContext(request.Context())
	name := strings.TrimSpace(request.FormValue("name"))
	if name == "" {
		name = strings.TrimSuffix(filepath.Base(header.Filename), filepath.Ext(header.Filename))
	}
	result, err := handler.createImported(request.Context(), user, name, header.Filename, key, configRaw)
	if err != nil {
		log.Printf("importPPTX: createImported failed: %v", err)
		handler.removeFile(key)
	}
	writeRaw(writer, result, http.StatusCreated, err)
}

func (handler *handlers) createImported(
	ctx context.Context, user auth.Principal, name, originalName, key string, config json.RawMessage,
) (json.RawMessage, error) {
	templateID, err := newID()
	if err != nil {
		return nil, err
	}
	skillID, err := newID()
	if err != nil {
		return nil, err
	}
	tx, err := handler.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `
		INSERT INTO "Template"
			("id","name","category","config","isPublic","userId","organizationId","updatedAt")
		VALUES ($1,$2,'BUSINESS',$3,FALSE,$4,$5,NOW())`,
		templateID, name, config, user.ID, user.OrganizationID,
	); err != nil {
		return nil, err
	}
	outlineGuidance := "Preserve the original information hierarchy and visual rhythm."
	if example := bulletHierarchyExample(configObject(config)); example != "" {
		outlineGuidance += " " + example
	}
	var raw json.RawMessage
	if err := tx.QueryRow(ctx, `
		INSERT INTO "PresentationSkill"
			("id","name","description","category","audience","tone","purpose","outlineGuidance",
			 "recommendedSlideCount","userId","organizationId","templateId","updatedAt")
		VALUES ($1,$2,$3,'CUSTOM',$4,$5,$6,$7,10,$8,$9,$10,NOW())
		RETURNING to_jsonb("PresentationSkill")`,
		skillID, name, "Uses visual styles extracted from "+originalName,
		"General audience", "Clear and concise", "PPTX-styled presentation",
		outlineGuidance, user.ID,
		user.OrganizationID, templateID,
	).Scan(&raw); err != nil {
		return nil, err
	}
	return raw, tx.Commit(ctx)
}

type skillInput struct {
	Name                  string  `json:"name"`
	Description           *string `json:"description,omitempty"`
	Category              string  `json:"category"`
	Audience              string  `json:"audience"`
	Tone                  string  `json:"tone"`
	Purpose               string  `json:"purpose"`
	OutlineGuidance       string  `json:"outlineGuidance"`
	RecommendedSlideCount int     `json:"recommendedSlideCount"`
	Thumbnail             *string `json:"thumbnail,omitempty"`
	TemplateID            *string `json:"templateId,omitempty"`
	IsPublic              bool    `json:"isPublic,omitempty"`
}

func (input skillInput) valid() bool {
	return strings.TrimSpace(input.Name) != "" && strings.TrimSpace(input.Category) != "" &&
		strings.TrimSpace(input.Audience) != "" && strings.TrimSpace(input.Tone) != "" &&
		strings.TrimSpace(input.Purpose) != "" && strings.TrimSpace(input.OutlineGuidance) != "" &&
		input.RecommendedSlideCount >= 3 && input.RecommendedSlideCount <= 30
}

type skillUpdateInput struct {
	Name  *string `json:"name,omitempty"`
	Scope *string `json:"scope,omitempty"`
}

func scopeColumns(scope string, userOrgID *string) (isPublic bool, organizationID *string, err error) {
	switch scope {
	case "private":
		return false, nil, nil
	case "organization":
		if userOrgID == nil {
			return false, nil, errors.New("No organization to share with")
		}
		return false, userOrgID, nil
	case "public":
		return true, nil, nil
	default:
		return false, nil, errors.New("Invalid scope")
	}
}

func createSkill(ctx context.Context, store *db.Store, user auth.Principal, input skillInput) (json.RawMessage, error) {
	id, err := newID()
	if err != nil {
		return nil, err
	}
	var raw json.RawMessage
	err = store.Pool().QueryRow(ctx, `
		INSERT INTO "PresentationSkill"
			("id","name","description","category","audience","tone","purpose","outlineGuidance",
			 "recommendedSlideCount","thumbnail","isPublic","userId","organizationId","templateId","updatedAt")
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
		RETURNING to_jsonb("PresentationSkill")`,
		id, input.Name, input.Description, input.Category, input.Audience, input.Tone,
		input.Purpose, input.OutlineGuidance, input.RecommendedSlideCount, input.Thumbnail,
		input.IsPublic, user.ID, user.OrganizationID, input.TemplateID,
	).Scan(&raw)
	return raw, err
}

func (handler *handlers) storeFile(filename string, content []byte) (string, error) {
	id, err := newID()
	if err != nil {
		return "", err
	}
	key := filepath.ToSlash(filepath.Join("templates", id+"-"+filepath.Base(filename)))
	target, err := storagepath.Writable(handler.root, key)
	if err != nil {
		return "", err
	}
	temporary, err := os.CreateTemp(filepath.Dir(target), ".skill-*")
	if err != nil {
		return "", err
	}
	name := temporary.Name()
	defer os.Remove(name)
	if _, err := temporary.Write(content); err != nil {
		_ = temporary.Close()
		return "", err
	}
	if err := temporary.Close(); err != nil {
		return "", err
	}
	return key, os.Rename(name, target)
}

func (handler *handlers) removeFile(key string) {
	if target, err := storagepath.Removable(handler.root, key); err == nil {
		_ = os.Remove(target)
	}
}

func configObject(raw json.RawMessage) map[string]any {
	result := map[string]any{}
	_ = json.Unmarshal(raw, &result)
	return result
}

func validTemplateConfig(config map[string]any) bool {
	return stringRecord(config["colors"]) && stringRecord(config["typography"]) &&
		stringArray(config["htmlSlides"]) && object(config["archive"])
}

func stringRecord(value any) bool {
	items, ok := value.(map[string]any)
	if !ok {
		return false
	}
	for _, value := range items {
		if _, ok := value.(string); !ok {
			return false
		}
	}
	return true
}

func stringArray(value any) bool {
	items, ok := value.([]any)
	if !ok || len(items) == 0 {
		return false
	}
	for _, value := range items {
		if _, ok := value.(string); !ok {
			return false
		}
	}
	return true
}

func object(value any) bool {
	_, ok := value.(map[string]any)
	return ok
}

func unique(values []string) []string {
	seen := map[string]bool{}
	var result []string
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" && !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	return result
}

func decode(writer http.ResponseWriter, request *http.Request, target any) error {
	return httpjson.Decode(request, writer, 2<<20, target)
}

func writeRaw(writer http.ResponseWriter, raw json.RawMessage, status int, err error) {
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "Internal server error")
		return
	}
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_, _ = writer.Write(raw)
}

func writeRendererError(writer http.ResponseWriter, err error) {
	status := http.StatusServiceUnavailable
	if strings.Contains(err.Error(), "status 4") {
		status = http.StatusBadRequest
	}
	writeError(writer, status, renderer.PublicError(err))
}

func writeError(writer http.ResponseWriter, status int, message string) {
	writeJSON(writer, status, map[string]any{
		"message": message, "error": http.StatusText(status), "statusCode": status,
	})
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func newID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return "go-" + hex.EncodeToString(value[:]), nil
}
