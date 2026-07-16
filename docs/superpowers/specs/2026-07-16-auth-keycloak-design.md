# JaSlide: local login, Keycloak SSO, and administration

## Goal

Provide one login screen for two authentication methods in an air-gapped deployment:

- JaSlide-managed email/password accounts for testing and break-glass administration.
- Keycloak OpenID Connect (OIDC) SSO for company users.

Both methods resolve to a single JaSlide user record and use the existing JaSlide role model to authorize the API and `/admin`.

## Scope

This change covers login, logout, registration, Keycloak login, the account-linking rule, role mapping, administrator access, and deployment configuration. Presentation generation, tenancy redesign, MFA, password reset, and user provisioning screens are out of scope.

## Architecture

The existing Next.js web app remains the login UI and the NestJS API remains the only authentication authority. PostgreSQL remains the source of truth for JaSlide users and roles. Keycloak is an external identity provider only.

```text
Browser -> Next.js login screen -> NestJS API -> PostgreSQL
                              |                ^
                              +-> Keycloak ----+
```

The API issues the JaSlide session after either login method. It does not pass an access token through the callback URL and it does not keep the session token in browser local storage. The session is an `HttpOnly`, `Secure` (outside development), `SameSite=Lax` cookie scoped to the API.

## Login flows

### Local account

1. The user submits email and password to `POST /auth/login`.
2. The API keeps the existing bcrypt verification, lockout counter, audit log, and status checks.
3. On success, the API creates a JaSlide session cookie and returns safe user information.

### Keycloak account

1. The user selects **사내 SSO로 로그인** on `/login`.
2. The browser is redirected to `GET /auth/keycloak`, then to the configured Keycloak authorization endpoint.
3. The API stores short-lived `state`, `nonce`, and PKCE verifier data in a signed temporary cookie.
4. Keycloak returns to `GET /auth/keycloak/callback` with an authorization code.
5. The API exchanges the code, verifies the ID token signature against Keycloak JWKS, and validates issuer, audience, expiration, nonce, and state.
6. The API links or creates the local user, writes an audit record, creates a JaSlide session, and redirects to `/dashboard` or `/admin`.

## Account linking and roles

`Account` is the identity-link table. A Keycloak identity is stored as:

- `provider`: `keycloak`
- `providerAccountId`: `<issuer>|<subject>`

The provider identity lookup is authoritative. If it does not exist but a local user has the same verified email address, the identity is linked to that user. Otherwise a local user is created without a password. Local accounts retain their password and can use either login method after linking.

The existing `User.role` remains the effective authorization role. On the first SSO login, Keycloak realm/client roles are mapped by configuration to a JaSlide role; users without a mapped role receive `USER`. Existing users' roles are not overwritten at each login. An administrator changes JaSlide roles in the existing admin area.

`SYSTEM_ADMIN`, `ADMIN`, `ORG_ADMIN`, and `OPERATOR` retain access to `/admin`; API guards remain the enforcement point, not client-side routing.

## UI and administration

The current `/login` page is updated rather than replaced:

- Email/password form and registration link remain.
- The Google button is removed from the closed-network path and replaced with a Keycloak SSO button.
- Authentication errors are generic and Korean-language friendly.
- Authenticated administrators are routed to `/admin`; others go to `/dashboard`.

The existing admin user and role features are used for account status and role changes. No new administrator console is introduced.

## Deployment configuration

The deployment provides these server-side variables:

```dotenv
APP_URL=https://jaslide.company.internal
FRONTEND_URL=https://jaslide.company.internal
KEYCLOAK_ISSUER=https://keycloak.company.internal/realms/jaslide
KEYCLOAK_CLIENT_ID=jaslide-web
KEYCLOAK_CLIENT_SECRET=<server-only-secret>
KEYCLOAK_REDIRECT_URI=https://jaslide.company.internal/auth/keycloak/callback
KEYCLOAK_ADMIN_ROLES=jaslide-admin
```

The Keycloak client must be confidential, use the authorization-code flow, and register the exact callback URL. The container image must trust the internal Keycloak CA certificate. Production cookies require HTTPS; local development may set the secure-cookie flag off explicitly.

## Security and error handling

- OIDC ID tokens are signature-verified using Keycloak JWKS; decoding alone is not accepted.
- `state`, `nonce`, and PKCE are mandatory and single-use.
- Client secrets, provider refresh tokens, and raw ID tokens are never returned to the browser or logged.
- Login attempts and SSO failures are audit logged without credentials or tokens.
- Disabled, suspended, and locked JaSlide accounts are rejected for both login methods.
- Keycloak discovery/JWKS failures return a safe login error and do not fall back to local login automatically.

## Verification

Automated tests cover successful and failed local login, local-account lockout, Keycloak callback state/nonce/signature rejection, first SSO user creation, same-email account linking, mapped administrator routing, and rejection of suspended users. A deployment smoke check verifies the configured Keycloak discovery endpoint and callback URL.

## Delivery order

1. Implement secure Keycloak callback and JaSlide cookie session handling.
2. Update the login UI and API client authentication handling.
3. Connect the existing role guards and admin routing to the resolved user.
4. Add tests and a Docker/Keycloak configuration example.
