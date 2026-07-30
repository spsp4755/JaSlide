package admin

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/auth"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/outboundpolicy"
	"golang.org/x/crypto/bcrypt"
)

type Queue interface {
	Add(context.Context, string) error
}
type LiveCanceller interface{ CancelLive(string) }

type Handlers struct {
	pool        *pgxpool.Pool
	redis       *redis.Client
	auth        *auth.Service
	queue       Queue
	rendererURL string
	client      *http.Client
	templates   http.Handler
	startedAt   time.Time
	policy      *outboundpolicy.Policy
	canceller   LiveCanceller
}

func NewHandlers(store *db.Store, authService *auth.Service, queue Queue, rendererURL string, client *http.Client, templateHandlers http.Handler, options ...any) http.Handler {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	h := &Handlers{
		auth: authService, queue: queue,
		rendererURL: strings.TrimRight(rendererURL, "/"), client: client, templates: templateHandlers,
		startedAt: time.Now(),
	}
	for _, option := range options {
		switch value := option.(type) {
		case *outboundpolicy.Policy:
			h.policy = value
		case LiveCanceller:
			h.canceller = value
		}
	}
	if store != nil {
		h.pool, h.redis = store.Pool(), store.Redis()
	}
	router := chi.NewRouter()
	router.Use(auth.RequireUser(authService))
	router.Use(requireAdmin)
	router.Route("/dashboard", func(r chi.Router) {
		r.Get("/stats", h.dashboardStats)
		r.Get("/activity", h.dashboardActivity)
		r.Get("/health", h.health)
	})
	router.Route("/alerts", func(r chi.Router) {
		r.Get("/", h.listAlerts)
		r.Post("/", h.createAlert)
		r.Patch("/{id}", h.updateAlert)
		r.Delete("/{id}", h.deleteByID(`DELETE FROM "AlertConfig" WHERE id=$1`))
	})
	router.Route("/assets", func(r chi.Router) {
		r.Get("/", h.listAssets)
		r.Patch("/{id}", h.updateAsset)
		r.Delete("/{id}", h.deleteAsset)
	})
	router.Route("/documents", func(r chi.Router) {
		r.Get("/", h.listDocuments)
		r.Get("/{id}", h.getDocument)
		r.Delete("/{id}", h.deleteByID(`DELETE FROM "Presentation" WHERE id=$1`))
	})
	router.Route("/jobs", func(r chi.Router) {
		r.Get("/", h.listJobs)
		r.Get("/stats", h.jobStats)
		r.Get("/{id}", h.getJob)
		r.Post("/{id}/retry", h.retryJob)
		r.Post("/{id}/cancel", h.cancelJob)
	})
	router.Route("/logs", func(r chi.Router) {
		r.Get("/audit", h.auditLogs)
		r.Get("/api", h.apiLogs)
		r.Get("/export/{kind}", h.exportLogs)
	})
	router.Route("/models", func(r chi.Router) {
		r.Get("/", h.listModels)
		r.Get("/{id}", h.getModel)
		r.Post("/", h.createModel)
		r.Patch("/{id}", h.updateModel)
		r.Delete("/{id}", h.deleteByID(`DELETE FROM "LlmModel" WHERE id=$1`))
		r.Post("/{id}/set-default", h.setDefaultModel)
	})
	router.Route("/operations", func(r chi.Router) {
		r.Get("/health", h.health)
		r.Get("/queue", h.queueStatus)
		r.Post("/cache/clear", h.clearCache)
		r.Post("/model-test", h.modelTest)
		r.Post("/jobs/force-stop", h.forceStopJobs)
	})
	router.Route("/organizations", func(r chi.Router) {
		r.Get("/", h.listOrganizations)
		r.Get("/{id}", h.getOrganization)
		r.Post("/", h.createOrganization)
		r.Patch("/{id}", h.updateOrganization)
		r.Delete("/{id}", h.deleteByID(`DELETE FROM "Organization" WHERE id=$1`))
	})
	router.Route("/policies", func(r chi.Router) {
		r.Get("/", h.listPolicies)
		r.Post("/", h.createPolicy)
		r.Patch("/{id}", h.updatePolicy)
		r.Delete("/{id}", h.deleteByID(`DELETE FROM "SystemPolicy" WHERE id=$1`))
	})
	router.Route("/prompts", func(r chi.Router) {
		r.Get("/", h.listPrompts)
		r.Get("/{id}", h.getPrompt)
		r.Post("/", h.createPrompt)
		r.Post("/{id}/versions", h.createPromptVersion)
		r.Post("/{id}/rollback/{version}", h.rollbackPrompt)
		r.Post("/{id}/test", h.testPrompt)
		r.Delete("/{id}", h.deleteByID(`DELETE FROM "PromptRegistry" WHERE id=$1`))
	})
	router.Route("/roles", func(r chi.Router) {
		r.Get("/", h.listRoles)
		r.Get("/{id}", h.getRole)
		r.Post("/", h.createRole)
		r.Patch("/{id}", h.updateRole)
		r.Delete("/{id}", h.deleteRole)
		r.Post("/{roleId}/users/{userId}", h.assignRole)
		r.Delete("/{roleId}/users/{userId}", h.removeRole)
	})
	router.Route("/users", func(r chi.Router) {
		r.Get("/", h.listUsers)
		r.Post("/", h.createUser)
		r.Get("/{id}", h.getUser)
		r.Patch("/{id}", h.updateUser)
		r.Delete("/{id}", h.deactivateUser)
	})
	if templateHandlers != nil {
		router.Mount("/templates", templateHandlers)
	}
	return router
}

func requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		principal, ok := auth.PrincipalFromContext(r.Context())
		if !ok || !isAdminRole(principal.Role) {
			writeJSON(w, http.StatusForbidden, map[string]any{
				"message": "Insufficient permissions - Admin access required",
				"error":   "Forbidden", "statusCode": http.StatusForbidden,
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isAdminRole(role string) bool {
	return role == "ADMIN" || role == "SYSTEM_ADMIN"
}

func (h *Handlers) dashboardStats(w http.ResponseWriter, r *http.Request) {
	var totalUsers, activeUsers, totalPresentations, totalGenerations, failedGenerations int64
	err := h.pool.QueryRow(r.Context(), `
		SELECT
			(SELECT count(*) FROM "User"),
			(SELECT count(*) FROM "User" WHERE "lastLoginAt">=now()-interval '24 hours' OR "updatedAt">=now()-interval '24 hours'),
			(SELECT count(*) FROM "Presentation"),
			(SELECT count(*) FROM "GenerationJob"),
			(SELECT count(*) FROM "GenerationJob" WHERE status='FAILED')`).
		Scan(&totalUsers, &activeUsers, &totalPresentations, &totalGenerations, &failedGenerations)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, dashboardStatsContract(
		totalUsers, activeUsers, totalPresentations, totalGenerations, failedGenerations,
	))
}

func (h *Handlers) dashboardActivity(w http.ResponseWriter, r *http.Request) {
	rows, err := queryMaps(r.Context(), h.pool, `
		SELECT id,type,message,"createdAt" FROM (
			SELECT a.id,'audit' type,
			       concat(COALESCE(u.email,'System'),' ',a.action,' ',a.resource) message,
			       a."createdAt"
			FROM "AuditLog" a LEFT JOIN "User" u ON u.id=a."userId"
			UNION ALL
			SELECT j.id,'job' type,
			       concat('Generation job ',lower(j.status::text),' for ',u.email) message,
			       j."createdAt"
			FROM "GenerationJob" j LEFT JOIN "User" u ON u.id=j."userId"
		) activity ORDER BY "createdAt" DESC LIMIT 10`)
	writeResult(w, rows, err)
}

func (h *Handlers) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	check := func(action func() error) map[string]any {
		started := time.Now()
		status := "up"
		if action() != nil {
			status = "down"
		}
		return map[string]any{"status": status, "latency": time.Since(started).Milliseconds()}
	}
	database := check(func() error { return h.pool.Ping(ctx) })
	redisStatus := check(func() error { return h.redis.Ping(ctx).Err() })
	renderer := check(func() error {
		if h.rendererURL == "" {
			return errors.New("renderer is not configured")
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, h.rendererURL+"/health", nil)
		if err != nil {
			return err
		}
		res, err := h.client.Do(req)
		if err != nil {
			return err
		}
		defer res.Body.Close()
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			return fmt.Errorf("renderer returned %d", res.StatusCode)
		}
		return nil
	})
	services := map[string]any{
		"api":      map[string]any{"status": "up", "latency": int64(0)},
		"database": database, "redis": redisStatus, "renderer": renderer,
	}
	status := "healthy"
	for _, service := range []map[string]any{database, redisStatus, renderer} {
		if service["status"] != "up" {
			status = "degraded"
		}
	}
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	writeJSON(w, http.StatusOK, map[string]any{
		"status": status, "services": services, "memory": memoryContract(mem),
		"uptime": time.Since(h.startedAt).Seconds(),
	})
}

func (h *Handlers) listAlerts(w http.ResponseWriter, r *http.Request) {
	pagedQuery(w, r, h.pool, `SELECT * FROM "AlertConfig" ORDER BY "createdAt" DESC`, `SELECT count(*) FROM "AlertConfig"`, nil)
}

func (h *Handlers) createAlert(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name, EventType, Channel string
		Config                   json.RawMessage
		IsActive                 *bool
	}
	if !decode(w, r, &in) || in.Name == "" || in.EventType == "" || in.Channel == "" {
		badRequest(w, "name, eventType and channel are required")
		return
	}
	id := newID()
	active := true
	if in.IsActive != nil {
		active = *in.IsActive
	}
	if len(in.Config) == 0 {
		in.Config = json.RawMessage(`{}`)
	}
	row, err := queryOneMap(r.Context(), h.pool, `
		INSERT INTO "AlertConfig"(id,name,"eventType",channel,config,"isActive","createdAt","updatedAt")
		VALUES($1,$2,$3,$4,$5::jsonb,$6,now(),now()) RETURNING *`,
		id, in.Name, in.EventType, in.Channel, in.Config, active)
	writeCreated(w, row, err)
}

func (h *Handlers) updateAlert(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name     *string         `json:"name"`
		Config   json.RawMessage `json:"config"`
		IsActive *bool           `json:"isActive"`
	}
	if !decode(w, r, &in) {
		return
	}
	row, err := queryOneMap(r.Context(), h.pool, `
		UPDATE "AlertConfig" SET
		  name=COALESCE($2,name), config=COALESCE($3::jsonb,config),
		  "isActive"=COALESCE($4,"isActive"), "updatedAt"=now()
		WHERE id=$1 RETURNING *`,
		chi.URLParam(r, "id"), in.Name, nullableJSON(in.Config), in.IsActive)
	writeResult(w, row, err)
}

func (h *Handlers) listAssets(w http.ResponseWriter, r *http.Request) {
	where, args := filters(r, []filterSpec{{"type", "a.type::text"}, {"userId", `a."userId"`}})
	sql := `SELECT a.*,json_build_object('id',u.id,'email',u.email,'name',u.name) user
		FROM "Asset" a JOIN "User" u ON u.id=a."userId"` + where + ` ORDER BY a."createdAt" DESC`
	count := `SELECT count(*) FROM "Asset" a` + where
	pagedQuery(w, r, h.pool, sql, count, args)
}

func (h *Handlers) updateAsset(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name     *string `json:"name"`
		IsPublic *bool   `json:"isPublic"`
	}
	if !decode(w, r, &in) {
		return
	}
	row, err := queryOneMap(r.Context(), h.pool, `UPDATE "Asset" SET name=COALESCE($2,name),"isPublic"=COALESCE($3,"isPublic"),"updatedAt"=now() WHERE id=$1 RETURNING *`,
		chi.URLParam(r, "id"), in.Name, in.IsPublic)
	writeResult(w, row, err)
}

func (h *Handlers) deleteAsset(w http.ResponseWriter, r *http.Request) {
	var path *string
	err := h.pool.QueryRow(r.Context(), `DELETE FROM "Asset" WHERE id=$1 RETURNING path`, chi.URLParam(r, "id")).Scan(&path)
	if err == nil && path != nil {
		_ = os.Remove(*path)
	}
	writeDeleted(w, err)
}

func (h *Handlers) listDocuments(w http.ResponseWriter, r *http.Request) {
	where, args := filters(r, []filterSpec{{"userId", `p."userId"`}, {"status", "p.status::text"}})
	if q := strings.TrimSpace(r.URL.Query().Get("search")); q != "" {
		where, args = appendCondition(where, args, `p.title ILIKE $%d`, "%"+q+"%")
	}
	sql := `SELECT p.*,json_build_object('id',u.id,'email',u.email,'name',u.name) user,
		(SELECT count(*) FROM "Slide" s WHERE s."presentationId"=p.id) "_slideCount"
		FROM "Presentation" p JOIN "User" u ON u.id=p."userId"` + where + ` ORDER BY p."createdAt" DESC`
	pagedQueryTransform(w, r, h.pool, sql, `SELECT count(*) FROM "Presentation" p`+where, args,
		func(row map[string]any) { addCountContract(row, map[string]string{"slides": "_slideCount"}) })
}

