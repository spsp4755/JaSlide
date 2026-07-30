# Task 5 route-parity report

## Implemented

- Added authenticated Go routes for blocks, collaborators, favorites, export presets, input prompts, recent works, organization color palettes, and organization font sets.
- Mounted the React client's legacy `POST /api/slides/:slideId/duplicate` alias.
- Completed user profile parity with `GET /api/users/me/presentations` and an admin/self-protected `GET /api/users/:id`.
- Completed `GET /api/health` and `GET /api/health/metrics` while retaining liveness and readiness probes.
- Confirmed the existing Go version endpoints include both `GET /api/versions/:id` and `GET /api/versions/:id1/compare/:id2`.
- Preserved database ownership boundaries and additionally reject block/favorite reorder requests containing IDs outside the authenticated user's slide or collection.

## Route inventory

- Blocks: 7 routes.
- Collaborators: 4 routes.
- Favorites: 5 routes.
- Export presets: 6 routes.
- Input prompts: 6 routes.
- Recent works: 4 routes.
- Color palettes: 5 routes.
- Font sets: 5 routes.
- User profile additions: 2 routes.
- Global slide duplicate alias: 1 route.
- Health additions: 2 routes.

Google OAuth was not ported because the approved migration design retains local login and Keycloak only. `/api/analytics` was not a NestJS controller route and remains the client's best-effort local analytics flush.

## Verification

- Route inventory and unauthenticated rejection tests pass for all 42 user-feature routes.
- PostgreSQL/Redis integration test passes against the existing Prisma schema:
  - block create and cross-user edit/read rejection;
  - collaborator invite, role update, member listing, and owner-only role control;
  - favorite ownership isolation;
  - single-default export preset behavior;
  - input-prompt history;
  - collaborator recent-work access;
  - organization palette/font creation and cross-organization rejection.
- `go test ./...` with integration database and Redis: passed.
- `go vet ./...`: passed.
- `go build ./cmd/api`: passed.
- `git diff --check`: passed.
