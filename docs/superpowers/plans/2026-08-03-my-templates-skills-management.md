# 내 템플릿/스킬 관리 화면 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user rename, delete, and change the share scope (private/organization/public) of their own PPTX-imported skill+template pairs from the existing `/skills` page, and preview the template's first slide before deciding.

**Architecture:** Two new single-item endpoints (`PATCH /skills/{id}`, `DELETE /skills/{id}`) plus one read-only preview endpoint (`GET /skills/{id}/preview-html`) added to the existing `apps/core-api/internal/skills` router. Each write cascades to the linked `Template` row in the same transaction, using the `userId`/`organizationId`/`isPublic` columns both tables already have. The frontend extends the existing `skills-gallery.tsx` component (no new page, no new route) with a card menu, a visibility badge, a rename modal, and a preview modal that renders the already-extracted `Template.config.htmlSlides[0]` in a scaled iframe — no new rendering pipeline.

**Tech Stack:** Go (chi router, pgx), React/TSX (existing `skillsApi` axios client), Postgres (existing schema, **no new migration**).

## Global Constraints

- No new DB migration: `PresentationSkill` and `Template` already have `userId`/`organizationId`/`isPublic` (see `20260717090000_add_presentation_skills` and `20260802000000_add_template_owner`).
- Scope values are exactly the three strings `"private"`, `"organization"`, `"public"` — nothing else is valid.
- Cascading delete of `Template` relies on the existing FK `Presentation_templateId_fkey ... ON DELETE SET NULL` — do not add new cleanup code for `Presentation.templateId`, it already goes to `NULL` automatically.
- Follow the existing route co-existence pattern already used in `apps/core-api/internal/templates/handlers.go` (`Get("/", ...)` next to `Get("/{id}", ...)`, `Patch("/{id}", ...)`, `Delete("/{id}", ...)`) — chi already supports this in this codebase, no new pattern needed.
- Go integration tests that need a real Postgres follow the existing gate: `t.Skip("set JASLIDE_TEST_DATABASE_URL and JASLIDE_TEST_REDIS_URL to run integration test")` (see `apps/core-api/internal/db/db_test.go`).
- Web tests follow the existing plain `node:test` + `assert.match(source, /pattern/)` convention used in `apps/web/test/*.test.js` — no new test framework, no component-rendering library.
- No new npm dependency for the card dropdown menu — hand-roll it with existing Tailwind classes, matching every other modal already in `skills-gallery.tsx`.

---

### Task 1: Backend — `PATCH /skills/{id}` (rename + scope, cascades to Template)

**Files:**
- Modify: `apps/core-api/internal/skills/handlers.go`
- Test: `apps/core-api/internal/skills/handlers_test.go` (new file)

**Interfaces:**
- Produces: `scopeColumns(scope string, userOrgID *string) (isPublic bool, organizationID *string, err error)` — used again by Task 2's cascading logic pattern (copy the call, not the function — Task 2 doesn't change scope) and referenced in the design spec.
- Produces: `skillUpdateInput{Name *string, Scope *string}` — the PATCH body shape the frontend (Task 4) must send.
- Produces route: `PATCH /skills/{id}` → `200 {..skill row as JSON..}` on success, `404 {"message":"Skill not found"}` if not owner, `400` on invalid name/scope.

- [ ] **Step 1: Write the failing test for `scopeColumns`**

Add to a new file `apps/core-api/internal/skills/handlers_test.go`:

```go
package skills

import (
	"testing"
)

func TestScopeColumnsMapsEachScopeToItsColumns(t *testing.T) {
	orgID := "org-1"

	isPublic, organizationID, err := scopeColumns("private", &orgID)
	if err != nil || isPublic || organizationID != nil {
		t.Fatalf("private = %v, %v, %v; want false, nil, nil", isPublic, organizationID, err)
	}

	isPublic, organizationID, err = scopeColumns("organization", &orgID)
	if err != nil || isPublic || organizationID == nil || *organizationID != orgID {
		t.Fatalf("organization = %v, %v, %v; want false, %q, nil", isPublic, organizationID, err, orgID)
	}

	isPublic, organizationID, err = scopeColumns("organization", nil)
	if err == nil {
		t.Fatal("organization with no user org = nil error, want an error")
	}

	isPublic, organizationID, err = scopeColumns("public", &orgID)
	if err != nil || !isPublic || organizationID != nil {
		t.Fatalf("public = %v, %v, %v; want true, nil, nil", isPublic, organizationID, err)
	}

	if _, _, err := scopeColumns("bogus", &orgID); err == nil {
		t.Fatal("bogus scope = nil error, want an error")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./apps/core-api/internal/skills/... -run TestScopeColumnsMapsEachScopeToItsColumns -v`
Expected: FAIL with `undefined: scopeColumns`

- [ ] **Step 3: Implement `scopeColumns` and `skillUpdateInput`**

In `apps/core-api/internal/skills/handlers.go`, add near the other type definitions (after `skillInput`/`valid()`, around line 234):

```go
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
```

Add `"errors"` to the import block at the top of `handlers.go`:

```go
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
```

(`github.com/jackc/pgx/v5` is added now because Step 5 below uses `pgx.ErrNoRows`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./apps/core-api/internal/skills/... -run TestScopeColumnsMapsEachScopeToItsColumns -v`
Expected: PASS

- [ ] **Step 5: Write the failing integration test for the `update` handler**

Append to `apps/core-api/internal/skills/handlers_test.go`:

```go
import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/auth"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/config"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
)

