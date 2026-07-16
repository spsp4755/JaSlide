# JaSlide Authentication and Keycloak Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support JaSlide local accounts and Keycloak SSO with secure cookie sessions and existing administrator roles.

**Architecture:** NestJS verifies local credentials or Keycloak OIDC code-flow responses, then issues the same JaSlide JWT in a secure HttpOnly cookie. Next.js sends cookie credentials and renders a single login page. PostgreSQL `User` and `Account` records remain the account and authorization source of truth.

**Tech Stack:** Next.js 14, React 18, NestJS 10, Prisma 5, Jest, Keycloak OIDC, `jose`.

## Global Constraints

- Support air-gapped Keycloak via `KEYCLOAK_*` environment variables only.
- Do not expose any token, client secret, or authorization code to browser JavaScript or URLs after callback.
- Keep the existing local email/password login and JaSlide DB roles.
- Use a single `USER` fallback role and only map configured Keycloak roles on first SSO login.

---

### Task 1: Set up a secure common session

**Files:**
- Modify: `apps/api/src/modules/auth/auth.controller.ts`
- Modify: `apps/api/src/modules/auth/strategies/jwt.strategy.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/stores/auth-store.ts`
- Test: `apps/api/src/modules/auth/auth.controller.spec.ts`

**Interfaces:**
- Produces `setSession(response, accessToken)` and `POST /auth/logout`.
- The JWT strategy accepts either a Bearer header or the `jaslide_session` cookie.

- [ ] Write controller tests that assert a successful local login sets an HttpOnly `jaslide_session` cookie and logout clears it.
- [ ] Run `pnpm --filter @jaslide/api test -- auth.controller.spec.ts` and observe the missing-cookie behavior fail.
- [ ] Add `setSession`/`clearSession` helpers, set `httpOnly`, `sameSite: 'lax'`, `secure: NODE_ENV === 'production'`, and `path: '/'`; add a logout route.
- [ ] Add a cookie extractor before the existing Bearer extractor, use Axios `withCredentials: true`, and remove token persistence from the auth store.
- [ ] Re-run the focused API tests and then `pnpm --filter @jaslide/api test`.

### Task 2: Add Keycloak authorization-code login

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/modules/auth/services/oidc.service.ts`
- Modify: `apps/api/src/modules/auth/auth.controller.ts`
- Modify: `apps/api/src/modules/auth/auth.module.ts`
- Test: `apps/api/src/modules/auth/services/oidc.service.spec.ts`

**Interfaces:**
- Produces `OidcService.createAuthorizationRequest()` and `OidcService.completeAuthorizationCode(code, verifier, nonce)`.
- Produces `GET /auth/keycloak` and `GET /auth/keycloak/callback`.

- [ ] Write tests for authorization URL state/nonce/PKCE creation, a rejected invalid state, and a rejected unsigned/invalid token.
- [ ] Run the focused test and observe it fail because the secure Keycloak methods do not exist.
- [ ] Add the minimal `jose` dependency and implement discovery/JWKS signature validation with `jwtVerify`; validate issuer, audience, expiration, state, nonce, and PKCE.
- [ ] Add the redirect and callback controller routes; keep temporary values only in a signed, short-lived HttpOnly cookie and redirect success to `/dashboard` or `/admin`.
- [ ] Re-run the focused tests and `pnpm --filter @jaslide/api test`.

### Task 3: Link Keycloak identities and map first-login roles

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts`
- Modify: `apps/api/src/modules/auth/auth.service.spec.ts`
- Modify: `apps/api/src/modules/auth/dto/auth.dto.ts` if an internal profile type is needed

**Interfaces:**
- Produces `AuthService.loginWithKeycloak({ issuer, subject, email, name, image, roles })`.
- Returns the existing `AuthResponse` shape.

- [ ] Write failing tests for identity lookup by `keycloak` and `<issuer>|<subject>`, verified-email linking, new-user creation, configured administrator role mapping, and suspended-user rejection.
- [ ] Run `pnpm --filter @jaslide/api test -- auth.service.spec.ts` and observe the missing behavior fail.
- [ ] Implement the smallest identity-linking path using the existing `Account` table and `User.role`; never overwrite an existing JaSlide role during a later SSO login.
- [ ] Re-run the focused tests and the complete API suite.

### Task 4: Update the login UI and client-side routing

**Files:**
- Modify: `apps/web/src/app/login/page.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/stores/auth-store.ts`
- Test: `apps/web/src/app/login/page.test.tsx` if the existing project test setup supports React tests; otherwise browser smoke-test the two flows.

**Interfaces:**
- The login page keeps the local form and exposes a Keycloak button pointing at `${NEXT_PUBLIC_API_URL}/auth/keycloak`.
- `authApi.me()` resolves the session after a callback.

- [ ] Add a failing UI test/smoke assertion for the local form and Keycloak SSO button.
- [ ] Implement the single-page login UI, remove Google-only UI, and preserve admin redirect through `isAdminRole`.
- [ ] Ensure Axios uses cookie credentials and only redirects on 401 after the login page is excluded.
- [ ] Run the web lint/build command and manual callback-flow smoke check.

### Task 5: Document deployment and verify

**Files:**
- Modify: `.env.example`
- Modify: `apps/api/.env.example`
- Modify: `README.md`
- Test: API test suite and production build

**Interfaces:**
- Documents the Keycloak issuer, client, callback, role mapping, HTTPS, and internal-CA requirements.

- [ ] Add an env example with no real secret values and Keycloak client prerequisites.
- [ ] Run `pnpm --filter @jaslide/api test`, `pnpm --filter @jaslide/api build`, and `pnpm --filter @jaslide/web build`.
- [ ] Review the diff for token exposure, callback URL token parameters, and accidental Keycloak secrets.
- [ ] Commit the implementation with a focused authentication message.
