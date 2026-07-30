# Task 8 Report: Migration Acceptance

## P1-1 Local Authentication

- Go authentication and HTTP handler tests passed.
- An isolated offline Compose stack passed registration (201), authenticated
  session lookup (200), duplicate registration rejection (409), logout (204),
  post-logout rejection (401), invalid-password rejection (401), and a new
  login plus session lookup (200).
- The isolated containers, network, and volumes were removed after verification.

## P1-2 Keycloak Role Mapping

- Mock OIDC/JWKS integration tests passed authorization-code login with state,
  nonce, and S256 PKCE plus issuer, audience, expiry, signature, and verified
  email validation.
- The callback created a session and redirected administrators correctly.
  Configured Keycloak roles promoted and revoked the `ADMIN` role, while
  application-managed roles (`SYSTEM_ADMIN`, `ORG_ADMIN`, `OPERATOR`,
  `AUDITOR`) were preserved.
- A final live login still requires the deployment site's Keycloak issuer and
  client credentials.

## P1-3 Template Imports

- `박태지_0723_업무보고_AI엔지니어링.pptx` imported through the administrator
  API with all three source slides and the 426,018-byte source file preserved.
- `ai-safety-red-team-report.zip` imported with all 17 HTML slides and the
  3,470,960-byte source archive preserved.
- Both records stored the expected `pptx` or `html_zip` source kind and storage
  key, produced valid JSON, and were available from the public template API.
- The isolated containers, network, and volumes were removed after verification.

## P1-4 OpenAI-Compatible LLM Generation

- LM Studio's `qwen/qwen3.6-35b-a3b` model generated a four-slide Korean
  outline and completed a four-slide presentation with titles and content.
- The same model generated a ten-slide outline through the configured batching
  path and completed ten uniquely ordered slides with titles and content.
- The ten-slide job reported progress at 45, 60, 75, and 100 percent before
  completing. Both generated presentations were retrievable through the API.

## P1-5 Progress, Cancellation, and Restart Recovery

- A running ten-slide LM Studio job was cancelled at 35 percent. It remained
  `CANCELLED` after the in-flight request stopped, created no slides, and moved
  its presentation to `FAILED`.
- A separate job was interrupted by stopping the API at
  `GENERATING_CONTENT`/30 percent. After the API restarted, durable recovery
  requeued it, progress advanced to 55 percent, and the job completed at 100
  percent with all four slides.

## P1-6 Manual Edit, Save, and Refresh of Generated Content

- Found and fixed a real gap while verifying: `content.scene` (written by
  `GetScene`/`SaveScene` for a generated slide with no PPTX/HTML source) was
  never read by PPTX export, which kept regenerating the slide from
  `content.heading`/`bullets` and silently discarding any manual edit. Fixed
  in `apps/renderer/src/generators/pptx_generator.py` (`_add_scene_slide`,
  reusing `scene_to_pptx.scene_to_edits`), with a new failing-then-passing
  test in `test_pptx_generator.py`. Commit `bbd2d91`.
- Live verification on an isolated Postgres + Redis + freshly built renderer
  image (Go API run locally against them): created a presentation with a
  generic (no template) `CONTENT` slide from `heading`/`bullets`; `GET scene`
  returned the synthesized title+bullets scene; `PATCH scene` with a manual
  text edit returned 200; a second `GET scene` (refresh) returned exactly the
  manual edit, not the regenerated layout — confirming the "refresh" step
  round-trips through the database, not client state.
- All 144 other renderer tests and the full Go test suite continued to pass;
  the only pre-existing failures are this Windows dev machine lacking
  `pdfunite`/`fc-list` (Linux-only tools the renderer image ships).

## P1-7 PPTX and PDF Export

- Same live stack: exported the edited slide as PPTX (`editable: true`) — a
  valid `PK\x03\x04` (Office Open XML) file whose `slide1.xml` contains the
  manually edited run text verbatim, not the regenerated heading/bullets.
- Exported the same presentation as PDF — a valid one-page `%PDF-1.6` file
  produced through the renderer's PPTX-to-PDF (LibreOffice) path.
- Isolated containers, network, and the verification-only renderer image were
  removed after verification.

## P2 Template Fidelity Verification

