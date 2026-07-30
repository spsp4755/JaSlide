# Task 6 Report: Vite React SPA

## Outcome

- Replaced the Next.js runtime with a Vite 8 React SPA.
- Preserved the existing screen and editor component tree.
- Added React Router routes for all public, authenticated, editor, and admin URLs.
- Kept cookie-based API calls on the same `/api` origin.
- Added Vite development proxies and production Nginx proxies for `/api`, `/uploads`, and `/socket.io`.
- Replaced the web runtime image with an Nginx static image that supports SPA hard refreshes.
- Bundled the existing Korean Noto Sans font files so the UI does not depend on an external font service.
- Updated Compose, Kubernetes, offline release scripts, and deployment documentation for Vite.

## Route Coverage

The route table includes:

- Public: `/`, `/login`, `/register`, `/demo`, `/demo/skills`
- Workspace: `/home`, `/dashboard`, `/presentations`, `/skills`, `/settings`, `/create`
- Editor: `/editor/:id`
- Admin: `/admin`, `/admin/users`, `/admin/organizations`, `/admin/roles`,
  `/admin/templates`, `/admin/models`, `/admin/prompts`, `/admin/assets`,
  `/admin/jobs`, `/admin/documents`, `/admin/policies`, `/admin/logs`,
  `/admin/operations`, `/admin/alerts`
- Unknown paths: application not-found screen

## Verification

- `pnpm --filter @jaslide/web test`
  - 99 existing web regression tests passed.
  - 28 Vite routing and deployment tests passed.
- `pnpm --filter @jaslide/web build`
  - TypeScript validation and Vite production build passed.
  - 2,555 modules transformed.
- `docker build -f docker/web.Dockerfile -t jaslide/web:vite-test .`
  - Static Nginx production image built successfully.
- Production-container hard-refresh check
  - 27 public, editor, admin, and unknown routes returned the SPA entry document.
- Browser QA
  - Login and registration screens rendered correctly.
  - Direct unauthenticated editor access redirected to login.
  - Registration hard refresh worked.
  - Browser console finished with no errors or warnings.
- `git diff --check`
  - No whitespace errors.
- Runtime scan
  - No Next.js imports, configuration, scripts, or environment variables remain in the web runtime and active deployment files.

## Integration Note

Authenticated API/editor data flow was not exercised against the in-progress Go API in this task.
Cookie handling, same-origin `/api` routing, and unauthenticated redirect behavior are covered; the combined Go API + Vite end-to-end test belongs to the integration phase.

## Review Follow-up

- Added a 100 MiB production Nginx request limit so the proxy does not reject the
  API's 20–64 MiB upload contracts at Nginx's 1 MiB default.
- Added `/uploads` to the Vite development proxy.
- Added an application boot request to `GET /auth/me`. Protected routes wait for
  this HttpOnly-cookie verification instead of trusting persisted browser state.
- Added centralized authenticated and admin route guards.
- A 401 during boot clears stale state and sends protected routes to `/login`;
  authenticated non-admin users are sent from admin routes to `/dashboard`.
- Replaced route-table-only assertions with rendered React Router tests covering
  direct login, editor parameter delivery, unauthenticated editor access,
  non-admin rejection, Keycloak-style fresh cookie hydration, and 401 recovery.
- Removed the ignored `apps/web/.next` output left by the retired runtime.

### Follow-up Verification

- 99 existing tests and 34 rendered Vite/router tests passed.
- TypeScript and the Vite production build passed with 2,557 transformed modules.
- The production Docker image accepted 2,097,152-byte POST bodies through both
  `/api` and `/uploads`; both reached the upstream and returned 200 rather than 413.
- All 27 hard-refresh paths still returned the SPA entry document.
- Browser QA opened `/editor/deck-123` against an upstream returning 401 and
  observed `/login`, the complete login form, and no browser console warnings or errors.
