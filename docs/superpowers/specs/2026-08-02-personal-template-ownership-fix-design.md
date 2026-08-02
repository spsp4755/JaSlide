# Personal Template Ownership Fix — Design Spec

Date: 2026-08-02

## Context

A user importing a PPTX as a Skill (`POST /skills/import-pptx`,
`apps/core-api/internal/skills/handlers.go:112-165`) on an account with no
organization (`User.organizationId IS NULL`) gets "Template not found"
when generating an outline against that template — even though the
template was just created by that same user, moments earlier.

**Root cause, confirmed by direct DB inspection this session:**
`VisibleTemplateConfig` (`apps/core-api/internal/generation/store.go:52-61`)
gates access with:

```sql
SELECT t."config" FROM "Template" t
WHERE t."id"=$1 AND (
    t."isPublic" OR
    t."organizationId"=(SELECT u."organizationId" FROM "User" u WHERE u."id"=$2)
)
```

When a user has no organization, both sides of the `organizationId`
comparison are `NULL`. In SQL, `NULL = NULL` evaluates to `NULL` (unknown),
never `TRUE` — so the `WHERE` clause never matches, and the template the
user just created becomes permanently invisible to its own creator. The
`Template` table has no owner column at all (only `organizationId` and
`isPublic`), so there is no other path by which the query could find it.

The same codebase already solves this correctly for the sibling
`PresentationSkill` table. `VisibleSkill`
(`apps/core-api/internal/generation/store.go:39-50`) uses:

```sql
WHERE "id"=$1 AND ("isPublic" OR "userId"=$2 OR ($3::text IS NOT NULL AND "organizationId"=$3))
```

`PresentationSkill` has a `userId` column
(`apps/core-api/migrations/20260717090000_add_presentation_skills/migration.sql`)
that lets a user's own private skill resolve regardless of organization
membership, and the `$3::text IS NOT NULL` guard prevents two different
organization-less users from ever matching each other's org-scoped rows.
`Template` has no equivalent column, which is the actual gap.

## Scope

1. Add a `userId` column to `Template` — same shape as
   `PresentationSkill.userId` (nullable `TEXT`, `FOREIGN KEY` to
   `User(id)`, `ON DELETE SET NULL ON UPDATE CASCADE`, indexed).
2. `createImported` (`apps/core-api/internal/skills/handlers.go:167-201`,
   the function that inserts both the `Template` and `PresentationSkill`
   rows when a PPTX import succeeds) sets the new `Template.userId` to the
   importing user's ID.
3. `VisibleTemplateConfig` gains the same `userId=$2` branch `VisibleSkill`
   already has, with the same `IS NOT NULL` guard on the organization
   comparison to prevent the reverse leak (two organization-less users
   seeing each other's private templates) that a naive
   `IS NOT DISTINCT FROM` fix would introduce.

**Explicitly out of scope:** backfilling the two pre-existing broken
`Template` rows already in the local dev database — confirmed with the
user; those rows stay as-is (`userId IS NULL`), and the affected PPTX
would need to be re-imported after this fix ships to get a usable
template. Any other visibility query in `apps/core-api/internal/templates`
(the admin template CRUD endpoints, the public template gallery) — those
were checked during investigation and don't share this bug: the public
gallery (`listPublic`) only ever shows `isPublic` templates regardless of
owner, and the admin endpoints operate in an authenticated-admin context
that wasn't reported as broken. This spec touches only the generation-time
visibility check that the reported bug actually hit.

## Architecture

Migration (`apps/core-api/migrations/`, new directory following the
existing `20260717090000_add_presentation_skills` naming convention):

```sql
ALTER TABLE "Template" ADD COLUMN "userId" TEXT;
CREATE INDEX "Template_userId_idx" ON "Template"("userId");
ALTER TABLE "Template" ADD CONSTRAINT "Template_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

`createImported` (`skills/handlers.go`) changes its `Template` `INSERT`
from:

```go
INSERT INTO "Template"
    ("id","name","category","config","isPublic","organizationId","updatedAt")
VALUES ($1,$2,'BUSINESS',$3,FALSE,$4,NOW())
```

to include `userId`:

```go
INSERT INTO "Template"
    ("id","name","category","config","isPublic","userId","organizationId","updatedAt")
VALUES ($1,$2,'BUSINESS',$3,FALSE,$4,$5,NOW())
```

with `user.ID` passed as the new `$4` (shifting the existing
`user.OrganizationID` argument to `$5`).

`VisibleTemplateConfig` (`generation/store.go`) changes from the query
shown in Context to:

```sql
SELECT t."config" FROM "Template" t
WHERE t."id"=$1 AND (
    t."isPublic" OR
    t."userId"=$2 OR
    (t."organizationId" IS NOT NULL AND t."organizationId"=(SELECT u."organizationId" FROM "User" u WHERE u."id"=$2))
)
```

No Go function signatures change — `VisibleTemplateConfig(ctx, id,
userID)` keeps its existing three-argument shape (unlike `VisibleSkill`,
which also takes `organizationID` as a caller-supplied argument, this
query still derives the caller's organization via a subquery on `userID`,
matching its current self-contained style and avoiding a signature change
that would ripple through every `service.template(...)` call site).

## Testing

- `apps/core-api/internal/generation` store/service tests (mirroring the
  existing fake-repository pattern in `handlers_test.go`, whose
  `memoryRepository.VisibleTemplateConfig` fake already encodes the *old*,
  buggy visibility rule and needs updating to match the new one): an
  organization-less user can retrieve their own private template; a
  same-organization user can retrieve a colleague's org-scoped template
  (existing behavior, unchanged); a second organization-less user (not the
  owner) cannot retrieve the first user's private template (regression
  guard for the leak a naive fix would introduce); a public template is
  retrievable by anyone regardless of ownership or organization.
- `apps/core-api/internal/skills` handler test: after a successful
  `import-pptx` call, the created `Template` row's `userId` matches the
  importing user's ID.
- Manual verification: run the new migration against the local Docker
  Postgres, re-run the exact repro from this session (log in as the
  organization-less test account, import a PPTX as a Skill, generate an
  outline) and confirm it no longer fails with "Template not found".