func TestUpdateRenamesAndChangesScopeCascadingToTemplate(t *testing.T) {
	store, authService, sessions := newTestStore(t)
	ctx := context.Background()
	suffix := fmt.Sprint(time.Now().UnixNano())

	ownerID := createTestUser(t, ctx, store, "owner-"+suffix, "owner-"+suffix+"@example.com", nil)
	otherID := createTestUser(t, ctx, store, "other-"+suffix, "other-"+suffix+"@example.com", nil)
	orgID := createTestOrg(t, ctx, store, "org-"+suffix)
	orgUserID := createTestUser(t, ctx, store, "orguser-"+suffix, "orguser-"+suffix+"@example.com", &orgID)

	templateID, skillID := createTestSkillWithTemplate(t, ctx, store, "tpl-"+suffix, "skill-"+suffix, ownerID, nil)

	router := chi.NewRouter()
	router.Mount("/api/skills", NewHandlers(store, nil, "", authService))
	server := httptest.NewServer(router)
	defer server.Close()
	client := server.Client()

	ownerToken := issueTestToken(t, sessions, ownerID, "owner-"+suffix+"@example.com")
	otherToken := issueTestToken(t, sessions, otherID, "other-"+suffix+"@example.com")
	orgUserToken := issueTestToken(t, sessions, orgUserID, "orguser-"+suffix+"@example.com")

	// A non-owner cannot rename or re-scope another user's skill.
	requestJSON(t, client, otherToken, http.MethodPatch, server.URL+"/api/skills/"+skillID,
		`{"name":"Hijacked"}`, http.StatusNotFound)

	// Empty name is rejected.
	requestJSON(t, client, ownerToken, http.MethodPatch, server.URL+"/api/skills/"+skillID,
		`{"name":"  "}`, http.StatusBadRequest)

	// An organization-less owner cannot pick the "organization" scope.
	requestJSON(t, client, ownerToken, http.MethodPatch, server.URL+"/api/skills/"+skillID,
		`{"scope":"organization"}`, http.StatusBadRequest)

	// Rename + go public, in one call, cascades to the linked Template.
	updated := requestJSON(t, client, ownerToken, http.MethodPatch, server.URL+"/api/skills/"+skillID,
		`{"name":"Renamed Skill","scope":"public"}`, http.StatusOK)
	if updated["name"] != "Renamed Skill" || updated["isPublic"] != true {
		t.Fatalf("updated skill = %#v", updated)
	}
	var templateName string
	var templateIsPublic bool
	if err := store.Pool().QueryRow(ctx,
		`SELECT "name","isPublic" FROM "Template" WHERE "id"=$1`, templateID,
	).Scan(&templateName, &templateIsPublic); err != nil {
		t.Fatal(err)
	}
	if templateName != "Renamed Skill" || !templateIsPublic {
		t.Fatalf("template after cascade = %q, %v; want Renamed Skill, true", templateName, templateIsPublic)
	}

	// An org member with an organization can use the "organization" scope.
	_, orgSkillID := createTestSkillWithTemplate(t, ctx, store, "orgtpl-"+suffix, "orgskill-"+suffix, orgUserID, &orgID)
	orgUpdated := requestJSON(t, client, orgUserToken, http.MethodPatch, server.URL+"/api/skills/"+orgSkillID,
		`{"scope":"organization"}`, http.StatusOK)
	if orgUpdated["organizationId"] != orgID || orgUpdated["isPublic"] != false {
		t.Fatalf("org-scoped skill = %#v", orgUpdated)
	}
}

func newTestStore(t *testing.T) (*db.Store, *auth.Service, *auth.Sessions) {
	t.Helper()
	databaseURL := os.Getenv("JASLIDE_TEST_DATABASE_URL")
	redisURL := os.Getenv("JASLIDE_TEST_REDIS_URL")
	if databaseURL == "" || redisURL == "" {
		t.Skip("set JASLIDE_TEST_DATABASE_URL and JASLIDE_TEST_REDIS_URL to run integration test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	store, err := db.Open(ctx, config.Config{DatabaseURL: databaseURL, RedisURL: redisURL})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	sessions, err := auth.NewSessions("skills-handlers-test-secret", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	return store, auth.NewService(store, sessions), sessions
}

func createTestUser(t *testing.T, ctx context.Context, store *db.Store, id, email string, organizationID *string) string {
	t.Helper()
	if _, err := store.Pool().Exec(ctx,
		`INSERT INTO "User" (id,email,role,"organizationId","updatedAt") VALUES ($1,$2,'USER',$3,NOW())`,
		id, email, organizationID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = store.Pool().Exec(context.Background(), `DELETE FROM "User" WHERE id=$1`, id)
	})
	return id
}

func createTestOrg(t *testing.T, ctx context.Context, store *db.Store, id string) string {
	t.Helper()
	if _, err := store.Pool().Exec(ctx,
		`INSERT INTO "Organization" (id,name,slug,"updatedAt") VALUES ($1,$1,$1,NOW())`, id); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = store.Pool().Exec(context.Background(), `DELETE FROM "Organization" WHERE id=$1`, id)
	})
	return id
}

func createTestSkillWithTemplate(
	t *testing.T, ctx context.Context, store *db.Store, templateID, skillID, userID string, organizationID *string,
) (string, string) {
	t.Helper()
	if _, err := store.Pool().Exec(ctx, `
		INSERT INTO "Template" (id,name,category,config,"isPublic","userId","organizationId","updatedAt")
		VALUES ($1,$1,'BUSINESS','{"htmlSlides":["<html><body>Hello</body></html>"]}'::jsonb,FALSE,$2,$3,NOW())`,
		templateID, userID, organizationID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = store.Pool().Exec(context.Background(), `DELETE FROM "Template" WHERE id=$1`, templateID)
	})
	if _, err := store.Pool().Exec(ctx, `
		INSERT INTO "PresentationSkill"
			(id,name,category,audience,tone,purpose,"outlineGuidance","recommendedSlideCount",
			 "userId","organizationId","templateId","updatedAt")
		VALUES ($1,$1,'CUSTOM','General','Clear','Test',$2,10,$3,$4,$5,NOW())`,
		skillID, "test guidance", userID, organizationID, templateID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = store.Pool().Exec(context.Background(), `DELETE FROM "PresentationSkill" WHERE id=$1`, skillID)
	})
	return templateID, skillID
}