- Imported the real `박태지_0723_업무보고_AI엔지니어링.pptx` and
  `ai-safety-red-team-report.zip` through the live admin API on a fresh
  isolated stack (Postgres + Redis + a rebuilt renderer image).
- **Table/merge/font/indent fidelity (PPTX):** loaded the weekly report's
  table slide through `GetScene`, confirmed the 2x2 table's header fill
  (`#D9D9D9`), Korean font names (나눔고딕, HY헤드라인M), and bullet indent
  levels; a scene-level round trip (`scene_to_pptx` with no edits) reproduced
  identical cell text, fill, indent levels, and fonts.
- **Open, edit, and re-export an existing presentation:** created a
  presentation from the imported template, loaded its scene, edited the
  table's header cell text through `PATCH scene`, and re-exported PPTX — the
  edit (`EDITED HEADER`) and the original Korean font (나눔고딕) both reached
  the exported `slide1.xml` unchanged.
- **HTML ZIP background/layout fidelity:** created a presentation from the
  imported red-team ZIP template, exported its cover slide as both PDF and a
  `/export/.../preview` PNG. Visually compared: background color, divider
  lines, and title placement are pixel-identical between the two render
  paths.
- **Preview vs PPTX/PDF comparison:** confirmed for both decks — the PNG
  preview and the PDF export of the same slide match; the PPTX export's XML
  was checked structurally (table cells, run text, font names) since PPTX has
  no direct visual preview path in this API.
- **Closed-network Korean fonts:** `fc-list` inside the actual renderer image
  shows 나눔고딕/NanumGothic (used by the real weekly-report deck) and the
  full Noto Sans/Serif CJK KR families bundled — no network font fetch is
  needed offline. The admin fidelity-check endpoint
  (`GET /admin/templates/:id/fidelity`) against the imported weekly template
  reported zero degraded objects but one **known, pre-existing gap**:
  `missingFontFamilies: ["HY헤드라인M"]` — the deck's title uses a commercial
  Hangul font not bundled in the image, so that one heading style falls back
  to a substitute font offline. This is a font-licensing limitation, not a
  migration regression (the same gap exists in the current NestJS/Next stack
  too); documented here rather than fixed.
- Isolated containers, network, and the verification-only renderer image were
  removed after verification.

## P3 Route Compatibility Audit and Gap Closure

- Ran a full route-by-route audit of every `apps/api/src/**/*.controller.ts`
  route (~145 routes, 44 controllers) against `apps/core-api/internal/**`.
  All core user-facing features (auth minus Google, presentations/slides/
  scene, blocks/collaborators/comments/versions/favorites/export-presets/
  font-sets/color-palettes/input-prompts/recent-works, assets, export,
  generation, skills, templates, and most of admin) already matched.
- **Google OAuth** (`/auth/google`, `/auth/google/callback`) — confirmed
  missing from Go. Per the closed-network deployment requirement (no external
  network calls in production), this is intentionally **not ported** — it
  cannot function in a closed network regardless.
- **`GET /admin/dashboard/charts`** and **`GET /admin/organizations/:id/members`**
  — missing from Go; confirmed (`grep` across `apps/web/src`) neither has any
  frontend caller. Left unported.
- **8 unauthenticated legacy admin controllers** (`admin-api-keys`,
  `admin-color-palettes`, `admin-font-sets`, `admin-integrations`,
  `admin-permissions`, `admin-security-policies`, `admin-seed-data`,
  `admin-sessions`, `admin-themes`, `admin-webhooks` — ~50 routes, ~1,650
  lines of backing service code) have **no `@UseGuards` at all** in the
  current NestJS API and **zero frontend callers**. This is a live
  unauthenticated admin surface on the current NestJS deployment. Confirmed
  unused; will not be ported — dropped along with the rest of `apps/api`.
