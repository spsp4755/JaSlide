package templates

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/auth"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/contentsecurity"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/generation"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/httpjson"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/renderer"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/storagepath"
)

const maxTemplateBytes = 20 << 20

type Service struct {
	db       *db.Store
	renderer *renderer.Client
	root     string
	roles    generation.RoleClassifier
}

func NewService(store *db.Store, renderer *renderer.Client, root string, roles generation.RoleClassifier) *Service {
	return &Service{db: store, renderer: renderer, root: filepath.Clean(root), roles: roles}
}

func NewHandlers(service *Service) http.Handler {
	router := chi.NewRouter()
	router.Get("/", service.listPublic)
	router.Get("/{id}", service.getPublic)
	return router
}

func NewAdminHandlers(service *Service, authService *auth.Service) http.Handler {
	router := chi.NewRouter()
	router.Use(auth.RequireUser(authService))
	router.Use(auth.RequireRole("ADMIN"))
	router.Get("/", service.listAdmin)
	router.Post("/", service.createAdmin)
	router.Post("/import-pptx", service.importPPTX)
	router.Post("/import-html-zip", service.importHTMLZIP)
	router.Get("/palettes/list", service.listPalettes)
	router.Post("/palettes", service.createPalette)
	router.Delete("/palettes/{id}", service.deletePalette)
	router.Get("/layouts/list", service.listLayouts)
	router.Post("/layouts", service.createLayout)
	router.Delete("/layouts/{id}", service.deleteLayout)
	router.Get("/{id}", service.getAdmin)
	router.Patch("/{id}", service.updateAdmin)
	router.Delete("/{id}", service.deleteAdmin)
	router.Post("/{id}/reextract-pptx", service.reextractPPTX)
	router.Get("/{id}/fidelity", service.fidelity)
	return router
}

func (service *Service) listPublic(writer http.ResponseWriter, request *http.Request) {
	query := `
		SELECT COALESCE(jsonb_agg(item ORDER BY item->>'name'),'[]'::jsonb)
		FROM (
			SELECT jsonb_build_object(
				'id',"id",'name',"name",'description',"description",'thumbnail',"thumbnail",
				'category',"category",'isPublic',"isPublic"
			) item
			FROM "Template" WHERE "isPublic" AND ($1='' OR "category"::text=$1)
		) selected`
	writeRawQuery(writer, service.db.Pool().QueryRow(request.Context(), query, request.URL.Query().Get("category")), http.StatusOK)
}

func (service *Service) getPublic(writer http.ResponseWriter, request *http.Request) {
	var raw, config json.RawMessage
	err := service.db.Pool().QueryRow(request.Context(),
		`SELECT to_jsonb(t),"config" FROM "Template" t WHERE "id"=$1 AND "isPublic"`, chi.URLParam(request, "id"),
	).Scan(&raw, &config)
	if err == nil {
		raw, err = templateWithSanitizedConfig(raw, config)
	}
	writeRaw(writer, raw, http.StatusOK, err)
}