func issueTestToken(t *testing.T, sessions *auth.Sessions, userID, email string) string {
	t.Helper()
	token, err := sessions.Issue(auth.Principal{ID: userID, Email: email, Role: "USER"})
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func requestJSON(t *testing.T, client *http.Client, token, method, target, body string, want int) map[string]any {
	t.Helper()
	req, err := http.NewRequest(method, target, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.AddCookie(&http.Cookie{Name: "jaslide_session", Value: token})
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	response, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != want {
		data, _ := io.ReadAll(response.Body)
		t.Fatalf("%s %s = %d %s, want %d", method, target, response.StatusCode, data, want)
	}
	var value map[string]any
	if response.ContentLength == 0 {
		return value
	}
	if err := json.NewDecoder(response.Body).Decode(&value); err != nil {
		t.Fatal(err)
	}
	return value
}
```

Before running the test, replace the file's existing `package skills` / `import (...)` header (written in Step 1, which only imports `testing`) with this merged header — Go rejects a file that imports the same package twice, so the two blocks cannot coexist:

```go
package skills

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/auth"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/config"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
)
```

- [ ] **Step 6: Run test to verify it fails**

Run: `go test ./apps/core-api/internal/skills/... -run TestUpdateRenamesAndChangesScopeCascadingToTemplate -v`
Expected: FAIL with `undefined: NewHandlers` accepting an `update` route (compile error — route `/{id}` PATCH doesn't exist yet, so the request returns 404 with chi's default "not found" body rather than our JSON, and/or `handler.update` doesn't exist) — if it's a compile error because `update` isn't referenced yet, that's fine, the test file compiles against the package as-is (no direct reference to `update`), so the real expected failure is the first `requestJSON` call returning chi's plain-text 404 instead of the expected JSON body/status. Confirm the test fails for that reason before proceeding.

- [ ] **Step 7: Implement the `update` handler and mount its route**

In `apps/core-api/internal/skills/handlers.go`, add the route inside `NewHandlers` (after `router.Post("/import-pptx", handler.importPPTX)`):

```go
	router.Patch("/{id}", handler.update)
```

Add the handler after `deleteMany` (after line 111, before `importPPTX`):

```go
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
```

- [ ] **Step 8: Run test to verify it passes**

Run: `JASLIDE_TEST_DATABASE_URL=<url> JASLIDE_TEST_REDIS_URL=<url> go test ./apps/core-api/internal/skills/... -run TestUpdateRenamesAndChangesScopeCascadingToTemplate -v`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/core-api/internal/skills/handlers.go apps/core-api/internal/skills/handlers_test.go
git commit -m "feat(skills): add PATCH /skills/{id} to rename and re-scope a skill+template pair"
```

---

### Task 2: Backend — `DELETE /skills/{id}` (single-item, cascades to Template)

**Files:**
- Modify: `apps/core-api/internal/skills/handlers.go`
- Modify: `apps/core-api/internal/skills/handlers_test.go`

**Interfaces:**
- Consumes: `createTestUser`, `createTestOrg`, `createTestSkillWithTemplate`, `issueTestToken`, `requestJSON`, `newTestStore` from Task 1.
- Produces route: `DELETE /skills/{id}` → `200 {"success":true}` on success, `404` if not owner.

- [ ] **Step 1: Write the failing test**

Append to `apps/core-api/internal/skills/handlers_test.go`:

```go
func TestDeleteRemovesSkillAndCascadesToTemplateLeavingPresentationsIntact(t *testing.T) {
	store, authService, sessions := newTestStore(t)
	ctx := context.Background()
	suffix := fmt.Sprint(time.Now().UnixNano())

	ownerID := createTestUser(t, ctx, store, "del-owner-"+suffix, "del-owner-"+suffix+"@example.com", nil)
	otherID := createTestUser(t, ctx, store, "del-other-"+suffix, "del-other-"+suffix+"@example.com", nil)
	templateID, skillID := createTestSkillWithTemplate(t, ctx, store, "del-tpl-"+suffix, "del-skill-"+suffix, ownerID, nil)

	presentationID := "del-pres-" + suffix
	if _, err := store.Pool().Exec(ctx, `
		INSERT INTO "Presentation" (id,title,"userId","templateId","sourceType","updatedAt")
		VALUES ($1,'Uses the template',$2,$3,'TEXT',NOW())`,
		presentationID, ownerID, templateID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = store.Pool().Exec(context.Background(), `DELETE FROM "Presentation" WHERE id=$1`, presentationID)
	})

	router := chi.NewRouter()
	router.Mount("/api/skills", NewHandlers(store, nil, "", authService))
	server := httptest.NewServer(router)
	defer server.Close()
	client := server.Client()

	otherToken := issueTestToken(t, sessions, otherID, "del-other-"+suffix+"@example.com")
	ownerToken := issueTestToken(t, sessions, ownerID, "del-owner-"+suffix+"@example.com")

	requestJSON(t, client, otherToken, http.MethodDelete, server.URL+"/api/skills/"+skillID, "", http.StatusNotFound)
	requestJSON(t, client, ownerToken, http.MethodDelete, server.URL+"/api/skills/"+skillID, "", http.StatusOK)

	var skillCount, templateCount int
	if err := store.Pool().QueryRow(ctx, `SELECT COUNT(*) FROM "PresentationSkill" WHERE id=$1`, skillID).Scan(&skillCount); err != nil {
		t.Fatal(err)
	}
	if err := store.Pool().QueryRow(ctx, `SELECT COUNT(*) FROM "Template" WHERE id=$1`, templateID).Scan(&templateCount); err != nil {
		t.Fatal(err)
	}
	if skillCount != 0 || templateCount != 0 {
		t.Fatalf("after delete: skillCount=%d templateCount=%d, want 0, 0", skillCount, templateCount)
	}
	var presentationTemplateID *string
	if err := store.Pool().QueryRow(ctx, `SELECT "templateId" FROM "Presentation" WHERE id=$1`, presentationID).Scan(&presentationTemplateID); err != nil {
		t.Fatal(err)
	}
	if presentationTemplateID != nil {
		t.Fatalf("presentation templateId after delete = %v, want nil (SET NULL)", *presentationTemplateID)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `JASLIDE_TEST_DATABASE_URL=<url> JASLIDE_TEST_REDIS_URL=<url> go test ./apps/core-api/internal/skills/... -run TestDeleteRemovesSkillAndCascadesToTemplateLeavingPresentationsIntact -v`
Expected: FAIL — `DELETE /skills/{id}` isn't routed yet, both calls get chi's default 404 body (the second call expects 200 and fails).

- [ ] **Step 3: Implement the `delete` handler and mount its route**

In `NewHandlers`, add after the new `router.Patch("/{id}", handler.update)` line:

```go
	router.Delete("/{id}", handler.delete)
```

Add the handler next to `update`:

```go
func (handler *handlers) delete(writer http.ResponseWriter, request *http.Request) {
	user, _ := auth.PrincipalFromContext(request.Context())
	id := chi.URLParam(request, "id")
	ctx := request.Context()

	tx, err := handler.db.Pool().Begin(ctx)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "Internal server error")
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var templateID *string
	if err := tx.QueryRow(ctx,
		`DELETE FROM "PresentationSkill" WHERE "id"=$1 AND "userId"=$2 RETURNING "templateId"`,
		id, user.ID,
	).Scan(&templateID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(writer, http.StatusNotFound, "Skill not found")
			return
		}
		writeError(writer, http.StatusInternalServerError, "Internal server error")
		return
	}
	if templateID != nil {
		if _, err := tx.Exec(ctx,
			`DELETE FROM "Template" WHERE "id"=$1 AND "userId"=$2`, *templateID, user.ID,
		); err != nil {
			writeError(writer, http.StatusInternalServerError, "Internal server error")
			return
		}
	}
	if err := tx.Commit(ctx); err != nil {
		writeError(writer, http.StatusInternalServerError, "Internal server error")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]bool{"success": true})
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `JASLIDE_TEST_DATABASE_URL=<url> JASLIDE_TEST_REDIS_URL=<url> go test ./apps/core-api/internal/skills/... -run TestDeleteRemovesSkillAndCascadesToTemplateLeavingPresentationsIntact -v`
Expected: PASS

