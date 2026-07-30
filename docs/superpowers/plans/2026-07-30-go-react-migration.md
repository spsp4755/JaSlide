# Go API and React SPA Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the NestJS and Next.js runtime with a Go API and Vite React SPA without losing TaeSlide data, authentication, rendering fidelity, or offline deployment.

**Architecture:** `apps/core-api` becomes the sole browser API and retains the `/api` contract. `apps/web` becomes a static Vite SPA that reuses the existing React editor. `apps/renderer` stays a private Python service for PPTX/HTML/PDF work.

**Tech Stack:** Go 1.26, chi, pgx, Redis, OIDC/JWT; React 19, Vite, React Router, existing React Query/Zustand/Tailwind; PostgreSQL, Redis, Python renderer.

## Global Constraints

- Preserve existing PostgreSQL rows, uploaded files, SlideScene JSON, route paths, cookies, and external API contracts.
- Never expose the renderer directly to browsers.
- Use same-origin `/api` and static React assets; no Node.js runtime in production.
- Support local login and Keycloak authorization-code flow.
- Package every runtime dependency in offline Linux/amd64 release images.

---

### Task 1: Create the Go service and executable health contract

**Files:**
- Create: `apps/core-api/go.mod`
- Create: `apps/core-api/cmd/api/main.go`
- Create: `apps/core-api/internal/config/config.go`
- Create: `apps/core-api/internal/httpserver/server.go`
- Create: `apps/core-api/internal/httpserver/server_test.go`
- Create: `docker/core-api.Dockerfile`

**Interfaces:**
- Produces `GET /api/health/live` and `GET /api/health/ready`.
- Produces `config.Load() (Config, error)` validating database, Redis, JWT, renderer, and public-origin configuration.

- [ ] Write a failing test asserting `GET /api/health/live` returns `200 {"status":"ok"}` and `/api/health/ready` returns `503` when dependencies are unavailable.
- [ ] Implement an `http.Server` with chi routing and a dependency probe interface used only by readiness.
- [ ] Implement environment parsing and reject empty `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, or `RENDERER_URL` in production.
- [ ] Build `apps/core-api` with `go test ./...` and `go build ./cmd/api`.
- [ ] Build the Go runtime image with the same CA certificates and uploads path expected by the existing deployment.
- [ ] Commit as `feat(go-api): add service foundation and health probes`.

### Task 2: Establish data access without changing the existing schema

**Files:**
- Create: `apps/core-api/internal/db/db.go`
- Create: `apps/core-api/internal/db/users.go`
- Create: `apps/core-api/internal/db/presentations.go`
- Create: `apps/core-api/internal/db/db_test.go`
- Modify: `apps/core-api/internal/httpserver/server.go`

**Interfaces:**
- Consumes `config.Config.DatabaseURL` and `config.Config.RedisURL`.
- Produces `Store` methods `FindUserByEmail`, `FindUserByID`, `ListPresentations`, and `GetPresentation` using the current Prisma tables.

- [ ] Inspect `apps/api/prisma/schema.prisma` and write read-only SQL queries matching its exact table and column names.
- [ ] Write integration tests against PostgreSQL that insert through the existing Prisma schema and read through Go.
- [ ] Implement `pgxpool` startup, ping, close, and context timeouts; add its health probe to `/ready`.
- [ ] Implement Redis startup/ping/close and add it to `/ready`.
- [ ] Run Go tests and existing Prisma migration deployment against a disposable database.
- [ ] Commit as `feat(go-api): read existing application data`.

### Task 3: Move session authentication and authorization

**Files:**
- Create: `apps/core-api/internal/auth/password.go`
- Create: `apps/core-api/internal/auth/session.go`
- Create: `apps/core-api/internal/auth/keycloak.go`
- Create: `apps/core-api/internal/auth/middleware.go`
- Create: `apps/core-api/internal/httpserver/auth_handlers.go`
- Create: `apps/core-api/internal/httpserver/auth_handlers_test.go`

**Interfaces:**
- Produces `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/auth/keycloak`, and `/api/auth/keycloak/callback`.
- Produces `RequireUser` and `RequireRole` handlers attaching `auth.Principal` to request context.

- [ ] Capture current NestJS login JSON, cookie name, lifetime, flags, invalid-login status, and `/me` response in black-box tests.
- [ ] Write failing Go tests for valid local login, bad password, logout cookie clearing, expired token rejection, and admin role restriction.
- [ ] Verify existing bcrypt hashes with Go and issue the same HTTP-only session cookie using the configured production secure flag.
- [ ] Implement Keycloak authorization-code redirect, state/nonce cookie, token exchange, issuer/JWKS verification, and configured role extraction.
- [ ] Run the Go auth suite plus a browser-level local-login smoke test.
- [ ] Commit as `feat(go-api): add local and Keycloak authentication`.

### Task 4: Port presentation, slide, scene, and upload APIs

**Files:**
- Create: `apps/core-api/internal/presentations/service.go`
- Create: `apps/core-api/internal/presentations/handlers.go`
- Create: `apps/core-api/internal/assets/service.go`
- Create: `apps/core-api/internal/assets/handlers.go`
- Create: `apps/core-api/internal/presentations/handlers_test.go`

**Interfaces:**
- Produces the current `/api/presentations`, `/api/presentations/:id/slides`, `/api/assets`, and upload endpoints.
- Preserves existing scene JSON as opaque versioned data.

- [ ] Generate an endpoint inventory from the current presentation, slide, and asset controllers and commit it as test fixtures.
- [ ] Write contract tests for ownership checks, CRUD, slide ordering, scene save/load, multipart asset upload, and asset download.
- [ ] Implement Go handlers using the existing data tables and upload volume; reject unsafe filenames and paths.
- [ ] Verify an existing weekly-report presentation opens unchanged and a new manual scene edit survives reload.
- [ ] Commit as `feat(go-api): port presentations slides and assets`.

### Task 5: Port templates, skills, generation, exports, and administration

**Files:**
- Create: `apps/core-api/internal/templates/handlers.go`
- Create: `apps/core-api/internal/skills/handlers.go`
- Create: `apps/core-api/internal/generation/service.go`
- Create: `apps/core-api/internal/generation/handlers.go`
- Create: `apps/core-api/internal/export/handlers.go`
- Create: `apps/core-api/internal/admin/handlers.go`
- Create: `apps/core-api/internal/renderer/client.go`
- Create: `apps/core-api/internal/generation/handlers_test.go`

**Interfaces:**
- Consumes internal renderer HTTP endpoints and configured OpenAI-compatible LLM URL.
- Produces the existing template, skill, generation, cancellation, export, and admin `/api` routes.

- [ ] Write renderer-client tests for timeout, malformed renderer response, and successful PPTX/PDF export streams.
- [ ] Write generation tests for model configuration, 10-slide queued generation, progress event persistence, and cancellation.
- [ ] Implement template/skill CRUD and bulk deletion with the same ownership and admin checks as NestJS.
- [ ] Implement renderer proxy calls with server-side timeouts and never return internal renderer URLs to the browser.
- [ ] Verify PPTX and HTML ZIP import, presentation generation, PPTX export, PDF export, and admin model/template management with existing fixtures.
- [ ] Commit as `feat(go-api): port generation templates export and admin`.

### Task 6: Replace the Next.js runtime with Vite while reusing React UI

**Files:**
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/router.tsx`
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/components/providers.tsx`
- Modify: `apps/web/src/app/**/*.tsx` (move page content into route components)
- Create: `apps/web/test/router.test.tsx`

**Interfaces:**
- Produces a static React application with the current paths: login, home, dashboard, presentations, skills, settings, admin, create, and `/editor/:id`.
- Uses `/api` and cookies with `withCredentials` unchanged.

- [ ] Write route tests for direct navigation to `/login`, `/editor/:id`, and an admin page.
- [ ] Add Vite and React Router, replace Next scripts, and make the Vite development proxy target `http://localhost:4000`.
- [ ] Move global providers and convert each Next page/layout into a route component without changing the editor component tree.
- [ ] Replace `next/link`, `next/image`, `next/navigation`, and server-only imports with browser equivalents.
- [ ] Build the SPA and verify every path works after a hard refresh through the production static server.
- [ ] Commit as `feat(web): replace Next runtime with Vite React SPA`.