func (h *Handlers) getDocument(w http.ResponseWriter, r *http.Request) {
	row, err := queryOneMap(r.Context(), h.pool, `SELECT p.*,json_build_object('id',u.id,'email',u.email,'name',u.name) user FROM "Presentation" p JOIN "User" u ON u.id=p."userId" WHERE p.id=$1`, chi.URLParam(r, "id"))
	writeResult(w, row, err)
}

func (h *Handlers) listJobs(w http.ResponseWriter, r *http.Request) {
	where, args := filters(r, []filterSpec{{"userId", `j."userId"`}, {"status", "j.status::text"}})
	sql := `SELECT j.*,json_build_object('id',u.id,'email',u.email,'name',u.name) user,
		CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object('id',p.id,'title',p.title) END presentation
		FROM "GenerationJob" j JOIN "User" u ON u.id=j."userId" LEFT JOIN "Presentation" p ON p.id=j."presentationId"` +
		where + ` ORDER BY j."createdAt" DESC`
	pagedQuery(w, r, h.pool, sql, `SELECT count(*) FROM "GenerationJob" j`+where, args)
}

func (h *Handlers) getJob(w http.ResponseWriter, r *http.Request) {
	row, err := queryOneMap(r.Context(), h.pool, `SELECT * FROM "GenerationJob" WHERE id=$1`, chi.URLParam(r, "id"))
	writeResult(w, row, err)
}

func (h *Handlers) jobStats(w http.ResponseWriter, r *http.Request) {
	rows, err := queryMaps(r.Context(), h.pool, `SELECT status::text,count(*)::bigint count FROM "GenerationJob" GROUP BY status ORDER BY status`)
	if err != nil {
		writeError(w, err)
		return
	}
	var recent24h int64
	if err := h.pool.QueryRow(r.Context(), `SELECT count(*) FROM "GenerationJob" WHERE "createdAt">=now()-interval '24 hours'`).Scan(&recent24h); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, jobStatsContract(rows, recent24h))
}

func (h *Handlers) retryJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	tag, err := h.pool.Exec(r.Context(), `UPDATE "GenerationJob" SET status='QUEUED',progress=0,error=NULL,"startedAt"=NULL,"completedAt"=NULL,"updatedAt"=now() WHERE id=$1 AND status IN ('FAILED','CANCELLED')`, id)
	if err != nil {
		writeError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		badRequest(w, "Only failed or cancelled jobs can be retried")
		return
	}
	if h.queue != nil {
		if err := h.queue.Add(r.Context(), id); err != nil {
			writeError(w, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "id": id, "status": "QUEUED"})
}

