# Go API and React SPA Migration Design

## Goal

Replace the NestJS API and Next.js application with a Go API and a React SPA, while preserving every user-visible TaeSlide capability and offline deployment. The Python renderer remains an internal service because it owns the mature PPTX, HTML template, LibreOffice, and PDF fidelity pipeline.

## Scope and boundaries

- Replace `apps/api` (NestJS) with `apps/core-api` (Go).
- Replace `apps/web` (Next.js) with `apps/web` as a Vite React SPA, reusing its React components, Tailwind styles, Zustand stores, and React Query code whenever possible.
- Keep `apps/renderer` unchanged as a private HTTP service.
- Keep PostgreSQL, Redis, persisted uploads, and their existing data. The first Go release reads the existing Prisma-owned schema; it must not reset or recreate customer data.
- Keep local account login, JWT cookie sessions, Keycloak OIDC, roles, LLM OpenAI-compatible endpoints, generation jobs, templates, assets, export, admin, skills, and the editor API.
- Runtime must work without internet access. External packages are fetched only during image build in a connected build environment and included in release images.

## Architecture

```text
Browser
  -> React SPA (static files)
  -> /api Go core API
       -> PostgreSQL / Redis / uploads
       -> Python renderer (private network only)
       -> internal OpenAI-compatible LLM / Keycloak
```

The SPA uses same-origin `/api`, so local-cookie authentication needs no cross-origin browser configuration. The Go API owns HTTP auth, authorization, validation, database access, uploads, jobs, and renderer requests. The renderer is never exposed directly to browsers.

## Technology choices

- Go 1.23, `net/http` plus `chi` for routing, `pgx` for PostgreSQL, Redis client, and Go OIDC/JWT libraries for Keycloak/JWKS verification.
- React 19, Vite, React Router, existing React Query, Zustand, Tailwind, Radix, and canvas/editor packages.
- Existing PostgreSQL and Redis; existing Prisma migrations remain the migration source until Go API parity is proven. Schema migration ownership is a separate, later decision.
- Existing Python FastAPI renderer, python-pptx, Playwright, and LibreOffice.

## API contract and data compatibility

1. Freeze the public `/api` request/response contract before replacing handlers. Generate an OpenAPI document from the NestJS implementation and add fixtures for success and error responses.
2. The Go API must preserve route names, status codes, JSON fields, multipart upload fields, cookie names/attributes, and Socket.IO/event behavior where the React client relies on it.
3. Add contract tests that exercise both implementations against the same seeded PostgreSQL and Redis services. Go becomes the only production API only after those tests pass.
4. Preserve stored `SlideScene` JSON, template assets, PPTX/HTML ZIP files, and job records without conversion. New records keep the same shape unless a versioned schema change is explicitly introduced.

## Authentication and authorization

- Local login continues to use the existing password hashes and session cookie name.
- Keycloak keeps authorization-code flow, issuer validation, JWKS signature verification, callback state/nonce validation, and role mapping.
- The Go API uses secure, HTTP-only, same-site cookies in production; configuration validation fails startup if production secrets or public origin are unsafe.
- Route-level authorization remains enforced server-side for administration, templates, models, skills, and presentation ownership.

## Delivery sequence

### 1. Contract baseline

Inventory all NestJS routes and renderer calls; export OpenAPI plus representative fixtures. Create black-box tests for local login, Keycloak callback, presentation CRUD, scene save, template upload, generation, cancellation, PPTX export, and PDF export.

### 2. Go platform and authentication

Create the Go service with configuration validation, health probes, database/Redis connectivity, structured errors, local login, current-user lookup, logout, Keycloak login/callback, and authorization middleware. It uses the existing database and uploads volume.

### 3. Migrate API domains

Move domains in dependency order: assets/templates/skills, presentations/slides/scenes, generation/LLM/jobs, then exports and admin. Each domain gets API contract tests and renderer integration tests before the NestJS equivalent is removed.

### 4. Replace Next.js runtime

Convert the existing UI to Vite without rewriting the editor. Replace Next routing/layout/link/image and server rewrite behavior with React Router, static assets, and a same-origin reverse proxy. Reuse current React components and API client shapes.

### 5. Offline packaging and cutover

Build Go, React static files, and Python renderer into deterministic Linux/amd64 images; update Compose, Kubernetes, release scripts, manifests, and offline documentation. Remove NestJS and Next.js runtime images only after full end-to-end acceptance passes.

## Acceptance criteria

- A clean offline deployment starts Go API, React SPA, renderer, PostgreSQL, and Redis successfully.
- Local users and Keycloak users can log in, obtain correct roles, and use the same browser session behavior as v0.6.1.
- Existing presentations, templates, assets, and users appear unchanged after upgrade.
- The weekly-report PPTX and HTML ZIP fixtures import, generate, edit, export PPTX, and export PDF with existing visual-fidelity checks passing.
- A 10-slide internal LLM generation job completes, reports progress, supports cancellation, and remains editable in the React editor.
- The complete React application is served without a Node.js server at runtime.

## Explicit non-goals for this migration

- Reimplementing the renderer or LibreOffice/PPTX manipulation in Go.
- Resetting the database or requiring users to re-upload templates.
- Adding cloud-only dependencies or requiring Google APIs.
- A new visual editor redesign; this migration preserves and stabilizes the current editor first.
