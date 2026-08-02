# Personal Template Ownership Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix "Template not found" errors when an organization-less user generates an outline against a PPTX template they just imported themselves, by giving `Template` an owner column and using it in the visibility check — mirroring the pattern `PresentationSkill`/`VisibleSkill` already use correctly.

**Architecture:** One migration adds `Template.userId` (nullable, FK to `User`, indexed — same shape as `PresentationSkill.userId`). `createImported` (`apps/core-api/internal/skills/handlers.go`) sets it on insert. `VisibleTemplateConfig` (`apps/core-api/internal/generation/store.go`) gains a `userId=$2` OR-branch plus a `NOT NULL` guard on the organization comparison, so organization-less users can see their own templates without organization-less users seeing each other's.

**Tech Stack:** Go 1.24 + PostgreSQL (`apps/core-api`), tested via Docker (`golang:1.24.12-bookworm`) and the local Docker Postgres container (`jaslide-postgres-1`) for migration/manual verification — no local Go toolchain works.

## Global Constraints

- No backfill of existing `Template` rows with `userId IS NULL` — confirmed with the user; those rows keep `userId = NULL` and the underlying PPTX must be re-imported to get a usable template after this fix ships.
- No changes to `VisibleTemplateConfig`'s Go signature — it stays `VisibleTemplateConfig(ctx context.Context, id, userID string) (json.RawMessage, error)`. The organization is still derived via a subquery on `userID`, not passed in as a caller argument (unlike `VisibleSkill`, which does take `organizationID` as a parameter) — this avoids changing every `service.template(...)` call site.
- No changes to any other template-visibility query (`apps/core-api/internal/templates/handlers.go`'s admin/public endpoints) — out of scope per the spec, those were checked and don't share this bug.
- The organization comparison must guard on `NOT NULL`, not use `IS NOT DISTINCT FROM` — the latter would let two organization-less users see each other's private templates, a privacy regression the spec explicitly calls out.

---

### Task 1: Add `Template.userId`, wire it into import, fix the visibility query

**Files:**
- Create: `apps/core-api/migrations/20260802000000_add_template_owner/migration.sql`
- Modify: `apps/core-api/internal/skills/handlers.go:167-201` (`createImported`)
- Modify: `apps/core-api/internal/generation/store.go:52-61` (`VisibleTemplateConfig`)
- Modify: `apps/core-api/internal/generation/handlers_test.go` (the `memoryTemplate` fake struct and `VisibleTemplateConfig` fake method, plus new test cases)

**Interfaces:**
- Consumes: `db.Store` (`apps/core-api/internal/db`, unchanged), `auth.Principal` (`user.ID`, `user.OrganizationID`, already available in `createImported`'s existing `user auth.Principal` parameter).
- Produces: nothing consumed by a later task — this is the only task in the plan.

- [ ] **Step 1: Write the migration**

Create `apps/core-api/migrations/20260802000000_add_template_owner/migration.sql`:

```sql
ALTER TABLE "Template" ADD COLUMN "userId" TEXT;

CREATE INDEX "Template_userId_idx" ON "Template"("userId");

ALTER TABLE "Template" ADD CONSTRAINT "Template_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

This follows the exact convention of the existing
`apps/core-api/migrations/20260717090000_add_presentation_skills/migration.sql`
(the migration that added `PresentationSkill.userId` the same way).

- [ ] **Step 2: Apply the migration to the local Docker Postgres and verify the column exists**

Run (from repo root — the `migrate` service in `docker-compose.yml` runs all pending migrations against the running `postgres` container):

```bash
docker compose up -d migrate
docker exec jaslide-postgres-1 psql -U jaslide -d jaslide -c "\d \"Template\""
```

Expected: the `\d` output now lists a `userId` column (nullable `text`) and a `Template_userId_fkey` foreign-key constraint, alongside the existing columns.

- [ ] **Step 3: Update `createImported`'s `Template` INSERT**

In `apps/core-api/internal/skills/handlers.go`, find this block inside `createImported` (currently around lines 175-183):

```go
	if _, err := tx.Exec(ctx, `
		INSERT INTO "Template"
			("id","name","category","config","isPublic","organizationId","updatedAt")
		VALUES ($1,$2,'BUSINESS',$3,FALSE,$4,NOW())`,
		templateID, name, config, user.OrganizationID,
	); err != nil {
		return nil, err
	}
```

Change it to:

```go
	if _, err := tx.Exec(ctx, `
		INSERT INTO "Template"
			("id","name","category","config","isPublic","userId","organizationId","updatedAt")
		VALUES ($1,$2,'BUSINESS',$3,FALSE,$4,$5,NOW())`,
		templateID, name, config, user.ID, user.OrganizationID,
	); err != nil {
		return nil, err
	}
```

(`user` here is the existing `auth.Principal` parameter `createImported` already receives — `user.ID` is a plain `string`, always populated for an authenticated request.)

- [ ] **Step 4: Update `VisibleTemplateConfig`'s query**

In `apps/core-api/internal/generation/store.go`, find (currently lines 52-61):

```go
func (store *SQLStore) VisibleTemplateConfig(ctx context.Context, id, userID string) (json.RawMessage, error) {
	var raw json.RawMessage
	err := store.db.Pool().QueryRow(ctx, `
		SELECT t."config" FROM "Template" t
		WHERE t."id"=$1 AND (
			t."isPublic" OR
			t."organizationId"=(SELECT u."organizationId" FROM "User" u WHERE u."id"=$2)
		)`, id, userID).Scan(&raw)
	return raw, err
}
```

Change the query to:

```go
func (store *SQLStore) VisibleTemplateConfig(ctx context.Context, id, userID string) (json.RawMessage, error) {
	var raw json.RawMessage
	err := store.db.Pool().QueryRow(ctx, `
		SELECT t."config" FROM "Template" t
		WHERE t."id"=$1 AND (
			t."isPublic" OR
			t."userId"=$2 OR
			(t."organizationId" IS NOT NULL AND t."organizationId"=(SELECT u."organizationId" FROM "User" u WHERE u."id"=$2))
		)`, id, userID).Scan(&raw)
	return raw, err
}
```

- [ ] **Step 5: Write the failing tests**

In `apps/core-api/internal/generation/handlers_test.go`, first update the `memoryTemplate` fake struct (currently lines 25-28) to add a `userID` field:

```go
type memoryTemplate struct {
	config         json.RawMessage
	public         bool
	userID         string
	organizationID *string
}
```

Then update the `VisibleTemplateConfig` fake method (currently around lines 52-62) to match the new SQL semantics exactly:

```go
func (repo *memoryRepository) VisibleTemplateConfig(_ context.Context, id, userID string) (json.RawMessage, error) {
	template, ok := repo.templates[id]
	if !ok {
		return nil, errors.New("not found")
	}
	if template.public || template.userID == userID {
		return template.config, nil
	}
	user := repo.users[userID]
	if template.organizationID != nil && user.OrganizationID != nil && *template.organizationID == *user.OrganizationID {
		return template.config, nil
	}
	return nil, errors.New("not found")
}
```

Now add four new test cases. Place them directly after the existing
`TestStartAndOutlineRejectPrivateTemplateOutsideOrganization` test (which
your Step 4 edit does not change — it still passes with the new fake,
since it never sets `userID` on its template, and `otherOrg != userOrg`
still fails all three branches):

```go
func TestGenerateOutlineAllowsOrganizationlessUserToSeeTheirOwnPrivateTemplate(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	repo.templates["own-template"] = memoryTemplate{
		config: json.RawMessage(`{}`), userID: "user-1",
	}
	templateID := "own-template"
	service := NewService(repo, new(maliciousHTMLLLM), new(recordingQueue))

	if _, err := service.GenerateOutline(context.Background(), Principal{ID: "user-1"}, OutlineInput{
		Content: "AI security", SlideCount: pointerTo(1), TemplateID: &templateID,
	}); err != nil {
		t.Fatalf("GenerateOutline() error = %v, want nil", err)
	}
}

func TestGenerateOutlineAllowsSameOrganizationColleagueToSeeASharedTemplate(t *testing.T) {
	repo := newMemoryRepository()
	sharedOrg := "org-1"
	repo.users["colleague"] = db.User{ID: "colleague", OrganizationID: &sharedOrg}
	repo.templates["team-template"] = memoryTemplate{
		config: json.RawMessage(`{}`), userID: "owner", organizationID: &sharedOrg,
	}
	templateID := "team-template"
	service := NewService(repo, new(maliciousHTMLLLM), new(recordingQueue))

	if _, err := service.GenerateOutline(context.Background(), Principal{ID: "colleague", OrganizationID: &sharedOrg}, OutlineInput{
		Content: "AI security", SlideCount: pointerTo(1), TemplateID: &templateID,
	}); err != nil {
		t.Fatalf("GenerateOutline() error = %v, want nil", err)
	}
}

func TestGenerateOutlineRejectsAnotherOrganizationlessUsersPrivateTemplate(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["stranger"] = db.User{ID: "stranger"}
	repo.templates["someone-elses-template"] = memoryTemplate{
		config: json.RawMessage(`{}`), userID: "owner",
	}
	templateID := "someone-elses-template"
	service := NewService(repo, new(maliciousHTMLLLM), new(recordingQueue))

	if _, err := service.GenerateOutline(context.Background(), Principal{ID: "stranger"}, OutlineInput{
		Content: "AI security", SlideCount: pointerTo(1), TemplateID: &templateID,
	}); !errors.Is(err, ErrBadInput) {
		t.Fatalf("GenerateOutline() error = %v, want ErrBadInput", err)
	}
}

func TestGenerateOutlineAllowsAnyoneToSeeAPublicTemplate(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["anyone"] = db.User{ID: "anyone"}
	repo.templates["public-template"] = memoryTemplate{
		config: json.RawMessage(`{}`), userID: "owner", public: true,
	}
	templateID := "public-template"
	service := NewService(repo, new(maliciousHTMLLLM), new(recordingQueue))

	if _, err := service.GenerateOutline(context.Background(), Principal{ID: "anyone"}, OutlineInput{
		Content: "AI security", SlideCount: pointerTo(1), TemplateID: &templateID,
	}); err != nil {
		t.Fatalf("GenerateOutline() error = %v, want nil", err)
	}
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run (from repo root):
```bash
docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm \
  go test ./internal/generation/... -run TestGenerateOutline -v
```
Expected: PASS for all 4 new tests, plus the pre-existing
`TestStartAndOutlineRejectPrivateTemplateOutsideOrganization` (verifying
the fake-method rewrite didn't change its outcome).

Then run the full package to confirm nothing else broke:
```bash
docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm \
  go test ./internal/generation/... -v
docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm \
  go build ./...
```
Expected: all PASS, build clean (the `skills` package has no existing
tests to run — `createImported`'s SQL change is verified manually in Step
7, not by a Go unit test, since `handlers.db` is a concrete `*db.Store`
with no fake/interface seam to test against, matching this package's
existing all-manual verification style).

- [ ] **Step 7: Manually verify the original repro is fixed**

The Docker stack should already be running (`docker compose up -d`, with
`api` also published on host port 4000 via `docker-compose.override.yml`
from earlier this session). Rebuild and restart the `api` container to
pick up the Go changes:

```bash
docker compose up -d --build api
```

Then, in the browser at `http://localhost:3010` (Vite dev server), log in
with `test@koreacb.com` / `test1234`, go to 홈 대시보드, attach a `.pptx`
file, leave it on the default "Skill" mode, and generate. Confirm the
outline now generates successfully instead of failing with "Template not
found".

Also confirm directly via the database that the new template's `userId`
was actually set:

```bash
docker exec jaslide-postgres-1 psql -U jaslide -d jaslide -c \
  "SELECT id, name, \"userId\", \"organizationId\" FROM \"Template\" ORDER BY \"updatedAt\" DESC LIMIT 1;"
```

Expected: the most recent row's `userId` column matches the logged-in test
user's ID (`PmazN36Os4LGKYuBr0dZsWlg`), not empty/null.

- [ ] **Step 8: Commit**

```bash
git add apps/core-api/migrations/20260802000000_add_template_owner apps/core-api/internal/skills/handlers.go apps/core-api/internal/generation/store.go apps/core-api/internal/generation/handlers_test.go
git commit -m "fix(go-api): let organization-less users use their own imported templates"
git push origin feature/personal-template-ownership-fix
```