func (service *Service) listAdmin(writer http.ResponseWriter, request *http.Request) {
	page, limit := pagination(request)
	category, isPublic := request.URL.Query().Get("category"), request.URL.Query().Get("isPublic")
	var publicFilter *bool
	if isPublic != "" {
		value, err := strconv.ParseBool(isPublic)
		if err != nil {
			writeError(writer, http.StatusBadRequest, "isPublic must be a boolean")
			return
		}
		publicFilter = &value
	}
	var raw json.RawMessage
	var total int
	err := service.db.Pool().QueryRow(request.Context(), `
		WITH selected AS (
			SELECT t.*,o."name" organization_name,
				(SELECT COUNT(*) FROM "Presentation" p WHERE p."templateId"=t."id") presentation_count
			FROM "Template" t LEFT JOIN "Organization" o ON o."id"=t."organizationId"
			WHERE ($1='' OR t."category"::text=$1)
				AND ($2::boolean IS NULL OR t."isPublic"=$2)
			ORDER BY t."createdAt" DESC OFFSET $3 LIMIT $4
		)
		SELECT COALESCE(jsonb_agg(
			to_jsonb(selected)-'organization_name'-'presentation_count' ||
			jsonb_build_object(
				'organization',CASE WHEN selected."organizationId" IS NULL THEN NULL ELSE jsonb_build_object('id',selected."organizationId",'name',selected.organization_name) END,
				'_count',jsonb_build_object('presentations',selected.presentation_count)
			)
		),'[]'::jsonb),
		(SELECT COUNT(*) FROM "Template" t WHERE ($1='' OR t."category"::text=$1)
			AND ($2::boolean IS NULL OR t."isPublic"=$2))
		FROM selected`, category, publicFilter, (page-1)*limit, limit).Scan(&raw, &total)
	if err == nil {
		raw, err = sanitizeTemplatePage(raw)
	}
	writePage(writer, raw, total, page, limit, err)
}

func (service *Service) getAdmin(writer http.ResponseWriter, request *http.Request) {
	writeRawQuery(writer, service.db.Pool().QueryRow(request.Context(), `
		SELECT to_jsonb(t) || jsonb_build_object(
			'organization',CASE WHEN o."id" IS NULL THEN NULL ELSE jsonb_build_object('id',o."id",'name',o."name") END,
			'_count',jsonb_build_object('presentations',(SELECT COUNT(*) FROM "Presentation" p WHERE p."templateId"=t."id"))
		)
		FROM "Template" t LEFT JOIN "Organization" o ON o."id"=t."organizationId"
		WHERE t."id"=$1`, chi.URLParam(request, "id")), http.StatusOK)
}

func (service *Service) createAdmin(writer http.ResponseWriter, request *http.Request) {
	var input templateInput
	if err := decodeJSON(writer, request, &input); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(input.Name) == "" || !categories[defaultString(input.Category, "BUSINESS")] || !jsonObject(input.Config) {
		writeError(writer, http.StatusBadRequest, "name, category and config are required")
		return
	}
	raw, err := service.createTemplate(request.Context(), input)
	writeRaw(writer, raw, http.StatusCreated, err)
}

func (service *Service) updateAdmin(writer http.ResponseWriter, request *http.Request) {
	var input map[string]json.RawMessage
	if err := decodeJSON(writer, request, &input); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	allowed := map[string]bool{
		"name": true, "description": true, "category": true, "config": true, "isPublic": true,
	}
	sets, args := []string{`"updatedAt"=NOW()`}, []any{chi.URLParam(request, "id")}
	for name, value := range input {
		if !allowed[name] {
			writeError(writer, http.StatusBadRequest, "Unsupported template field")
			return
		}
		var decoded any
		if err := json.Unmarshal(value, &decoded); err != nil {
			writeError(writer, http.StatusBadRequest, "Invalid template field")
			return
		}
		if name == "config" {
			clean, err := contentsecurity.SanitizeTemplateConfig(value)
			if err != nil {
				writeError(writer, http.StatusBadRequest, err.Error())
				return
			}
			args = append(args, string(clean))
		} else {
			args = append(args, decoded)
		}
		cast := ""
		if name == "category" {
			cast = `::"TemplateCategory"`
		}
		if name == "config" {
			cast = "::jsonb"
		}
		if name == "isPublic" {
			cast = "::boolean"
		}
		sets = append(sets, fmt.Sprintf(`"%s"=$%d%s`, name, len(args), cast))
	}
	query := fmt.Sprintf(`UPDATE "Template" SET %s WHERE "id"=$1 RETURNING to_jsonb("Template")`, strings.Join(sets, ","))
	writeRawQuery(writer, service.db.Pool().QueryRow(request.Context(), query, args...), http.StatusOK)
}