func (h *Handlers) cancelJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	tag, err := h.pool.Exec(r.Context(), `UPDATE "GenerationJob" SET status='CANCELLED',"completedAt"=now(),"updatedAt"=now() WHERE id=$1 AND status NOT IN ('COMPLETED','FAILED','CANCELLED')`, id)
	if err != nil {
		writeError(w, err)
		return
	}
	if tag.RowsAffected() > 0 {
		_, _ = h.pool.Exec(r.Context(), `UPDATE "Presentation" SET status='FAILED',"updatedAt"=now() WHERE id=(SELECT "presentationId" FROM "GenerationJob" WHERE id=$1)`, id)
		if h.canceller != nil {
			h.canceller.CancelLive(id)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": tag.RowsAffected() > 0})
}

func (h *Handlers) auditLogs(w http.ResponseWriter, r *http.Request) {
	where, args := filters(r, []filterSpec{{"userId", `a."userId"`}, {"action", "a.action"}, {"resource", "a.resource"}})
	sql := `SELECT a.*,CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object('id',u.id,'email',u.email,'name',u.name) END user
		FROM "AuditLog" a LEFT JOIN "User" u ON u.id=a."userId"` + where + ` ORDER BY a."createdAt" DESC`
	pagedQuery(w, r, h.pool, sql, `SELECT count(*) FROM "AuditLog" a`+where, args)
}

func (h *Handlers) apiLogs(w http.ResponseWriter, r *http.Request) {
	where, args := filters(r, []filterSpec{{"userId", `"userId"`}, {"path", "path"}, {"statusCode", `"statusCode"`}})
	pagedQuery(w, r, h.pool, `SELECT * FROM "ApiLog"`+where+` ORDER BY "createdAt" DESC`, `SELECT count(*) FROM "ApiLog"`+where, args)
}

func (h *Handlers) exportLogs(w http.ResponseWriter, r *http.Request) {
	kind := chi.URLParam(r, "kind")
	table := `"AuditLog"`
	if kind == "api" {
		table = `"ApiLog"`
	} else if kind != "audit" {
		http.NotFound(w, r)
		return
	}
	rows, err := queryMaps(r.Context(), h.pool, `SELECT * FROM `+table+` ORDER BY "createdAt" DESC LIMIT 10000`)
	if err != nil {
		writeError(w, err)
		return
	}
	if r.URL.Query().Get("format") != "csv" {
		w.Header().Set("Content-Disposition", `attachment; filename="`+kind+`-logs.json"`)
		writeJSON(w, http.StatusOK, rows)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+kind+`-logs.csv"`)
	cw := csv.NewWriter(w)
	if len(rows) == 0 {
		cw.Flush()
		return
	}
	keys := make([]string, 0, len(rows[0]))
	for key := range rows[0] {
		keys = append(keys, key)
	}
	_ = cw.Write(keys)
	for _, row := range rows {
		values := make([]string, len(keys))
		for i, key := range keys {
			values[i] = fmt.Sprint(row[key])
		}
		_ = cw.Write(values)
	}
	cw.Flush()
}

func (h *Handlers) listModels(w http.ResponseWriter, r *http.Request) {
	where, args := filters(r, []filterSpec{{"provider", "provider"}})
	pagedQueryTransform(w, r, h.pool, `SELECT * FROM "LlmModel"`+where+` ORDER BY "createdAt" DESC`, `SELECT count(*) FROM "LlmModel"`+where, args, redactModel)
}

func (h *Handlers) getModel(w http.ResponseWriter, r *http.Request) {
	row, err := queryOneMap(r.Context(), h.pool, `SELECT * FROM "LlmModel" WHERE id=$1`, chi.URLParam(r, "id"))
	if row != nil {
		redactModel(row)
	}
	writeResult(w, row, err)
}

type modelInput struct {
	Name, Provider, ModelID        string
	Endpoint, APIKey, APIKeyEnvVar *string
	MaxTokens                      *int
	RateLimit                      *int
	CostPerToken                   *float64
	IsActive, IsDefault            *bool
	Config                         json.RawMessage
}

func (h *Handlers) createModel(w http.ResponseWriter, r *http.Request) {
	var in modelInput
	if !decode(w, r, &in) || in.Name == "" || in.Provider == "" || in.ModelID == "" || in.CostPerToken == nil {
		badRequest(w, "name, provider, modelId and costPerToken are required")
		return
	}
	maxTokens, active, defaultModel := 4096, true, false
	if in.MaxTokens != nil {
		maxTokens = *in.MaxTokens
	}
	if in.IsActive != nil {
		active = *in.IsActive
	}
	if in.IsDefault != nil {
		defaultModel = *in.IsDefault
	}
	if len(in.Config) == 0 {
		in.Config = json.RawMessage(`{}`)
	}
	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	if defaultModel {
		_, err = tx.Exec(r.Context(), `UPDATE "LlmModel" SET "isDefault"=false WHERE "isDefault"=true`)
	}
	var row map[string]any
	if err == nil {
		row, err = queryOneMap(r.Context(), tx, `
			INSERT INTO "LlmModel"(id,name,provider,"modelId",endpoint,"apiKey","apiKeyEnvVar","maxTokens","rateLimit","costPerToken","isActive","isDefault",config,"createdAt","updatedAt")
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,now(),now()) RETURNING *`,
			newID(), in.Name, in.Provider, in.ModelID, in.Endpoint, in.APIKey, in.APIKeyEnvVar, maxTokens, in.RateLimit, *in.CostPerToken, active, defaultModel, in.Config)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if row != nil {
		redactModel(row)
	}
	writeCreated(w, row, err)
}

func (h *Handlers) updateModel(w http.ResponseWriter, r *http.Request) {
	var raw map[string]json.RawMessage
	if !decode(w, r, &raw) {
		return
	}
	allowed := map[string]string{
		"name": "name", "provider": "provider", "modelId": `"modelId"`, "endpoint": "endpoint",
		"apiKey": `"apiKey"`, "apiKeyEnvVar": `"apiKeyEnvVar"`, "maxTokens": `"maxTokens"`,
		"rateLimit": `"rateLimit"`, "costPerToken": `"costPerToken"`, "isActive": `"isActive"`,
		"isDefault": `"isDefault"`, "config": "config",
	}
	row, err := h.dynamicUpdate(r.Context(), "LlmModel", chi.URLParam(r, "id"), raw, allowed)
	if row != nil {
		redactModel(row)
	}
	writeResult(w, row, err)
}

func (h *Handlers) setDefaultModel(w http.ResponseWriter, r *http.Request) {
	tx, err := h.pool.Begin(r.Context())
	if err == nil {
		_, err = tx.Exec(r.Context(), `UPDATE "LlmModel" SET "isDefault"=false WHERE "isDefault"=true`)
	}
	if err == nil {
		tag, execErr := tx.Exec(r.Context(), `UPDATE "LlmModel" SET "isDefault"=true,"updatedAt"=now() WHERE id=$1`, chi.URLParam(r, "id"))
		err = execErr
		if err == nil && tag.RowsAffected() == 0 {
			err = pgx.ErrNoRows
		}
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

func (h *Handlers) queueStatus(w http.ResponseWriter, r *http.Request) {
	queued, _ := h.redis.LLen(r.Context(), "jaslide:generation").Result()
	var processing int64
	_ = h.pool.QueryRow(r.Context(), `SELECT count(*) FROM "GenerationJob" WHERE status NOT IN ('QUEUED','COMPLETED','FAILED','CANCELLED')`).Scan(&processing)
	writeJSON(w, http.StatusOK, map[string]any{"queued": queued, "processing": processing})
}

func (h *Handlers) clearCache(w http.ResponseWriter, r *http.Request) {
	var in struct{ Type string }
	_ = json.NewDecoder(r.Body).Decode(&in)
	pattern := "jaslide:*"
	if in.Type == "templates" || in.Type == "models" {
		pattern = "jaslide:" + in.Type + ":*"
	}
	iter := h.redis.Scan(r.Context(), 0, pattern, 0).Iterator()
	deleted := 0
	for iter.Next(r.Context()) {
		if h.redis.Del(r.Context(), iter.Val()).Err() == nil {
			deleted++
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": iter.Err() == nil, "deleted": deleted})
}

func (h *Handlers) modelTest(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ModelID string `json:"modelId"`
	}
	if !decode(w, r, &in) || in.ModelID == "" {
		badRequest(w, "modelId is required")
		return
	}
	var name, provider, endpoint, modelID string
	var apiKey, apiKeyEnvVar *string
	err := h.pool.QueryRow(r.Context(), `SELECT name,provider,COALESCE(endpoint,''),"modelId","apiKey","apiKeyEnvVar" FROM "LlmModel" WHERE id=$1`, in.ModelID).
		Scan(&name, &provider, &endpoint, &modelID, &apiKey, &apiKeyEnvVar)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusOK, map[string]any{"success": false, "error": "Model not found"})
		} else {
			writeError(w, err)
		}
		return
	}
	endpoint = strings.TrimRight(endpoint, "/")
	if endpoint == "" && strings.EqualFold(provider, "openai") {
		endpoint = "https://api.openai.com/v1"
	}
	if endpoint == "" {
		writeJSON(w, http.StatusOK, map[string]any{"success": false, "error": "Model endpoint is not configured"})
		return
	}
	if h.policy != nil && h.policy.ValidateEndpoint(endpoint) != nil {
		writeJSON(w, http.StatusOK, map[string]any{"success": false, "error": "Model endpoint is not allowed"})
		return
	}
	key := ""
	if apiKey != nil {
		key = *apiKey
	}
	if key == "" && apiKeyEnvVar != nil {
		key, _ = h.policy.APIKeyFromEnvironment(*apiKeyEnvVar)
	}
	start := time.Now()
	req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, endpoint+"/models", nil)
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	res, err := h.client.Do(req)
	if err == nil && res.StatusCode >= 200 && res.StatusCode < 300 {
		defer res.Body.Close()
		var models struct {
			Data []struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		_ = json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&models)
		if len(models.Data) > 0 {
			found := false
			for _, model := range models.Data {
				found = found || model.ID == modelID
			}
			if !found {
				writeJSON(w, http.StatusOK, map[string]any{"success": false, "error": "Configured model is not installed on the endpoint"})
				return
			}
		}
		writeJSON(w, http.StatusOK, modelTestSuccess(name, time.Since(start).Milliseconds()))
		return
	}
	if res != nil {
		res.Body.Close()
	}
	body, _ := json.Marshal(map[string]any{
		"model": modelID, "messages": []map[string]string{{"role": "user", "content": "Reply with OK."}},
		"max_tokens": 1, "temperature": 0,
	})
	req, _ = http.NewRequestWithContext(r.Context(), http.MethodPost, endpoint+"/chat/completions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	res, err = h.client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"success": false, "error": err.Error()})
		return
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
		writeJSON(w, http.StatusOK, map[string]any{"success": false, "error": strings.TrimSpace(string(data))})
		return
	}
	writeJSON(w, http.StatusOK, modelTestSuccess(name, time.Since(start).Milliseconds()))
}

func redactModel(row map[string]any) {
	if _, ok := row["apiKey"]; ok {
		row["apiKey"] = nil
	}
}

func (h *Handlers) forceStopJobs(w http.ResponseWriter, r *http.Request) {
	rows, err := h.pool.Query(r.Context(), `
		WITH cancelled AS (
			UPDATE "GenerationJob" SET status='CANCELLED',"completedAt"=now(),"updatedAt"=now()
			WHERE status IN ('PROCESSING','GENERATING_OUTLINE','GENERATING_CONTENT','APPLYING_DESIGN','RENDERING')
			RETURNING id,"presentationId"
		), presentations AS (
			UPDATE "Presentation" SET status='FAILED',"updatedAt"=now()
			WHERE id IN (SELECT "presentationId" FROM cancelled WHERE "presentationId" IS NOT NULL)
		)
		SELECT id FROM cancelled`)
	if err != nil {
		writeError(w, err)
		return
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			writeError(w, err)
			return
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		writeError(w, err)
		return
	}
	if h.canceller != nil {
		for _, id := range ids {
			h.canceller.CancelLive(id)
		}
	}
	writeJSON(w, http.StatusOK, forceStopContract(int64(len(ids))))
}

func (h *Handlers) listOrganizations(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("search"))
	where, args := "", []any{}
	if q != "" {
		where, args = ` WHERE o.name ILIKE $1 OR o.slug ILIKE $1`, []any{"%" + q + "%"}
	}
	sql := `SELECT o.*,(SELECT count(*) FROM "User" u WHERE u."organizationId"=o.id) "_userCount",
		(SELECT count(*) FROM "Template" t WHERE t."organizationId"=o.id) "_templateCount",
		(SELECT count(*) FROM "Asset" a WHERE a."organizationId"=o.id) "_assetCount"
		FROM "Organization" o` + where + ` ORDER BY o."createdAt" DESC`
	pagedQueryTransform(w, r, h.pool, sql, `SELECT count(*) FROM "Organization" o`+where, args,
		func(row map[string]any) {
			addCountContract(row, map[string]string{
				"users": "_userCount", "templates": "_templateCount", "assets": "_assetCount",
			})
		})
}

