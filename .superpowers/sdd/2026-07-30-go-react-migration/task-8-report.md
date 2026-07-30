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

## P1-3 Template Imports

- `박태지_0723_업무보고_AI엔지니어링.pptx` imported through the administrator
  API with all three source slides and the 426,018-byte source file preserved.
- `ai-safety-red-team-report.zip` imported with all 17 HTML slides and the
  3,470,960-byte source archive preserved.
- Both records stored the expected `pptx` or `html_zip` source kind and storage
  key, produced valid JSON, and were available from the public template API.
- The isolated containers, network, and volumes were removed after verification.

## P1-4 OpenAI-Compatible LLM Generation

- LM Studio's `qwen/qwen3.6-35b-a3b` model generated a four-slide Korean
  outline and completed a four-slide presentation with titles and content.
- The same model generated a ten-slide outline through the configured batching
  path and completed ten uniquely ordered slides with titles and content.
- The ten-slide job reported progress at 45, 60, 75, and 100 percent before
  completing. Both generated presentations were retrievable through the API.