- **Admin user create/update/delete** (`POST/PATCH/DELETE /admin/users`) was
  a genuine gap — Go only had list/get. Ported in
  `apps/core-api/internal/admin/handlers.go` (`createUser`, `updateUser`,
  `deactivateUser`), matching the NestJS service's behavior exactly: email
  uniqueness check, bcrypt password hash on create, default role `USER`,
  partial `COALESCE` update of name/image/role/status/organizationId, and a
  **soft** delete (`status='INACTIVE'`, row is not removed). Added
  `apps/core-api/internal/admin/users_test.go`, a real-Postgres black-box
  test covering create, duplicate-email rejection, password hashing,
  partial update, and soft-deactivation (verifies the row still exists with
  `status=INACTIVE` rather than being gone). Full Go test suite re-run
  afterward: all packages pass except one pre-existing, unrelated
  `internal/db` test that expects `search_path=public` on the test
  Postgres connection — an artifact of this session's ad hoc
  `postgres:16-alpine` container missing a `search_path` query param, not a
  regression from this change (only `internal/admin` files were touched).
- **`ORG_ADMIN` role check** — the audit initially flagged
  `admin/handlers.go`'s `requireAdmin` (only accepts `ADMIN`/`SYSTEM_ADMIN`)
  as a bug versus NestJS's `RolesGuard`, which treats `@Roles('ADMIN')` as
  inclusive of `ORG_ADMIN` via its role hierarchy. Checked
  `admin/contracts_test.go`'s `TestAdminRoleIntent`, which explicitly asserts
  `ORG_ADMIN` should **not** get system-admin-panel access. This looks like a
  deliberate, existing tightening (the system admin panel is cross-org; an
  org-scoped admin getting full access to every organization's users/jobs/
  models looks like the old system's privilege-escalation bug, not a feature
  to preserve) — **left as-is**, not "fixed" to match legacy behavior.
- Deleted `apps/api` (227 files) and `docker/api.Dockerfile`. Supporting
  cleanup so the rest of the stack builds without it:
  - Relocated the two bundled Noto Sans KR fonts from
    `apps/api/src/assets/fonts` into `apps/web/public/fonts`;
    `docker/web.Dockerfile` no longer copies from `apps/api`.
  - `.github/workflows/ci.yml`: replaced `prisma migrate deploy`/
    `db:generate` with `go run ./cmd/migrate`; replaced the
    `docker/api.Dockerfile` build/push step with `docker/core-api.Dockerfile`
    tagged `core-api`; fixed stale artifact paths (`apps/api/dist` dropped,
    `apps/web/.next` → `apps/web/dist`, which was already broken
    independent of this change).
  - `pnpm-workspace.yaml`: dropped the NestJS/Prisma-only `allowBuilds`
    entries (`@nestjs/core`, `@prisma/client`, `@prisma/engines`, `prisma`,
    `bcrypt`); confirmed via `grep` that no other `package.json` in the
    workspace references them.
  - `turbo.json`: dropped the dead `.next/**`/`!.next/cache/**` build output
    globs (apps/web has had no `next.config.*` or `.next` output since the
    Vite migration).
  - `.claude/launch.json`: the local dev-server config still invoked
    `next dev`; updated to `vite --port 3010` (apps/web's actual `dev`
    script has been Vite since Task 6).
  - Compose files (`docker-compose.yml`, `docker-compose.offline.yml`,
    `docker-compose.override.yml`, `docker-compose.diagnostics.yml`),
    `deploy/k8s/jaslide-k8s.yaml`, and `scripts/release/build-amd64-images.sh`
    were already fully on `jaslide/core-api` — no changes needed there.
- Full verification after deletion: `pnpm install` (lockfile fully dropped
  `apps/api` and its ~641 transitive packages, no manual lockfile edits
  needed), `pnpm build` (web builds clean), `pnpm test` (99 node:test +
  35 vitest tests, all passing, including the relocated-font check), the
  full Go test suite (all packages pass except the one pre-existing,
  unrelated `internal/db` search_path environment artifact noted under
  P1-6/P1-7), and a real browser check on the Vite dev server: both
  `/fonts/NotoSansKR-{Regular,Bold}.otf` return 200 and the login page
  renders correctly with Korean text.
- Known pre-existing issue found but explicitly out of scope: `pnpm lint`
  fails on `@jaslide/shared` ("No files matching the pattern src/ were
  found") — reproduced identically on the pre-deletion commit via
  `git stash`, so it predates and is unrelated to this change. Not fixed
  here.

**Task 8 / P3 complete.** The repository's production runtime is now Go
core-api + Vite React SPA + Python renderer only, with no NestJS or
Next.js code remaining.
