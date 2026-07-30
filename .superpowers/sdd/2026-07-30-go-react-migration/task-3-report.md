# Task 3 Report: Go authentication and authorization

## Status

Implemented local registration and password login, JWT session cookies, `/me`,
logout, role middleware, and Keycloak authorization-code login for the Go API.

Initial commit: `905ab1e56f97a2e4645297af3dac984cf8751f90`
(`feat(go-api): add local and Keycloak authentication`).

## Changed files

- `apps/api/src/modules/auth/auth.contract.spec.ts`
  - Captures the existing NestJS register/login bodies, validation and conflict
    errors, logout behavior, cookie name/flags, and `/me` body at the HTTP
    boundary using the production global validation pipe.
- `apps/core-api/internal/auth/{password,session,keycloak,middleware}.go`
  - Reuses existing bcrypt hashes.
  - Issues and verifies the existing `jaslide_session` HS256 JWT.
  - Loads the current user from PostgreSQL for every authenticated request.
  - Preserves the Nest role hierarchy.
  - Implements OIDC discovery, PKCE S256, signed state/nonce transaction,
    authorization-code exchange, issuer/JWKS/audience/expiry/nonce and
    `email_verified` validation, and realm/client role extraction.
- `apps/core-api/internal/httpserver/auth_handlers.go`
  - Adds `/api/auth/register`, `/login`, `/logout`, `/me`, `/keycloak`, and
    `/keycloak/callback`.
  - Preserves the `jaslide_session` HttpOnly, SameSite=Lax, Path=/ session
    cookie; production cookies are Secure.
- `apps/core-api/internal/db/users.go`
  - Adds registration, login lockout/reset/audit persistence, and atomic
    Keycloak account lookup/link/create behavior against the existing Prisma
    tables.
  - A successful login clears failures only when the failure count read during
    password verification still matches and no concurrent lock is active.
  - Keycloak roles are synchronized on every login, including admin promotion
    and revocation for linked and existing-email users.
- `apps/core-api/internal/config/config.go`
  - Adds Nest-compatible `JWT_EXPIRES_IN` defaults plus Keycloak/frontend
    settings and requires a JWT secret of at least 32 bytes in production.
- `apps/core-api/cmd/api/main.go`
  - Wires authentication into the running Go server.

## Verification

- `go test -count=1 ./...` passed (fresh, all packages).
- `go vet ./...` passed.
- `go build ./cmd/api` passed.
- `pnpm --filter @jaslide/api test -- --runInBand auth.contract.spec.ts`
  passed (11/11).
- Prisma/PostgreSQL/Redis integration:
  `go test ./internal/db -run TestStoreReadsCurrentPrismaTables -count=1`
  passed against the running local containers, including conditional lockout,
  local registration, duplicate registration, and Keycloak role
  promotion/revocation.
- Live Go API smoke on port 4200 with the seeded local admin:
  login 200, `/me` 200, ADMIN role, HttpOnly `jaslide_session`, Path=/.

## Self-review

- Session verification restricts accepted JWTs to HS256 and requires expiry.
- Keycloak ID tokens are verified with the discovered issuer/JWKS and client
  audience. Direct tests reject wrong issuer, wrong audience, expiration,
  unsigned tokens, unverified email, and wrong nonce.
- Login lockout is updated atomically in SQL at five failed attempts, and a
  stale successful login cannot clear a concurrent lockout.
- Keycloak provider identity and mapped role are authoritative after linking; a
  linked identity cannot change to another email.
- No access or ID token is returned to the browser JSON response.

## Concerns and follow-up

- No live corporate Keycloak instance was available. The suite uses a real RSA
  key, OIDC discovery document, JWKS endpoint, signed ID token, token endpoint,
  and complete HTTP callback flow; corporate CA/network/realm configuration
  still needs deployment-environment validation.
- Chrome browser control blocked the temporary localhost:4200 tab with
  `ERR_BLOCKED_BY_CLIENT`. The same running Go process passed a live HTTP
  cookie-session login and `/me` smoke against PostgreSQL. This is an automation
  surface restriction, not a server failure.
- `go test -race ./...` was unavailable because this Windows Go environment has
  CGO disabled. Normal tests, vet, build, integration tests, and live smoke
  passed.
- The React client uses local registration and Keycloak, but has no call or
  link to `/api/auth/google` or `/api/auth/google/callback`. The Nest Google
  routes and optional strategy remain untouched. Before NestJS is deleted,
  external clients must be inventoried and Google OAuth either ported or
  explicitly deprecated; it is not silently removed by this task.