- [ ] **Step 5: Run the full skills package test suite**

Run: `JASLIDE_TEST_DATABASE_URL=<url> JASLIDE_TEST_REDIS_URL=<url> go test ./apps/core-api/internal/skills/... -v`
Expected: PASS (all tests, including `hierarchy_guidance_test.go` and `pptx_object_edits_test.go` if present, plus both new tests)

- [ ] **Step 6: Commit**

```bash
git add apps/core-api/internal/skills/handlers.go apps/core-api/internal/skills/handlers_test.go
git commit -m "feat(skills): add DELETE /skills/{id} for single-item skill+template deletion"
```

---

### Task 3: Backend — `GET /skills/{id}/preview-html` (reuse `Template.config.htmlSlides[0]`)

**Files:**
- Modify: `apps/core-api/internal/skills/handlers.go`
- Modify: `apps/core-api/internal/skills/handlers_test.go`

**Interfaces:**
- Consumes: `configObject(raw json.RawMessage) map[string]any` (already defined in `handlers.go`).
- Produces route: `GET /skills/{id}/preview-html` → `200 {"html": "<...>"}` when the caller can see the skill (owner, same org, or public), `404` otherwise.

- [ ] **Step 1: Write the failing test**

Append to `apps/core-api/internal/skills/handlers_test.go`:

```go
func TestPreviewHTMLReturnsTheTemplatesFirstSlideOnlyWhenVisible(t *testing.T) {
	store, authService, sessions := newTestStore(t)
	ctx := context.Background()
	suffix := fmt.Sprint(time.Now().UnixNano())

	ownerID := createTestUser(t, ctx, store, "pv-owner-"+suffix, "pv-owner-"+suffix+"@example.com", nil)
	strangerID := createTestUser(t, ctx, store, "pv-stranger-"+suffix, "pv-stranger-"+suffix+"@example.com", nil)
	_, skillID := createTestSkillWithTemplate(t, ctx, store, "pv-tpl-"+suffix, "pv-skill-"+suffix, ownerID, nil)

	router := chi.NewRouter()
	router.Mount("/api/skills", NewHandlers(store, nil, "", authService))
	server := httptest.NewServer(router)
	defer server.Close()
	client := server.Client()

	ownerToken := issueTestToken(t, sessions, ownerID, "pv-owner-"+suffix+"@example.com")
	strangerToken := issueTestToken(t, sessions, strangerID, "pv-stranger-"+suffix+"@example.com")

	// A stranger cannot preview a private skill's template.
	requestJSON(t, client, strangerToken, http.MethodGet, server.URL+"/api/skills/"+skillID+"/preview-html", "", http.StatusNotFound)

	// The owner gets the first extracted slide.
	preview := requestJSON(t, client, ownerToken, http.MethodGet, server.URL+"/api/skills/"+skillID+"/preview-html", "", http.StatusOK)
	if preview["html"] != "<html><body>Hello</body></html>" {
		t.Fatalf("preview html = %#v", preview["html"])
	}

	// Once public, a stranger can preview it too.
	requestJSON(t, client, ownerToken, http.MethodPatch, server.URL+"/api/skills/"+skillID, `{"scope":"public"}`, http.StatusOK)
	strangerPreview := requestJSON(t, client, strangerToken, http.MethodGet, server.URL+"/api/skills/"+skillID+"/preview-html", "", http.StatusOK)
	if strangerPreview["html"] != "<html><body>Hello</body></html>" {
		t.Fatalf("stranger preview html after going public = %#v", strangerPreview["html"])
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `JASLIDE_TEST_DATABASE_URL=<url> JASLIDE_TEST_REDIS_URL=<url> go test ./apps/core-api/internal/skills/... -run TestPreviewHTMLReturnsTheTemplatesFirstSlideOnlyWhenVisible -v`
Expected: FAIL — route doesn't exist, first call already returns the wrong status/body.

- [ ] **Step 3: Implement the `previewHTML` handler and mount its route**

In `NewHandlers`, add after `router.Delete("/{id}", handler.delete)`:

```go
	router.Get("/{id}/preview-html", handler.previewHTML)