func (service *Service) deleteAdmin(writer http.ResponseWriter, request *http.Request) {
	id := chi.URLParam(request, "id")
	var config json.RawMessage
	var count int
	if err := service.db.Pool().QueryRow(request.Context(), `
		SELECT "config",(SELECT COUNT(*) FROM "Presentation" WHERE "templateId"=$1)
		FROM "Template" WHERE "id"=$1`, id).Scan(&config, &count); err != nil {
		writeDatabaseError(writer, err)
		return
	}
	if count > 0 {
		writeError(writer, http.StatusNotFound, "Cannot delete template in use")
		return
	}
	if _, err := service.db.Pool().Exec(request.Context(), `DELETE FROM "Template" WHERE "id"=$1`, id); err != nil {
		writeDatabaseError(writer, err)
		return
	}
	if key := templateStorageKey(config); key != "" {
		if target, err := storagepath.Removable(service.root, key); err == nil {
			_ = os.Remove(target)
		}
	}
	writeJSON(writer, http.StatusOK, map[string]bool{"success": true})
}

func (service *Service) importPPTX(writer http.ResponseWriter, request *http.Request) {
	file, header, fields, err := templateUpload(writer, request, ".pptx")
	if err != nil {
		writeError(writer, http.StatusBadRequest, "PPTX file up to 20MB required")
		return
	}
	var extracted struct {
		Config json.RawMessage `json:"config"`
	}
	if err := service.renderer.PostFile(
		request.Context(), "/api/extract/style", header.Filename,
		renderer.PPTXContentType, file, &extracted,
	); err != nil {
		writeRendererError(writer, err)
		return
	}
	if !validPPTXConfig(extracted.Config) {
		writeError(writer, http.StatusBadRequest, "Invalid renderer template config")
		return
	}
	key, err := service.storeTemplateFile(header.Filename, file)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "Could not store template")
		return
	}
	config := rawObject(extracted.Config)
	source, _ := config["source"].(map[string]any)
	if source == nil {
		source = map[string]any{"kind": "pptx"}
	}
	source["storageKey"] = key
	if classified, classifyErr := generation.ApplyRoleClassification(request.Context(), service.roles, source); classifyErr == nil {
		source = classified
	}
	config["source"] = source
	config["pptxTemplate"] = map[string]any{"storageKey": key, "originalname": header.Filename}
	configRaw, _ := json.Marshal(config)
	input := templateInput{
		Name: fields["name"], Description: pointer(fields["description"]),
		Category: defaultString(fields["category"], "CUSTOM"), Config: configRaw,
		IsPublic: strings.EqualFold(fields["isPublic"], "true"), OrganizationID: pointer(fields["organizationId"]),
	}
	raw, err := service.createTemplate(request.Context(), input)
	if err != nil {
		service.removeTemplateFile(key)
	}
	writeRaw(writer, raw, http.StatusCreated, err)
}

func (service *Service) importHTMLZIP(writer http.ResponseWriter, request *http.Request) {
	file, header, fields, err := templateUpload(writer, request, ".zip")
	if err != nil {
		writeError(writer, http.StatusBadRequest, "ZIP file up to 20MB required")
		return
	}
	var extracted struct {
		Config json.RawMessage `json:"config"`
	}
	if err := service.renderer.PostFile(
		request.Context(), "/api/extract/html-template", header.Filename,
		"application/zip", file, &extracted,
	); err != nil {
		writeRendererError(writer, err)
		return
	}
	if !validHTMLZIPConfig(extracted.Config) {
		writeError(writer, http.StatusBadRequest, "Invalid HTML template ZIP config")
		return
	}
	key, err := service.storeTemplateFile(header.Filename, file)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "Could not store template")
		return
	}
	extractedFields := rawObject(extracted.Config)
	config := map[string]any{
		"htmlTemplate": extractedFields["htmlTemplate"], "htmlSlides": extractedFields["htmlSlides"],
		"source": map[string]any{"kind": "html_zip", "storageKey": key},
	}
	archive, _ := extractedFields["archive"].(map[string]any)
	archive["storageKey"] = key
	config["zipTemplate"] = archive
	configRaw, _ := json.Marshal(config)
	input := templateInput{
		Name: fields["name"], Description: pointer(fields["description"]),
		Category: defaultString(fields["category"], "CUSTOM"), Config: configRaw,
		IsPublic: strings.EqualFold(fields["isPublic"], "true"), OrganizationID: pointer(fields["organizationId"]),
	}
	raw, err := service.createTemplate(request.Context(), input)
	if err != nil {
		service.removeTemplateFile(key)
	}
	writeRaw(writer, raw, http.StatusCreated, err)
}