func (h *Handlers) getOrganization(w http.ResponseWriter, r *http.Request) {
	row, err := queryOneMap(r.Context(), h.pool, `SELECT * FROM "Organization" WHERE id=$1`, chi.URLParam(r, "id"))
	writeResult(w, row, err)
}

func (h *Handlers) createOrganization(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name, Slug, Domain, Logo string
		Plan                     string
		BrandSettings            json.RawMessage
	}
	if !decode(w, r, &in) || in.Name == "" || in.Slug == "" {
		badRequest(w, "name and slug are required")
		return
	}
	if in.Plan == "" {
		in.Plan = "FREE"
	}
	if len(in.BrandSettings) == 0 {
		in.BrandSettings = json.RawMessage(`{}`)
	}
	row, err := queryOneMap(r.Context(), h.pool, `INSERT INTO "Organization"(id,name,slug,domain,logo,"brandSettings",plan,"createdAt","updatedAt") VALUES($1,$2,$3,NULLIF($4,''),NULLIF($5,''),$6::jsonb,$7::"OrganizationPlan",now(),now()) RETURNING *`,
		newID(), in.Name, in.Slug, in.Domain, in.Logo, in.BrandSettings, in.Plan)
	writeCreated(w, row, err)
}

func (h *Handlers) updateOrganization(w http.ResponseWriter, r *http.Request) {
	var raw map[string]json.RawMessage
	if !decode(w, r, &raw) {
		return
	}
	row, err := h.dynamicUpdate(r.Context(), "Organization", chi.URLParam(r, "id"), raw, map[string]string{
		"name": "name", "domain": "domain", "logo": "logo", "brandSettings": `"brandSettings"`, "plan": "plan",
	})
	writeResult(w, row, err)
}

func (h *Handlers) listPolicies(w http.ResponseWriter, r *http.Request) {
	where, args := filters(r, []filterSpec{{"category", "category"}})
	pagedQuery(w, r, h.pool, `SELECT * FROM "SystemPolicy"`+where+` ORDER BY "createdAt" DESC`, `SELECT count(*) FROM "SystemPolicy"`+where, args)
}

func (h *Handlers) createPolicy(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Category, Key, Description string
		Value                      json.RawMessage
	}
	if !decode(w, r, &in) || in.Category == "" || in.Key == "" || len(in.Value) == 0 {
		badRequest(w, "category, key and value are required")
		return
	}
	row, err := queryOneMap(r.Context(), h.pool, `INSERT INTO "SystemPolicy"(id,category,key,value,description,"createdAt","updatedAt") VALUES($1,$2,$3,$4::jsonb,NULLIF($5,''),now(),now()) RETURNING *`,
		newID(), in.Category, in.Key, in.Value, in.Description)
	writeCreated(w, row, err)
}