```

Add the handler next to `delete`:

```go
func (handler *handlers) previewHTML(writer http.ResponseWriter, request *http.Request) {
	user, _ := auth.PrincipalFromContext(request.Context())
	id := chi.URLParam(request, "id")
	var config json.RawMessage
	err := handler.db.Pool().QueryRow(request.Context(), `
		SELECT t."config" FROM "PresentationSkill" s
		JOIN "Template" t ON t."id"=s."templateId"
		WHERE s."id"=$1
			AND (s."isPublic" OR s."userId"=$2 OR ($3::text IS NOT NULL AND s."organizationId"=$3))`,
		id, user.ID, user.OrganizationID,
	).Scan(&config)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(writer, http.StatusNotFound, "Skill not found")
		return
	}
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "Internal server error")
		return
	}
	html := ""
	if slides, ok := configObject(config)["htmlSlides"].([]any); ok && len(slides) > 0 {
		html, _ = slides[0].(string)
	}
	writeJSON(writer, http.StatusOK, map[string]string{"html": html})
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `JASLIDE_TEST_DATABASE_URL=<url> JASLIDE_TEST_REDIS_URL=<url> go test ./apps/core-api/internal/skills/... -run TestPreviewHTMLReturnsTheTemplatesFirstSlideOnlyWhenVisible -v`
Expected: PASS

- [ ] **Step 5: Run the full skills package test suite**

Run: `JASLIDE_TEST_DATABASE_URL=<url> JASLIDE_TEST_REDIS_URL=<url> go test ./apps/core-api/internal/skills/... -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/core-api/internal/skills/handlers.go apps/core-api/internal/skills/handlers_test.go
git commit -m "feat(skills): add GET /skills/{id}/preview-html reusing the template's first extracted slide"
```

---

### Task 4: Frontend — API client + `Skill` type

**Files:**
- Modify: `apps/web/src/lib/api.ts:119-141` (`skillsApi`)
- Modify: `apps/web/src/components/skills/skills-gallery.tsx:9-18` (`Skill` type)
- Test: `apps/web/test/skills-management.test.js` (new file)

**Interfaces:**
- Produces: `skillsApi.update(id, data)`, `skillsApi.delete(id)`, `skillsApi.previewHtml(id)` — used by Task 5, 6, 7.
- Produces: `Skill` type gains `isPublic: boolean`, `organizationId: string | null`, `templateId: string | null` — used by Task 6 (`scopeOf`) and Task 7 (preview gating).

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/skills-management.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const webRoot = path.join(__dirname, '..');