func (service *Service) reextractPPTX(writer http.ResponseWriter, request *http.Request) {
	id := chi.URLParam(request, "id")
	config, err := service.templateConfig(request.Context(), id)
	if err != nil {
		writeDatabaseError(writer, err)
		return
	}
	key := templateStorageKey(config)
	source := rawObject(config)["source"]
	sourceFields, _ := source.(map[string]any)
	if key == "" || sourceFields["kind"] != "pptx" {
		writeError(writer, http.StatusBadRequest, "PPTX source file is unavailable")
		return
	}
	content, err := service.readTemplateFile(key)
	if err != nil {
		writeError(writer, http.StatusBadRequest, "PPTX source file is unavailable")
		return
	}
	var extracted struct {
		Config json.RawMessage `json:"config"`
	}
	if err := service.renderer.PostFile(
		request.Context(), "/api/extract/style", "template.pptx",
		renderer.PPTXContentType, content, &extracted,
	); err != nil || !validPPTXConfig(extracted.Config) {
		if err != nil {
			writeRendererError(writer, err)
		} else {
			writeError(writer, http.StatusBadRequest, "PPTX extraction produced an invalid template")
		}
		return
	}
	oldFields, newFields := rawObject(config), rawObject(extracted.Config)
	newSource, _ := newFields["source"].(map[string]any)
	newSource["storageKey"] = key
	newFields["source"], newFields["pptxTemplate"] = newSource, oldFields["pptxTemplate"]
	raw, _ := json.Marshal(newFields)
	raw, err = contentsecurity.SanitizeTemplateConfig(raw)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	writeRawQuery(writer, service.db.Pool().QueryRow(request.Context(),
		`UPDATE "Template" SET "config"=$2,"updatedAt"=NOW() WHERE "id"=$1 RETURNING to_jsonb("Template")`,
		id, raw), http.StatusCreated)
}