func (h *Handlers) updatePolicy(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Value       json.RawMessage
		Description *string
	}
	if !decode(w, r, &in) {
		return
	}
	row, err := queryOneMap(r.Context(), h.pool, `UPDATE "SystemPolicy" SET value=COALESCE($2::jsonb,value),description=COALESCE($3,description),"updatedAt"=now() WHERE id=$1 RETURNING *`,
		chi.URLParam(r, "id"), nullableJSON(in.Value), in.Description)
	writeResult(w, row, err)
}

func (h *Handlers) listPrompts(w http.ResponseWriter, r *http.Request) {
	where, args := filters(r, []filterSpec{{"category", "p.category"}})
	sql := `SELECT p.*,
		COALESCE((SELECT json_agg(v ORDER BY v.version DESC) FROM (SELECT * FROM "PromptTemplateVersion" WHERE "templateId"=p.id ORDER BY version DESC LIMIT 1) v),'[]') versions,
		json_build_object('versions',(SELECT count(*) FROM "PromptTemplateVersion" v WHERE v."templateId"=p.id)) "_count"
		FROM "PromptRegistry" p` + where + ` ORDER BY p."createdAt" DESC`
	pagedQuery(w, r, h.pool, sql, `SELECT count(*) FROM "PromptRegistry" p`+where, args)
}

func (h *Handlers) getPrompt(w http.ResponseWriter, r *http.Request) {
	row, err := queryOneMap(r.Context(), h.pool, `SELECT p.*,COALESCE((SELECT json_agg(v ORDER BY v.version DESC) FROM "PromptTemplateVersion" v WHERE v."templateId"=p.id),'[]') versions FROM "PromptRegistry" p WHERE p.id=$1`, promptID(r))
	writeResult(w, row, err)
}