test('the API client exposes update/delete/previewHtml for a single skill', () => {
    const api = fs.readFileSync(path.join(webRoot, 'src', 'lib', 'api.ts'), 'utf8');

    assert.match(api, /update:\s*\(id:\s*string,\s*data:\s*\{\s*name\?:\s*string;\s*scope\?:\s*'private'\s*\|\s*'organization'\s*\|\s*'public';?\s*\}\)\s*=>\s*\n?\s*api\.patch\(`\/skills\/\$\{id\}`/);
    assert.match(api, /delete:\s*\(id:\s*string\)\s*=>\s*api\.delete\(`\/skills\/\$\{id\}`\)/);
    assert.match(api, /previewHtml:\s*\(id:\s*string\)\s*=>\s*api\.get\(`\/skills\/\$\{id\}\/preview-html`\)/);
});

test('the Skill type carries visibility and template linkage fields', () => {
    const gallery = fs.readFileSync(path.join(webRoot, 'src', 'components', 'skills', 'skills-gallery.tsx'), 'utf8');

    assert.match(gallery, /isPublic:\s*boolean;/);
    assert.match(gallery, /organizationId:\s*string \| null;/);
    assert.match(gallery, /templateId:\s*string \| null;/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test ./apps/web/test/skills-management.test.js`
Expected: FAIL — neither pattern exists yet.

- [ ] **Step 3: Add the three client methods and extend the type**

In `apps/web/src/lib/api.ts`, replace the `skillsApi` object (lines 119-141) with:

```ts
// Presentation skills are data-only guidance; they never load executable packages.
export const skillsApi = {
    list: (category?: string) =>
        api.get('/skills', { params: { category } }),
    create: (data: {
        name: string;
        category: string;
        audience: string;
        tone: string;
        purpose: string;
        outlineGuidance: string;
        recommendedSlideCount: number;
        description?: string;
    }) => api.post('/skills', data),
    importPptx: async (file: File, name?: string) => {
        const formData = new FormData();
        formData.append('file', file);
        if (name) formData.append('name', name);
        return api.post('/skills/import-pptx', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
    },
    deleteMany: (ids: string[]) => api.delete('/skills', { data: { ids } }),
    update: (id: string, data: { name?: string; scope?: 'private' | 'organization' | 'public' }) =>
        api.patch(`/skills/${id}`, data),
    delete: (id: string) => api.delete(`/skills/${id}`),
    previewHtml: (id: string) => api.get(`/skills/${id}/preview-html`),
};
```

In `apps/web/src/components/skills/skills-gallery.tsx`, replace the `Skill` type (lines 9-18) with:

```ts
type Skill = {
    id: string;
    name: string;
    description?: string;
    category: string;
    audience: string;
    tone: string;
    purpose: string;
    recommendedSlideCount: number;
    isPublic: boolean;
    organizationId: string | null;
    templateId: string | null;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test ./apps/web/test/skills-management.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/components/skills/skills-gallery.tsx apps/web/test/skills-management.test.js
git commit -m "feat(web): add skillsApi.update/delete/previewHtml and extend the Skill type"
```

---

### Task 5: Frontend — rename + delete card menu

**Files:**
- Modify: `apps/web/src/components/skills/skills-gallery.tsx`
- Modify: `apps/web/test/skills-management.test.js`

**Interfaces:**
- Consumes: `skillsApi.update`, `skillsApi.delete` (Task 4).
- Produces: `openMenuId`, `renamingSkill`/`renameValue`, `deletingSkill` state and `submitRename`/`deleteSkill` handlers — Task 6 and 7 add more state/handlers alongside these but don't call them directly.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/test/skills-management.test.js`:

```js
test('each skill card has a menu with rename and delete, backed by modals', () => {
    const gallery = fs.readFileSync(path.join(webRoot, 'src', 'components', 'skills', 'skills-gallery.tsx'), 'utf8');

    assert.match(gallery, /openMenuId/);
    assert.match(gallery, /MoreVertical/);
    assert.match(gallery, /이름 변경/);
    assert.match(gallery, /skillsApi\.update\(renamingSkill\.id,\s*\{\s*name:\s*renameValue\.trim\(\)\s*\}\)/);
    assert.match(gallery, /skillsApi\.delete\(skill\.id\)/);
    assert.match(gallery, /setSkills\(\(current\) => current\.filter\(\(item\) => item\.id !== (deletingSkill\.id|skill\.id)\)\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test ./apps/web/test/skills-management.test.js`
Expected: FAIL — none of these symbols exist in `skills-gallery.tsx` yet.

- [ ] **Step 3: Add menu, rename modal, and delete confirm to `skills-gallery.tsx`**

Update the icon import (line 5) to add `MoreVertical`:

```ts
import { BookOpen, FileUp, LayoutTemplate, MoreVertical, PencilLine, Plus, Sparkles, Trash2, X } from 'lucide-react';
```

Add new state after the existing `const [selectedIds, setSelectedIds] = useState<string[]>([]);` (around line 27):

```ts
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [renamingSkill, setRenamingSkill] = useState<Skill | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [renaming, setRenaming] = useState(false);
    const [deletingSkill, setDeletingSkill] = useState<Skill | null>(null);
    const [deletingOne, setDeletingOne] = useState(false);
```

Add handlers after `deleteSelected` (after the existing function, around line 62):

```ts
    const submitRename = async () => {
        if (!renamingSkill || !renameValue.trim()) return;
        setRenaming(true);
        try {
            const response = await skillsApi.update(renamingSkill.id, { name: renameValue.trim() });
            setSkills((current) => current.map((item) => (item.id === renamingSkill.id ? response.data : item)));
            setRenamingSkill(null);
        } catch (error: any) {
            toast({ title: '이름 변경 실패', description: error.response?.data?.message || '다시 시도해주세요.', variant: 'destructive' });
        } finally {
            setRenaming(false);
        }
    };

    const deleteSkill = async (skill: Skill) => {
        setDeletingOne(true);
        try {
            await skillsApi.delete(skill.id);
            setSkills((current) => current.filter((item) => item.id !== skill.id));
            setDeletingSkill(null);
            toast({ title: 'Skill을 삭제했습니다' });
        } catch (error: any) {
            toast({ title: '삭제 실패', description: error.response?.data?.message || '다시 시도해주세요.', variant: 'destructive' });
        } finally {
            setDeletingOne(false);
        }
    };
```

In the card markup (the `<article>` block, currently lines 145-149), move the existing bulk-select checkbox label to the left and add the `⋯` menu on the right. Replace:

```tsx
                            {displayedSkills.map((skill) => <article key={skill.id} className="relative overflow-hidden rounded-2xl border border-border bg-card">
                                {!preview && <label className="absolute right-3 top-3 z-10 rounded bg-card/90 p-1.5"><input type="checkbox" checked={selectedIds.includes(skill.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, skill.id] : current.filter((id) => id !== skill.id))} aria-label={`${skill.name} 선택`} /></label>}
```

with:

```tsx
                            {displayedSkills.map((skill) => <article key={skill.id} className="relative overflow-hidden rounded-2xl border border-border bg-card">
                                {!preview && <label className="absolute left-3 top-3 z-10 rounded bg-card/90 p-1.5"><input type="checkbox" checked={selectedIds.includes(skill.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, skill.id] : current.filter((id) => id !== skill.id))} aria-label={`${skill.name} 선택`} /></label>}
                                {!preview && <div className="absolute right-3 top-3 z-10">
                                    <button type="button" onClick={() => setOpenMenuId(openMenuId === skill.id ? null : skill.id)} className="rounded bg-card/90 p-1.5 hover:bg-secondary" aria-label={`${skill.name} 메뉴`}><MoreVertical className="h-4 w-4" /></button>
                                    {openMenuId === skill.id && <div className="absolute right-0 top-full z-20 mt-1 w-32 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                                        <button type="button" onClick={() => { setRenamingSkill(skill); setRenameValue(skill.name); setOpenMenuId(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary"><PencilLine className="h-3.5 w-3.5" /> 이름 변경</button>
                                        <button type="button" onClick={() => { setDeletingSkill(skill); setOpenMenuId(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-destructive hover:bg-secondary"><Trash2 className="h-3.5 w-3.5" /> 삭제</button>
                                    </div>}
                                </div>}
```

Add a menu-closing backdrop right before the grid's closing `</div>` — i.e. just before the line `</div>` that follows the `{displayedSkills.map(...)}` block, insert:

```tsx
                            {openMenuId && <button type="button" className="fixed inset-0 z-10 cursor-default" aria-label="메뉴 닫기" onClick={() => setOpenMenuId(null)} />}
```

Add the rename and delete-confirm modals right after the existing `{showCreator && ...}` modal block (after line 155, before the final `</div>` that closes the component's root `<div>`):

```tsx
            {renamingSkill && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><div role="dialog" aria-modal="true" aria-label="Skill 이름 변경" className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl"><div className="mb-4 flex items-center justify-between"><h2 className="font-display text-lg font-bold">이름 변경</h2><button type="button" onClick={() => setRenamingSkill(null)} className="rounded-lg p-2 hover:bg-secondary" aria-label="닫기"><X className="h-5 w-5" /></button></div><input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-foreground" /><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setRenamingSkill(null)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium">취소</button><button type="button" disabled={renaming || !renameValue.trim()} onClick={submitRename} className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50">{renaming ? '저장 중' : '저장'}</button></div></div></div>}

            {deletingSkill && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><div role="dialog" aria-modal="true" aria-label="Skill 삭제 확인" className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl"><h2 className="mb-2 font-display text-lg font-bold">삭제 확인</h2><p className="text-sm text-muted-foreground">&quot;{deletingSkill.name}&quot;을(를) 삭제할까요? 이 Skill로 만든 발표자료는 남지만 템플릿 연결은 사라집니다.</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setDeletingSkill(null)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium">취소</button><button type="button" disabled={deletingOne} onClick={() => deleteSkill(deletingSkill)} className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50">{deletingOne ? '삭제 중' : '삭제'}</button></div></div></div>}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test ./apps/web/test/skills-management.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/skills/skills-gallery.tsx apps/web/test/skills-management.test.js
git commit -m "feat(web): add per-card rename and delete to the Skills gallery"
```

---

### Task 6: Frontend — 3-state visibility badge + visibility filter

**Files:**
- Modify: `apps/web/src/components/skills/skills-gallery.tsx`
- Modify: `apps/web/test/skills-management.test.js`

**Interfaces:**
- Consumes: `Skill.isPublic`/`Skill.organizationId` (Task 4), `skillsApi.update` (Task 4).
- Produces: module-level `scopeOf(skill)`, `nextScope(current, hasOrganization)` — Task 7 also reads `scopeOf` when it builds the filter dropdown's option list (no, Task 7 doesn't need it, only this task does — kept local to this task).

- [ ] **Step 1: Write the failing test**

Append to `apps/web/test/skills-management.test.js`:

```js
test('a visibility badge cycles scope and a filter narrows by scope', () => {
    const gallery = fs.readFileSync(path.join(webRoot, 'src', 'components', 'skills', 'skills-gallery.tsx'), 'utf8');

    assert.match(gallery, /const scopeOf = \(skill: Skill\)/);
    assert.match(gallery, /const nextScope = \(/);
    assert.match(gallery, /usersApi\.getProfile\(\)/);
    assert.match(gallery, /scopeFilter/);
    assert.match(gallery, /cycleScope/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test ./apps/web/test/skills-management.test.js`
Expected: FAIL — none of these symbols exist yet.

- [ ] **Step 3: Add scope helpers, current-user org lookup, badge, and filter**

Add `usersApi` to the import from `@/lib/api` (line 6):

```ts
import { skillsApi, usersApi } from '@/lib/api';
```

Above the `SkillsGallery` component definition (after the `Skill` type, before `export function SkillsGallery`), add module-level pure helpers:

```ts
type Scope = 'private' | 'organization' | 'public';

const scopeOf = (skill: Skill): Scope => (skill.isPublic ? 'public' : skill.organizationId ? 'organization' : 'private');

const nextScope = (current: Scope, hasOrganization: boolean): Scope => {
    if (current === 'private') return hasOrganization ? 'organization' : 'public';
    if (current === 'organization') return 'public';
    return 'private';
};

const scopeLabel: Record<Scope, string> = { private: '비공개', organization: '조직공개', public: '전체공개' };
const scopeBadgeClass: Record<Scope, string> = {
    private: 'bg-secondary text-muted-foreground',
    organization: 'bg-blue-100 text-blue-700',
    public: 'bg-green-100 text-green-700',
};
```

Add state (alongside the Task 5 state) and a fetch effect:

```ts
    const [userOrganizationId, setUserOrganizationId] = useState<string | null>(null);
    const [scopeFilter, setScopeFilter] = useState<'all' | Scope>('all');
```

```ts
    useEffect(() => {
        if (preview) return;
        usersApi.getProfile()
            .then((response) => setUserOrganizationId(response.data?.organizationId ?? null))
            .catch(() => setUserOrganizationId(null));
    }, [preview]);
```

Add the cycle handler alongside the Task 5 handlers:

```ts
    const cycleScope = async (skill: Skill) => {
        const scope = nextScope(scopeOf(skill), Boolean(userOrganizationId));
        try {
            const response = await skillsApi.update(skill.id, { scope });
            setSkills((current) => current.map((item) => (item.id === skill.id ? response.data : item)));
        } catch (error: any) {
            toast({ title: '공개 범위 변경 실패', description: error.response?.data?.message || '다시 시도해주세요.', variant: 'destructive' });
        }
    };
```

Update `displayedSkills` to also filter by scope (replace the existing `useMemo`):

```ts
    const displayedSkills = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return skills.filter((skill) => {
            if (scopeFilter !== 'all' && scopeOf(skill) !== scopeFilter) return false;
            if (!needle) return true;
            return `${skill.name} ${skill.description || ''} ${skill.category} ${skill.purpose}`.toLowerCase().includes(needle);
        });
    }, [skills, query, scopeFilter]);
```

Add the filter `<select>` next to the search input (in the `{!preview && <div className="mb-7 ...">}` row, right after the search `<input>`):

```tsx
                    <select value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value as 'all' | Scope)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
                        <option value="all">전체 범위</option>
                        <option value="private">비공개</option>
                        <option value="organization">조직공개</option>
                        <option value="public">전체공개</option>
                    </select>
```

Add the badge inside the card body, right after the category badge span (in `<div className="p-4">...<span className="rounded-full bg-secondary ...">{skill.category}</span>`):

```tsx
<button type="button" onClick={() => cycleScope(skill)} title="클릭해서 공개 범위 변경" className={`ml-2 rounded-full px-2 py-1 text-xs ${scopeBadgeClass[scopeOf(skill)]}`}>{scopeLabel[scopeOf(skill)]}</button>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test ./apps/web/test/skills-management.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/skills/skills-gallery.tsx apps/web/test/skills-management.test.js
git commit -m "feat(web): add a 3-state visibility badge and scope filter to the Skills gallery"
```

---

### Task 7: Frontend — preview modal (scaled iframe of `Template.config.htmlSlides[0]`)

**Files:**
- Modify: `apps/web/src/components/skills/skills-gallery.tsx`
- Modify: `apps/web/test/skills-management.test.js`

**Interfaces:**
- Consumes: `skillsApi.previewHtml` (Task 4), `Skill.templateId` (Task 4).
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/test/skills-management.test.js`:

```js
test('clicking a card with a linked template opens a scaled preview iframe', () => {
    const gallery = fs.readFileSync(path.join(webRoot, 'src', 'components', 'skills', 'skills-gallery.tsx'), 'utf8');

    assert.match(gallery, /skillsApi\.previewHtml\(skill\.id\)/);
    assert.match(gallery, /skill\.templateId && openPreview\(skill\)/);
    assert.match(gallery, /srcDoc={previewHtml/);
    assert.match(gallery, /sandbox=""/);
    assert.match(gallery, /ResizeObserver/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test ./apps/web/test/skills-management.test.js`
Expected: FAIL — none of these symbols exist yet.

- [ ] **Step 3: Add the preview modal**

Add constants above the component (next to the other module-level `scope*` helpers from Task 6):

```ts
const PREVIEW_SLIDE_WIDTH = 1920;
const PREVIEW_SLIDE_HEIGHT = 1080;
```

Add state (alongside the Task 5/6 state):

```ts
    const [previewSkill, setPreviewSkill] = useState<Skill | null>(null);
    const [previewHtml, setPreviewHtml] = useState('');
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewScale, setPreviewScale] = useState(0);
    const previewFrameRef = useRef<HTMLDivElement>(null);
```

Add the open handler and the scale-measuring effect (alongside the other handlers/effects):

```ts
    const openPreview = async (skill: Skill) => {
        setPreviewSkill(skill);
        setPreviewLoading(true);
        try {
            const response = await skillsApi.previewHtml(skill.id);
            setPreviewHtml(response.data?.html || '');
        } catch {
            setPreviewHtml('');
        } finally {
            setPreviewLoading(false);
        }
    };
```

```ts
    useEffect(() => {
        if (!previewSkill || !previewFrameRef.current) return;
        const element = previewFrameRef.current;
        const observer = new ResizeObserver(([entry]) => setPreviewScale(entry.contentRect.width / PREVIEW_SLIDE_WIDTH));
        observer.observe(element);
        return () => observer.disconnect();
    }, [previewSkill]);
```

Make the card thumbnail clickable when a template is linked (replace the thumbnail `<div>` in the card, currently `<div className="h-32 bg-[linear-gradient(...)] p-4">...</div>`):

```tsx
                                <div onClick={() => skill.templateId && openPreview(skill)} className={`h-32 bg-[linear-gradient(135deg,#1d1d1b_0%,#393731_50%,#d8c8aa_50%,#f7f1e5_100%)] p-4 ${skill.templateId ? 'cursor-pointer' : ''}`}><div className="flex h-full flex-col justify-between rounded-lg border border-white/30 bg-card/10 p-3 text-white backdrop-blur"><span className="text-[10px] uppercase tracking-[0.18em]">TaeSlide Skill</span><strong className="font-display text-xl leading-tight">{skill.purpose}</strong></div></div>
```

Add the preview modal after the delete-confirm modal added in Task 5 (before the component's closing `</div>`):

```tsx
            {previewSkill && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setPreviewSkill(null)}><div role="dialog" aria-modal="true" aria-label={`${previewSkill.name} 미리보기`} className="w-full max-w-3xl rounded-2xl bg-card p-6 shadow-xl" onClick={(event) => event.stopPropagation()}><div className="mb-4 flex items-center justify-between"><h2 className="font-display text-xl font-bold">{previewSkill.name} 미리보기</h2><button type="button" onClick={() => setPreviewSkill(null)} className="rounded-lg p-2 hover:bg-secondary" aria-label="닫기"><X className="h-5 w-5" /></button></div><div ref={previewFrameRef} className="relative w-full overflow-hidden rounded-lg border border-border bg-white" style={{ aspectRatio: `${PREVIEW_SLIDE_WIDTH} / ${PREVIEW_SLIDE_HEIGHT}` }}>{previewLoading ? <p className="p-6 text-sm text-muted-foreground">불러오는 중입니다.</p> : <iframe title="템플릿 미리보기" srcDoc={previewHtml} sandbox="" style={{ width: PREVIEW_SLIDE_WIDTH, height: PREVIEW_SLIDE_HEIGHT, transform: `scale(${previewScale})`, transformOrigin: 'top left', border: 'none', visibility: previewScale ? 'visible' : 'hidden' }} />}</div></div></div>}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test ./apps/web/test/skills-management.test.js`
Expected: PASS

- [ ] **Step 5: Run the full web test suite**

Run: `cd apps/web && npm test`
Expected: PASS (all existing `.test.js` files plus the new `skills-management.test.js`)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/skills/skills-gallery.tsx apps/web/test/skills-management.test.js
git commit -m "feat(web): add a scaled preview modal reusing the template's first extracted slide"
```

---

### Task 8: Manual end-to-end verification

**Files:** none (manual verification only, per the spec's testing plan)

- [ ] **Step 1: Run the full backend test suite**

Run: `JASLIDE_TEST_DATABASE_URL=<url> JASLIDE_TEST_REDIS_URL=<url> go test ./apps/core-api/...`
Expected: PASS

- [ ] **Step 2: Run the full web test suite**

Run: `cd apps/web && npm test`
Expected: PASS

- [ ] **Step 3: Manual verification against the local stack**

Using the local Docker Compose stack (`docker compose -p jaslide-try up`) and a real browser:
1. Import a PPTX on `/skills` as a test user.
2. Rename the resulting skill card via the `⋯` menu → confirm the name updates on the card.
3. Click the visibility badge twice (비공개 → 조직공개 or 전체공개 → next) → confirm the badge label and color change each time, and that the "조직공개" step is skipped entirely for a user with no organization.
4. Click the card thumbnail → confirm the preview modal shows the original PPTX's first slide, scaled to fit, without distortion.
5. Set the skill to 전체공개 → in a private/incognito window (or a second test account), open `/skills` and confirm the card is now visible there too.
6. Delete the skill via the `⋯` menu → confirm the confirmation dialog's wording, then confirm the card disappears and any presentation previously created from that template still opens without error (its `templateId` is now `NULL`, not the deleted template).

---

## Self-Review Notes

- **Spec coverage:** rename (Task 1+5), individual delete (Task 2+5), 3-state visibility with cascading Template update (Task 1+6), preview via reused `htmlSlides[0]` (Task 3+7), org-less users never see "조직공개" (Task 6's `nextScope`/`usersApi.getProfile()`), unified skill+template setting (Task 1's single transaction) — all covered.
- **Placeholder scan:** no TBD/TODO; every step has literal code or an exact shell command.
- **Type consistency:** `Scope` (`'private' | 'organization' | 'public'`) is the same union used in `skillsApi.update`'s `data.scope` (Task 4), `scopeOf`/`nextScope`/`scopeLabel`/`scopeBadgeClass` (Task 6), and the filter's `scopeFilter` state (Task 6) — no drift. Go's `scopeColumns` uses the matching three string literals server-side.
- **Deferred, per spec:** specific-user sharing (new join table) and image-thumbnail generation are explicitly out of scope for this plan, same as the design doc.