### Task 7: Package the React SPA and Go API for offline deployment

**Files:**
- Create: `docker/web.Dockerfile` (static server image)
- Create: `docker/nginx.conf`
- Modify: `docker-compose.yml`
- Modify: `deploy/k8s/jaslide-k8s.yaml`
- Modify: `scripts/release/build-amd64-images.sh`
- Modify: `docs/deployment.md`
- Modify: `docs/offline-deployment.md`

**Interfaces:**
- Browser `/api` requests route to Go API, all other routes return `index.html` for React Router.
- Go API, React static server, renderer, PostgreSQL, Redis, and uploads mount start with existing environment names.

- [ ] Write a compose smoke script that waits for Go readiness and fetches `/login` and `/api/health/ready`.
- [ ] Replace NestJS/Next image names and ports with Go API and static-web images in Compose and Kubernetes.
- [ ] Preserve uploads PVC mount path, renderer service name, Keycloak configuration names, and offline release tarball generation.
- [ ] Build Linux/amd64 images and run Compose without external network access after images are loaded.
- [ ] Commit as `feat(deploy): ship Go API and static React application`.

### Task 8: Execute full migration acceptance and remove retired runtimes

**Files:**
- Modify: `README.md`
- Modify: `docs/template-fidelity-verification.md`
- Delete: `apps/api/**`
- Delete: Next-specific files under `apps/web`
- Delete: `docker/api.Dockerfile`

**Interfaces:**
- Produces a repository where production runtime has no NestJS or Next.js service.

- [ ] Run Go unit/integration tests, React route/component tests, and renderer tests.
- [ ] Import the weekly-report PPTX and an HTML ZIP, create editable slides, and compare exported PPTX/PDF against the current fidelity baseline.
- [ ] Run a 10-slide OpenAI-compatible LLM generation, verify progress/cancel, and manually edit/save/export its result.
- [ ] Test local login and Keycloak login in a production-cookie configuration.
- [ ] Remove retired Node server code only after all acceptance checks pass; retain the shared TypeScript scene package until a Go contract replacement is proven.
- [ ] Commit as `chore: remove NestJS and Next.js runtimes`.