func (h *Handlers) createPrompt(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name, Category, Description, Content string
		Variables                            json.RawMessage
	}
	if !decode(w, r, &in) || in.Name == "" || in.Category == "" || in.Content == "" {
		badRequest(w, "name, category and content are required")
		return
	}
	if len(in.Variables) == 0 {
		in.Variables = json.RawMessage(`[]`)
	}
	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	id := newID()
	_, err = tx.Exec(r.Context(), `INSERT INTO "PromptRegistry"(id,name,category,description,"createdAt","updatedAt") VALUES($1,$2,$3,NULLIF($4,''),now(),now())`, id, in.Name, in.Category, in.Description)
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO "PromptTemplateVersion"(id,"templateId",version,content,variables,"isActive","createdAt") VALUES($1,$2,1,$3,$4::jsonb,true,now())`, newID(), id, in.Content, in.Variables)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeError(w, err)
		return
	}
	h.getPrompt(w, r.WithContext(context.WithValue(r.Context(), promptIDKey{}, id)))
}

type promptIDKey struct{}

func promptID(r *http.Request) string {
	if id, ok := r.Context().Value(promptIDKey{}).(string); ok {
		return id
	}
	return chi.URLParam(r, "id")
}

func (h *Handlers) createPromptVersion(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Content   string
		Variables json.RawMessage
	}
	if !decode(w, r, &in) || in.Content == "" {
		badRequest(w, "content is required")
		return
	}
	if len(in.Variables) == 0 {
		in.Variables = json.RawMessage(`[]`)
	}
	row, err := queryOneMap(r.Context(), h.pool, `INSERT INTO "PromptTemplateVersion"(id,"templateId",version,content,variables,"isActive","createdAt")
		SELECT $2,$1,COALESCE(max(version),0)+1,$3,$4::jsonb,true,now() FROM "PromptTemplateVersion" WHERE "templateId"=$1 RETURNING *`,
		promptID(r), newID(), in.Content, in.Variables)
	writeCreated(w, row, err)
}

func (h *Handlers) rollbackPrompt(w http.ResponseWriter, r *http.Request) {
	version, err := strconv.Atoi(chi.URLParam(r, "version"))
	if err != nil {
		badRequest(w, "invalid version")
		return
	}
	tx, err := h.pool.Begin(r.Context())
	if err == nil {
		_, err = tx.Exec(r.Context(), `UPDATE "PromptTemplateVersion" SET "isActive"=false WHERE "templateId"=$1`, promptID(r))
	}
	if err == nil {
		tag, execErr := tx.Exec(r.Context(), `UPDATE "PromptTemplateVersion" SET "isActive"=true WHERE "templateId"=$1 AND version=$2`, promptID(r), version)
		err = execErr
		if err == nil && tag.RowsAffected() == 0 {
			err = pgx.ErrNoRows
		}
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "activeVersion": version})
}

func (h *Handlers) testPrompt(w http.ResponseWriter, r *http.Request) {
	var input map[string]any
	if !decode(w, r, &input) {
		return
	}
	var content string
	var variables []string
	err := h.pool.QueryRow(r.Context(), `SELECT content,variables FROM "PromptTemplateVersion" WHERE "templateId"=$1 AND "isActive"=true ORDER BY version DESC LIMIT 1`, promptID(r)).Scan(&content, &variables)
	if err != nil {
		writeError(w, err)
		return
	}
	for _, variable := range variables {
		if value, ok := input[variable]; ok {
			content = strings.ReplaceAll(content, "{{"+variable+"}}", fmt.Sprint(value))
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"rendered": content, "variables": variables})
}

func (h *Handlers) listRoles(w http.ResponseWriter, r *http.Request) {
	pagedQuery(w, r, h.pool, `SELECT r.*,json_build_object('users',(SELECT count(*) FROM "UserRoleAssignment" u WHERE u."roleId"=r.id)) "_count" FROM "Role" r ORDER BY r."createdAt" DESC`, `SELECT count(*) FROM "Role"`, nil)
}

func (h *Handlers) getRole(w http.ResponseWriter, r *http.Request) {
	row, err := queryOneMap(r.Context(), h.pool, `SELECT * FROM "Role" WHERE id=$1`, chi.URLParam(r, "id"))
	writeResult(w, row, err)
}

func (h *Handlers) createRole(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name, Description string
		Permissions       json.RawMessage
	}
	if !decode(w, r, &in) || in.Name == "" {
		badRequest(w, "name is required")
		return
	}
	if len(in.Permissions) == 0 {
		in.Permissions = json.RawMessage(`[]`)
	}
	row, err := queryOneMap(r.Context(), h.pool, `INSERT INTO "Role"(id,name,description,permissions,"isSystem","createdAt","updatedAt") VALUES($1,$2,NULLIF($3,''),$4::jsonb,false,now(),now()) RETURNING *`, newID(), in.Name, in.Description, in.Permissions)
	writeCreated(w, row, err)
}

func (h *Handlers) updateRole(w http.ResponseWriter, r *http.Request) {
	var raw map[string]json.RawMessage
	if !decode(w, r, &raw) {
		return
	}
	row, err := h.dynamicUpdate(r.Context(), "Role", chi.URLParam(r, "id"), raw, map[string]string{"name": "name", "description": "description", "permissions": "permissions"})
	writeResult(w, row, err)
}

func (h *Handlers) deleteRole(w http.ResponseWriter, r *http.Request) {
	tag, err := h.pool.Exec(r.Context(), `DELETE FROM "Role" WHERE id=$1 AND "isSystem"=false`, chi.URLParam(r, "id"))
	if err == nil && tag.RowsAffected() == 0 {
		err = errors.New("system roles cannot be deleted")
	}
	writeDeleted(w, err)
}

func (h *Handlers) assignRole(w http.ResponseWriter, r *http.Request) {
	_, err := h.pool.Exec(r.Context(), `INSERT INTO "UserRoleAssignment"(id,"userId","roleId","createdAt") VALUES($1,$2,$3,now()) ON CONFLICT ("userId","roleId") DO NOTHING`, newID(), chi.URLParam(r, "userId"), chi.URLParam(r, "roleId"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]bool{"success": true})
}

func (h *Handlers) removeRole(w http.ResponseWriter, r *http.Request) {
	_, err := h.pool.Exec(r.Context(), `DELETE FROM "UserRoleAssignment" WHERE "userId"=$1 AND "roleId"=$2`, chi.URLParam(r, "userId"), chi.URLParam(r, "roleId"))
	writeDeleted(w, err)
}

func (h *Handlers) listUsers(w http.ResponseWriter, r *http.Request) {
	where, args := filters(r, []filterSpec{{"role", "u.role::text"}, {"status", "u.status::text"}, {"organizationId", `u."organizationId"`}})
	if q := strings.TrimSpace(r.URL.Query().Get("search")); q != "" {
		where, args = appendCondition(where, args, `(u.email ILIKE $%d OR u.name ILIKE $%d)`, "%"+q+"%")
	}
	sql := `SELECT u.id,u.email,u.name,u.image,u.role,u.status,u."organizationId",u."lastLoginAt",u."createdAt",u."updatedAt",
		CASE WHEN o.id IS NULL THEN NULL ELSE json_build_object('id',o.id,'name',o.name,'slug',o.slug) END organization,
		json_build_object('presentations',(SELECT count(*) FROM "Presentation" p WHERE p."userId"=u.id),'assets',(SELECT count(*) FROM "Asset" a WHERE a."userId"=u.id)) "_count"
		FROM "User" u LEFT JOIN "Organization" o ON o.id=u."organizationId"` + where + ` ORDER BY u."createdAt" DESC`
	pagedQuery(w, r, h.pool, sql, `SELECT count(*) FROM "User" u`+where, args)
}

func (h *Handlers) getUser(w http.ResponseWriter, r *http.Request) {
	row, err := queryOneMap(r.Context(), h.pool, `SELECT id,email,name,image,role,status,"organizationId","lastLoginAt","createdAt","updatedAt" FROM "User" WHERE id=$1`, chi.URLParam(r, "id"))
	writeResult(w, row, err)
}

func (h *Handlers) createUser(w http.ResponseWriter, r *http.Request) {
	var in struct{ Email, Password, Name, Role, OrganizationID string }
	if !decode(w, r, &in) || strings.TrimSpace(in.Email) == "" {
		badRequest(w, "email is required")
		return
	}
	if _, err := queryOneMap(r.Context(), h.pool, `SELECT id FROM "User" WHERE email=$1`, in.Email); err == nil {
		badRequest(w, "Email already exists")
		return
	} else if !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, err)
		return
	}
	var hashed *string
	if in.Password != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), 10)
		if err != nil {
			writeError(w, err)
			return
		}
		value := string(hash)
		hashed = &value
	}
	role := in.Role
	if role == "" {
		role = "USER"
	}
	row, err := queryOneMap(r.Context(), h.pool, `
		INSERT INTO "User"(id,email,name,password,role,"organizationId","updatedAt")
		VALUES($1,$2,NULLIF($3,''),$4,$5::"UserRole",NULLIF($6,''),now())
		RETURNING id,email,name,role,status,"organizationId","createdAt"`,
		newID(), in.Email, in.Name, hashed, role, in.OrganizationID)
	writeCreated(w, row, err)
}

func (h *Handlers) updateUser(w http.ResponseWriter, r *http.Request) {
	var in struct{ Name, Image, Role, Status, OrganizationID *string }
	if !decode(w, r, &in) {
		return
	}
	row, err := queryOneMap(r.Context(), h.pool, `
		UPDATE "User" SET
		  name=COALESCE($2,name), image=COALESCE($3,image),
		  role=COALESCE($4::"UserRole",role), status=COALESCE($5::"UserStatus",status),
		  "organizationId"=COALESCE($6,"organizationId"), "updatedAt"=now()
		WHERE id=$1
		RETURNING id,email,name,image,role,status,"organizationId","updatedAt"`,
		chi.URLParam(r, "id"), in.Name, in.Image, in.Role, in.Status, in.OrganizationID)
	writeResult(w, row, err)
}

func (h *Handlers) deactivateUser(w http.ResponseWriter, r *http.Request) {
	_, err := queryOneMap(r.Context(), h.pool,
		`UPDATE "User" SET status='INACTIVE',"updatedAt"=now() WHERE id=$1 RETURNING id`, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "message": "User deactivated successfully"})
}

func (h *Handlers) dynamicUpdate(ctx context.Context, table, id string, raw map[string]json.RawMessage, allowed map[string]string) (map[string]any, error) {
	sets, args := make([]string, 0, len(raw)+1), []any{id}
	for key, value := range raw {
		column, ok := allowed[key]
		if !ok {
			continue
		}
		var decoded any
		if err := json.Unmarshal(value, &decoded); err != nil {
			return nil, err
		}
		if key == "config" || key == "brandSettings" || key == "permissions" {
			args = append(args, string(value))
		} else {
			args = append(args, decoded)
		}
		cast := ""
		switch key {
		case "config", "brandSettings", "permissions":
			cast = "::jsonb"
		case "plan":
			cast = `::"OrganizationPlan"`
		case "maxTokens", "rateLimit":
			cast = "::integer"
		case "costPerToken":
			cast = "::numeric"
		case "isActive", "isDefault":
			cast = "::boolean"
		}
		sets = append(sets, fmt.Sprintf(`%s=$%d%s`, column, len(args), cast))
	}
	if len(sets) == 0 {
		return queryOneMap(ctx, h.pool, `SELECT * FROM "`+table+`" WHERE id=$1`, id)
	}
	sets = append(sets, `"updatedAt"=now()`)
	return queryOneMap(ctx, h.pool, `UPDATE "`+table+`" SET `+strings.Join(sets, ",")+` WHERE id=$1 RETURNING *`, args...)
}

func (h *Handlers) deleteByID(sql string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, err := h.pool.Exec(r.Context(), sql, chi.URLParam(r, "id"))
		writeDeleted(w, err)
	}
}

type queryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

type filterSpec struct{ param, column string }

func filters(r *http.Request, specs []filterSpec) (string, []any) {
	var clauses []string
	var args []any
	for _, spec := range specs {
		if value := strings.TrimSpace(r.URL.Query().Get(spec.param)); value != "" {
			args = append(args, value)
			clauses = append(clauses, fmt.Sprintf(`%s=$%d`, spec.column, len(args)))
		}
	}
	if len(clauses) == 0 {
		return "", args
	}
	return " WHERE " + strings.Join(clauses, " AND "), args
}

func appendCondition(where string, args []any, format, value string) (string, []any) {
	args = append(args, value)
	condition := fmt.Sprintf(format, len(args), len(args))
	if where == "" {
		return " WHERE " + condition, args
	}
	return where + " AND " + condition, args
}

func pagedQuery(w http.ResponseWriter, r *http.Request, pool *pgxpool.Pool, sql, countSQL string, args []any) {
	pagedQueryTransform(w, r, pool, sql, countSQL, args, nil)
}

func pagedQueryTransform(
	w http.ResponseWriter,
	r *http.Request,
	pool *pgxpool.Pool,
	sql, countSQL string,
	args []any,
	transform func(map[string]any),
) {
	page, limit := pagination(r)
	var total int64
	if err := pool.QueryRow(r.Context(), countSQL, args...).Scan(&total); err != nil {
		writeError(w, err)
		return
	}
	queryArgs := append(append([]any{}, args...), limit, (page-1)*limit)
	data, err := queryMaps(r.Context(), pool, sql+fmt.Sprintf(` LIMIT $%d OFFSET $%d`, len(args)+1, len(args)+2), queryArgs...)
	if err != nil {
		writeError(w, err)
		return
	}
	if transform != nil {
		for _, row := range data {
			transform(row)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": data, "total": total, "page": page, "limit": limit, "totalPages": (total + int64(limit) - 1) / int64(limit)})
}

func pagination(r *http.Request) (int, int) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}
	return page, limit
}

func queryMaps(ctx context.Context, q queryer, sql string, args ...any) ([]map[string]any, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	fields := rows.FieldDescriptions()
	result := []map[string]any{}
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, err
		}
		row := make(map[string]any, len(values))
		for i, value := range values {
			row[string(fields[i].Name)] = value
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func queryOneMap(ctx context.Context, q queryer, sql string, args ...any) (map[string]any, error) {
	rows, err := queryMaps(ctx, q, sql, args...)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, pgx.ErrNoRows
	}
	return rows[0], nil
}

func decode(w http.ResponseWriter, r *http.Request, value any) bool {
	decoder := json.NewDecoder(io.LimitReader(r.Body, 2<<20))
	if err := decoder.Decode(value); err != nil {
		badRequest(w, "Invalid JSON body")
		return false
	}
	return true
}

func nullableJSON(raw json.RawMessage) any {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	return raw
}

func newID() string {
	var raw [12]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return "c" + hex.EncodeToString(raw[:])
}

func number(value any) int64 {
	switch value := value.(type) {
	case int64:
		return value
	case int32:
		return int64(value)
	case int:
		return int64(value)
	default:
		n, _ := strconv.ParseInt(fmt.Sprint(value), 10, 64)
		return n
	}
}

func addCountContract(row map[string]any, fields map[string]string) {
	counts := make(map[string]int64, len(fields))
	for name, source := range fields {
		counts[name] = number(row[source])
		delete(row, source)
	}
	row["_count"] = counts
}

func dashboardStatsContract(totalUsers, activeUsers, totalPresentations, totalGenerations, failedGenerations int64) map[string]any {
	errorRate := float64(0)
	if totalGenerations > 0 {
		errorRate = math.Round(float64(failedGenerations)*10000/float64(totalGenerations)) / 100
	}
	return map[string]any{
		"totalUsers": int(totalUsers), "activeUsers": int(activeUsers),
		"totalPresentations": int(totalPresentations), "totalGenerations": int(totalGenerations),
		"errorRate": errorRate,
	}
}

func jobStatsContract(rows []map[string]any, recent24h int64) map[string]any {
	byStatus := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		byStatus = append(byStatus, map[string]any{
			"status": fmt.Sprint(row["status"]), "_count": number(row["count"]),
		})
	}
	return map[string]any{"byStatus": byStatus, "last24Hours": recent24h}
}

func forceStopContract(affected int64) map[string]any {
	return map[string]any{"success": true, "affectedJobs": affected}
}

func modelTestSuccess(name string, responseTime int64) map[string]any {
	return map[string]any{
		"success": true, "model": name, "responseTime": responseTime,
		"message": "Model endpoint is reachable",
	}
}

func memoryContract(mem runtime.MemStats) map[string]uint64 {
	const megabyte = 1 << 20
	return map[string]uint64{
		"heapUsed":  mem.HeapAlloc / megabyte,
		"heapTotal": mem.HeapSys / megabyte,
		"rss":       mem.Sys / megabyte,
	}
}

func writeCreated(w http.ResponseWriter, value any, err error) {
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, value)
}

func writeResult(w http.ResponseWriter, value any, err error) {
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func writeDeleted(w http.ResponseWriter, err error) {
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func writeError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	message := "Internal server error"
	if errors.Is(err, pgx.ErrNoRows) {
		status, message = http.StatusNotFound, "Not found"
	} else if strings.Contains(strings.ToLower(err.Error()), "cannot be deleted") {
		status, message = http.StatusBadRequest, err.Error()
	}
	writeJSON(w, status, map[string]any{"message": message, "statusCode": status})
}

func badRequest(w http.ResponseWriter, message string) {
	writeJSON(w, http.StatusBadRequest, map[string]any{"message": message, "statusCode": http.StatusBadRequest})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
