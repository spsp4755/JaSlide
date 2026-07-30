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