func (service *Service) fidelity(writer http.ResponseWriter, request *http.Request) {
	config, err := service.templateConfig(request.Context(), chi.URLParam(request, "id"))
	if err != nil {
		writeDatabaseError(writer, err)
		return
	}
	key := templateStorageKey(config)
	if key == "" {
		writeError(writer, http.StatusBadRequest, "PPTX source file is unavailable")
		return
	}
	content, err := service.readTemplateFile(key)
	if err != nil {
		writeError(writer, http.StatusBadRequest, "PPTX source file is unavailable")
		return
	}
	var result any
	if err := service.renderer.PostFile(
		request.Context(), "/api/extract/fidelity", "template.pptx",
		renderer.PPTXContentType, content, &result,
	); err != nil {
		writeRendererError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (service *Service) listPalettes(writer http.ResponseWriter, request *http.Request) {
	service.listSimple(writer, request, "ColorPalette")
}
func (service *Service) listLayouts(writer http.ResponseWriter, request *http.Request) {
	service.listSimple(writer, request, "LayoutRule")
}

func (service *Service) listSimple(writer http.ResponseWriter, request *http.Request, table string) {
	page, limit := pagination(request)
	var raw json.RawMessage
	var total int
	query := fmt.Sprintf(`
		SELECT COALESCE(jsonb_agg(to_jsonb(selected) ORDER BY selected."createdAt" DESC),'[]'::jsonb),
			(SELECT COUNT(*) FROM "%s")
		FROM (SELECT * FROM "%s" ORDER BY "createdAt" DESC OFFSET $1 LIMIT $2) selected`, table, table)
	err := service.db.Pool().QueryRow(request.Context(), query, (page-1)*limit, limit).Scan(&raw, &total)
	writePage(writer, raw, total, page, limit, err)
}

func (service *Service) createPalette(writer http.ResponseWriter, request *http.Request) {
	service.createSimple(writer, request, "ColorPalette", []string{"name", "colors", "isPublic", "organizationId"})
}
func (service *Service) createLayout(writer http.ResponseWriter, request *http.Request) {
	service.createSimple(writer, request, "LayoutRule", []string{"name", "slideType", "config", "isDefault"})
}

func (service *Service) createSimple(writer http.ResponseWriter, request *http.Request, table string, columns []string) {
	var input map[string]json.RawMessage
	if err := decodeJSON(writer, request, &input); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	id, err := newID()
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "Could not create record")
		return
	}
	names, placeholders, args := []string{`"id"`}, []string{"$1"}, []any{id}
	for _, column := range columns {
		if value, ok := input[column]; ok {
			names = append(names, `"`+column+`"`)
			args = append(args, value)
			placeholder := fmt.Sprintf("$%d", len(args))
			switch column {
			case "colors", "config":
				placeholder += "::jsonb"
			case "isPublic", "isDefault":
				placeholder = "(" + placeholder + "::jsonb)::boolean"
			default:
				placeholder = "(" + placeholder + "::jsonb #>> '{}')"
			}
			placeholders = append(placeholders, placeholder)
		}
	}
	names, placeholders = append(names, `"updatedAt"`), append(placeholders, "NOW()")
	query := fmt.Sprintf(`INSERT INTO "%s" (%s) VALUES (%s) RETURNING to_jsonb("%s")`,
		table, strings.Join(names, ","), strings.Join(placeholders, ","), table)
	writeRawQuery(writer, service.db.Pool().QueryRow(request.Context(), query, args...), http.StatusCreated)
}

func (service *Service) deletePalette(writer http.ResponseWriter, request *http.Request) {
	service.deleteSimple(writer, request, "ColorPalette")
}
func (service *Service) deleteLayout(writer http.ResponseWriter, request *http.Request) {
	service.deleteSimple(writer, request, "LayoutRule")
}

func (service *Service) deleteSimple(writer http.ResponseWriter, request *http.Request, table string) {
	result, err := service.db.Pool().Exec(request.Context(),
		fmt.Sprintf(`DELETE FROM "%s" WHERE "id"=$1`, table), chi.URLParam(request, "id"))
	if err != nil {
		writeDatabaseError(writer, err)
		return
	}
	if result.RowsAffected() == 0 {
		writeError(writer, http.StatusNotFound, "Not found")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]bool{"success": true})
}

type templateInput struct {
	Name           string          `json:"name"`
	Description    *string         `json:"description,omitempty"`
	Category       string          `json:"category"`
	Config         json.RawMessage `json:"config"`
	IsPublic       bool            `json:"isPublic,omitempty"`
	OrganizationID *string         `json:"organizationId,omitempty"`
}

func (service *Service) createTemplate(ctx context.Context, input templateInput) (json.RawMessage, error) {
	id, err := newID()
	if err != nil {
		return nil, err
	}
	if input.Name = strings.TrimSpace(input.Name); input.Name == "" {
		return nil, errors.New("template name is required")
	}
	category := defaultString(input.Category, "BUSINESS")
	if !categories[category] {
		return nil, errors.New("invalid template category")
	}
	input.Config, err = contentsecurity.SanitizeTemplateConfig(input.Config)
	if err != nil {
		return nil, err
	}
	var raw json.RawMessage
	err = service.db.Pool().QueryRow(ctx, `
		INSERT INTO "Template"
			("id","name","description","category","config","isPublic","organizationId","updatedAt")
		VALUES ($1,$2,$3,$4::"TemplateCategory",$5,$6,$7,NOW())
		RETURNING to_jsonb("Template")`,
		id, input.Name, input.Description, category, input.Config, input.IsPublic, input.OrganizationID,
	).Scan(&raw)
	return raw, err
}

