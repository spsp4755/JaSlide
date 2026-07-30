# Task 7 Report: Offline Go + React Deployment

## Outcome

- Production Compose and Kubernetes now run `jaslide/core-api` from
  `docker/core-api.Dockerfile`, the Nginx-hosted Vite SPA, Python renderer,
  PostgreSQL, and Redis. No active manifest builds or starts NestJS/Next.js.
- Nginx serves React Router fallback routes and proxies exact or nested `/api`,
  `/uploads`, and `/socket.io` paths to the Go API.
- The uploads mount remains `/app/apps/api/uploads`; PostgreSQL, Redis, and
  uploads remain persistent volumes.
- Compose keeps the existing `api` and `renderer` service DNS names and all
  Keycloak/OpenAI environment names. Only the web port is published by default.
- Fresh PostgreSQL volumes apply the committed schema without a Node runtime;
  existing volumes skip initdb and remain unchanged.
- Offline Compose uses versioned imported images with `pull_policy: never`;
  Kubernetes uses `imagePullPolicy: Never`.

## Release Packaging

- Base images are version-and-digest pinned.
- `build-amd64-images.sh` builds all six images with `--platform linux/amd64`,
  verifies each loaded image platform, and disables provenance metadata.
- Docker archive entry order, timestamps, and ownership are normalized before
  `gzip -n`; the checksum file uses an archive basename so it remains portable.
- The archive generated from commit `67ea0b1` passed its portable checksum:
  `c52081fbb39c2b584f5aae52c3fee49199a467b7531674aec4ec2a96a18202c6`.

## Runtime Verification

- Built and loaded:
  - `jaslide/core-api:v0.6.1` — `linux/amd64`
  - `jaslide/migrate:v0.6.1` — `linux/amd64`
  - `jaslide/web:v0.6.1` — `linux/amd64`
  - `jaslide/renderer:v0.6.1` — `linux/amd64`
  - `jaslide/postgres:v0.6.1` — `linux/amd64`
  - `jaslide/redis:v0.6.1` — `linux/amd64`
- The normalized release archive passed `sha256sum -c` and `docker load`.
- Fresh offline Compose started with `--no-build --pull never`.
- `/login`, `/editor/deck-123`, and `/api/health/ready` returned 200.
- Exact `/api`, missing `/assets`, `/uploads`, and `/socket.io` requests
  returned 404 rather than leaking to the SPA fallback.
- PostgreSQL init created all 40 application tables.
- Registration followed by cookie-authenticated `/api/auth/me` succeeded.
- API and renderer container health checks passed and neither had a host port.
- The disposable smoke containers, data volumes, and network were removed after
  verification; existing JaSlide containers and volumes were not touched.

### P0-2 Fresh Database Acceptance

- A new isolated Compose project started from empty PostgreSQL, Redis, and
  uploads volumes with `--no-build --pull never`.
- The migration container exited successfully with `applied=6 adopted=0
  skipped=0`; PostgreSQL contained 41 public tables and six JaSlide migration
  ledger rows.
- `/login` and `/api/health/ready` returned 200. A new local user registration
  returned 201 and the user row was present in PostgreSQL.
- The isolated containers, network, and volumes were removed after the checks.

## Automated Verification

- `go test ./...` — passed.
- `pnpm --filter @jaslide/web test` — 99 Node tests and 35 Vitest tests passed.
- `pnpm --filter @jaslide/web build` — TypeScript and Vite production build
  passed.
- Renderer suite in the production image — 145 tests passed; pytest reported
  one existing Starlette/httpx deprecation warning.
- `bash scripts/release/smoke-compose.test.sh` — success and failure paths passed.
- Both Compose files rendered successfully; Kubernetes YAML parsed successfully.
- `git diff --check` — passed.

## Commit

`feat(deploy): ship Go API and static React application`
