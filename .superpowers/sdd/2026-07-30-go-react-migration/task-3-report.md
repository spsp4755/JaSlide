# Task 3 Report: Go authentication and authorization

## Status

Implemented local password login, JWT session cookies, `/me`, logout, role
middleware, and Keycloak authorization-code login for the Go API.

Commit: `feat(go-api): add local and Keycloak authentication` (SHA is reported
by the task runner after commit).

## Changed files

- `apps/api/src/modules/auth/auth.contract.spec.ts`
  - Captures the existing NestJS login body, invalid-login error, logout
    behavior, cookie name/flags, and `/me` body at the HTTP boundary.
- `apps/core-api/internal/auth/{password,session,keycloak,middleware}.go`
  - Reuses existing bcrypt hashes.
  - Issues and verifies the existing `jaslide_session` HS256 JWT.
  - Loads the current user from PostgreSQL for every authenticated request.
  - Preserves the Nest role hierarchy.
  - Implements OIDC discovery, PKCE S256, signed state/nonce transaction,
    authorization-code exchange, issuer/JWKS/audience/expiry/nonce and
    `email_verified` validation, and realm/client role extraction.
- `apps/core-api/internal/httpserver/auth_handlers.go`
  - Adds `/api/auth/login`, `/logout`, `/me`, `/keycloak`, and
    `/keycloak/callback`.
  - Preserves the `jaslide_session` HttpOnly, SameSite=Lax, Path=/ session
    cookie; production cookies are Secure.
- `apps/core-api/internal/db/users.go`
  - Adds login lockout/reset/audit persistence and atomic Keycloak
    account lookup/link/create behavior against the existing Prisma tables.
- `apps/core-api/internal/config/config.go`
  - Adds Nest-compatible `JWT_EXPIRES_IN` defaults plus Keycloak/frontend
    settings.
- `apps/core-api/cmd/api/main.go`
  - Wires authentication into the running Go server.
- Go and Nest contract tests listed in the diff.

## Verification

- `go test ./...` — passed.
- `go vet ./...` — passed.
- `go build ./cmd/api` — passed.
- `pnpm exec jest --runInBand src/modules/auth/auth.contract.spec.ts`
  — 4/4 passed.
- Prisma/PostgreSQL/Redis integration:
  `go test ./internal/db -run TestStoreReadsCurrentPrismaTables -count=1`
  — passed against the running local containers.
- Live Go API smoke on port 4200 with the seeded local admin:
  login 200, `/me` 200, ADMIN role, HttpOnly `jaslide_session`, Path=/.

## Self-review

- Session verification restricts accepted JWTs to HS256 and requires expiry.
- Keycloak ID tokens are verified with the discovered issuer/JWKS and client
  audience; unsigned, wrong-nonce, unverified-email, expired, or mismatched
  tokens are rejected.
- Login lockout is updated atomically in SQL at five failed attempts.
- Keycloak provider identity is authoritative after linking; a linked identity
  cannot change to another email.
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
- Task 3's endpoint list does not include the legacy `/api/auth/register` or
  Google OAuth endpoints. They must be migrated or deliberately removed before
  NestJS is deleted; the current React client still calls `register`.
