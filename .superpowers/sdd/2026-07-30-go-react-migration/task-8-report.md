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

## P1-5 Progress, Cancellation, and Restart Recovery

- A running ten-slide LM Studio job was cancelled at 35 percent. It remained
  `CANCELLED` after the in-flight request stopped, created no slides, and moved
  its presentation to `FAILED`.
- A separate job was interrupted by stopping the API at
  `GENERATING_CONTENT`/30 percent. After the API restarted, durable recovery
  requeued it, progress advanced to 55 percent, and the job completed at 100
  percent with all four slides.

## P1-6 Manual Edit, Save, and Refresh of Generated Content

- Found and fixed a real gap while verifying: `content.scene` (written by
  `GetScene`/`SaveScene` for a generated slide with no PPTX/HTML source) was
  never read by PPTX export, which kept regenerating the slide from
  `content.heading`/`bullets` and silently discarding any manual edit. Fixed
  in `apps/renderer/src/generators/pptx_generator.py` (`_add_scene_slide`,
  reusing `scene_to_pptx.scene_to_edits`), with a new failing-then-passing
  test in `test_pptx_generator.py`. Commit `bbd2d91`.
- Live verification on an isolated Postgres + Redis + freshly built renderer
  image (Go API run locally against them): created a presentation with a
  generic (no template) `CONTENT` slide from `heading`/`bullets`; `GET scene`
  returned the synthesized title+bullets scene; `PATCH scene` with a manual
  text edit returned 200; a second `GET scene` (refresh) returned exactly the
  manual edit, not the regenerated layout — confirming the "refresh" step
  round-trips through the database, not client state.
- All 144 other renderer tests and the full Go test suite continued to pass;
  the only pre-existing failures are this Windows dev machine lacking
  `pdfunite`/`fc-list` (Linux-only tools the renderer image ships).

## P1-7 PPTX and PDF Export

- Same live stack: exported the edited slide as PPTX (`editable: true`) — a
  valid `PK\x03\x04` (Office Open XML) file whose `slide1.xml` contains the
  manually edited run text verbatim, not the regenerated heading/bullets.
- Exported the same presentation as PDF — a valid one-page `%PDF-1.6` file
  produced through the renderer's PPTX-to-PDF (LibreOffice) path.
- Isolated containers, network, and the verification-only renderer image were
  removed after verification.