func (service *Service) templateConfig(ctx context.Context, id string) (json.RawMessage, error) {
	var raw json.RawMessage
	err := service.db.Pool().QueryRow(ctx, `SELECT "config" FROM "Template" WHERE "id"=$1`, id).Scan(&raw)
	return raw, err
}

func (service *Service) storeTemplateFile(filename string, content []byte) (string, error) {
	id, err := newID()
	if err != nil {
		return "", err
	}
	key := filepath.ToSlash(filepath.Join("templates", id+"-"+filepath.Base(filename)))
	target, err := storagepath.Writable(service.root, key)
	if err != nil {
		return "", err
	}
	temporary, err := os.CreateTemp(filepath.Dir(target), ".template-*")
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

func (service *Service) readTemplateFile(key string) ([]byte, error) {
	target, err := storagepath.Existing(service.root, key)
	if err != nil {
		return nil, err
	}
	return os.ReadFile(target)
}

func (service *Service) removeTemplateFile(key string) {
	if target, err := storagepath.Removable(service.root, key); err == nil {
		_ = os.Remove(target)
	}
}

func templateUpload(
	writer http.ResponseWriter, request *http.Request, extension string,
) ([]byte, *multipart.FileHeader, map[string]string, error) {
	request.Body = http.MaxBytesReader(writer, request.Body, maxTemplateBytes+(1<<20))
	if err := request.ParseMultipartForm(maxTemplateBytes); err != nil {
		return nil, nil, nil, err
	}
	file, header, err := request.FormFile("file")
	if err != nil {
		return nil, nil, nil, err
	}
	defer file.Close()
	if strings.ToLower(filepath.Ext(header.Filename)) != extension {
		return nil, nil, nil, errors.New("invalid extension")
	}
	content, err := io.ReadAll(io.LimitReader(file, maxTemplateBytes+1))
	if err != nil || len(content) == 0 || len(content) > maxTemplateBytes {
		return nil, nil, nil, errors.New("invalid file size")
	}
	fields := map[string]string{}
	for _, name := range []string{"name", "description", "category", "isPublic", "organizationId"} {
		fields[name] = request.FormValue(name)
	}
	return content, header, fields, nil
}

func validPPTXConfig(raw json.RawMessage) bool {
	fields := rawObject(raw)
	return stringRecord(fields["colors"]) && stringRecord(fields["typography"]) &&
		len(stringSlice(fields["htmlSlides"])) > 0 && object(fields["archive"])
}

func validHTMLZIPConfig(raw json.RawMessage) bool {
	fields := rawObject(raw)
	template, _ := fields["htmlTemplate"].(string)
	return strings.TrimSpace(template) != "" && len(stringSlice(fields["htmlSlides"])) > 0 && object(fields["archive"])
}

func templateStorageKey(raw json.RawMessage) string {
	fields := rawObject(raw)
	for _, name := range []string{"source", "pptxTemplate", "zipTemplate"} {
		if section, ok := fields[name].(map[string]any); ok {
			if key, ok := section["storageKey"].(string); ok && key != "" {
				return key
			}
		}
	}
	return ""
}

func templateWithSanitizedConfig(raw, config json.RawMessage) (json.RawMessage, error) {
	clean, err := contentsecurity.SanitizeTemplateConfig(config)
	if err != nil {
		return nil, err
	}
	var object map[string]any
	var cleanConfig any
	if json.Unmarshal(raw, &object) != nil || json.Unmarshal(clean, &cleanConfig) != nil {
		return nil, errors.New("invalid template record")
	}
	object["config"] = cleanConfig
	return json.Marshal(object)
}

func sanitizeTemplatePage(raw json.RawMessage) (json.RawMessage, error) {
	var templates []map[string]any
	if err := json.Unmarshal(raw, &templates); err != nil {
		return nil, err
	}
	for _, template := range templates {
		config, ok := template["config"]
		if !ok {
			continue
		}
		configRaw, err := json.Marshal(config)
		if err != nil {
			return nil, err
		}
		clean, err := contentsecurity.SanitizeTemplateConfig(configRaw)
		if err != nil {
			return nil, err
		}
		var cleanConfig any
		if err := json.Unmarshal(clean, &cleanConfig); err != nil {
			return nil, err
		}
		template["config"] = cleanConfig
	}
	return json.Marshal(templates)
}

func rawObject(raw json.RawMessage) map[string]any {
	result := map[string]any{}
	_ = json.Unmarshal(raw, &result)
	return result
}

func stringRecord(raw any) bool {
	value, ok := raw.(map[string]any)
	if !ok {
		return false
	}
	for _, item := range value {
		if _, ok := item.(string); !ok {
			return false
		}
	}
	return true
}

func stringSlice(raw any) []string {
	values, _ := raw.([]any)
	result := make([]string, 0, len(values))
	for _, item := range values {
		if value, ok := item.(string); ok {
			result = append(result, value)
		}
	}
	return result
}

func object(raw any) bool {
	_, ok := raw.(map[string]any)
	return ok
}

func jsonObject(raw json.RawMessage) bool {
	var value map[string]any
	return json.Unmarshal(raw, &value) == nil && value != nil
}

func pagination(request *http.Request) (int, int) {
	page, _ := strconv.Atoi(request.URL.Query().Get("page"))
	limit, _ := strconv.Atoi(request.URL.Query().Get("limit"))
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	return page, limit
}

func decodeJSON(writer http.ResponseWriter, request *http.Request, value any) error {
	return httpjson.Decode(request, writer, 20<<20, value)
}

func writeRawQuery(writer http.ResponseWriter, row pgx.Row, status int) {
	var raw json.RawMessage
	err := row.Scan(&raw)
	writeRaw(writer, raw, status, err)
}

func writeRaw(writer http.ResponseWriter, raw json.RawMessage, status int, err error) {
	if err != nil {
		writeDatabaseError(writer, err)
		return
	}
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_, _ = writer.Write(raw)
}

func writePage(writer http.ResponseWriter, raw json.RawMessage, total, page, limit int, err error) {
	if err != nil {
		writeDatabaseError(writer, err)
		return
	}
	var data any
	_ = json.Unmarshal(raw, &data)
	writeJSON(writer, http.StatusOK, map[string]any{
		"data": data, "total": total, "page": page, "limit": limit,
		"totalPages": int(math.Ceil(float64(total) / float64(limit))),
	})
}

func writeRendererError(writer http.ResponseWriter, err error) {
	status := http.StatusServiceUnavailable
	if strings.Contains(err.Error(), "status 4") {
		status = http.StatusBadRequest
	}
	writeError(writer, status, renderer.PublicError(err))
}

func writeDatabaseError(writer http.ResponseWriter, err error) {
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(writer, http.StatusNotFound, "Template not found")
		return
	}
	writeError(writer, http.StatusInternalServerError, "Internal server error")
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

func pointer(value string) *string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return &value
}

func defaultString(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func newID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return "go-" + hex.EncodeToString(value[:]), nil
}

var categories = map[string]bool{
	"BUSINESS": true, "EDUCATION": true, "CREATIVE": true, "MARKETING": true,
	"SALES": true, "TECHNOLOGY": true, "MEDICAL": true, "FINANCE": true, "CUSTOM": true,
}
