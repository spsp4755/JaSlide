# Genspark-style home and generation entry redesign

## Goal

Replace the current post-login experience — a card-grid dashboard plus a separate 5-step creation wizard — with a single Genspark-style home screen: a persistent sidebar shell, one prompt-first entry point that starts generation immediately, and a template gallery for discovery. No backend or API changes; this is a front-end reassembly of existing components and endpoints.

## Scope

**App shell.** A new `AppShell` layout (sidebar + content area) wraps authenticated pages. Sidebar items: `+ 새로 만들기` (jumps to home, focuses the prompt input), `홈`, `내 발표함`, `설정`, and `관리자` for admin users. `/editor`, `/login`, `/register`, and `/admin/*` keep their current layouts and are not wrapped in the shell.

**Home screen.** `/dashboard` becomes the unified entry point (route path unchanged to avoid breaking existing links/redirects):
- Large prompt textarea as the primary control.
- A row of mode tabs above the input, populated from the existing `PurposeOnboarding` purpose options (발표/보고서/교육 등) — same options, tab presentation instead of a full-screen onboarding step.
- An attach (`+`) icon opens the existing `react-dropzone` file upload flow from `/create`, replacing the current text/file toggle tabs.
- A settings icon opens a popover with slide count, language, and include-images/include-charts toggles — the same state currently held in `/create`'s options step, just collapsed into a popover instead of a wizard step.
- Submitting (Enter or send button) calls `generationApi` directly with the current prompt, selected purpose, selected template (if any), and popover options. No outline-preview step. Navigation moves to a generation-progress view (reusing the existing `GenerationProgress` component) and then to `/editor/[id]` on completion, matching current post-generation behavior.

**Template gallery.** Below the prompt box, a category-filter pill row and card grid, sourced from the existing `templatesApi.list()` and `templatesApi.defaults()` calls (already used in `/create`) — no new endpoints. Categories are derived from each template's existing `category` field plus an "전체" (all) option. Clicking a card marks that template as selected (visible badge near the prompt box); the next generation submit includes that template ID. Selection is optional — generating without a template selection keeps today's default-template behavior.

**My presentations.** The existing dashboard card grid (title, slide count, status, updated date, credits display) moves as-is to a new `내 발표함` page/route, linked from the sidebar. Data fetching (`presentationsApi.list()`, `creditsApi.balance()`) is unchanged, only relocated.

**Removed/replaced UI.** `/create`'s step indicator (`STEPS` constant and the 목적/입력/미리보기/옵션/생성 progress UI) is removed. Its underlying logic — onboarding purpose state, dropzone handling, options state, `generationApi` call — is reused, not rewritten, just re-hosted in the new home screen. The `/create` route redirects to the home screen once the new flow covers its functionality.

## Non-goals

- No changes to `/editor`, `/admin/*`, auth, the generation queue, or any API contract.
- No new template/skill content — the gallery only surfaces templates that already exist via the current admin template system.
- No outline-preview step (explicitly dropped per approved design — generation starts immediately on submit, matching Genspark's flow).

## Validation

Manual verification in a dev server: log in, confirm sidebar renders on `홈`/`내 발표함`/`설정` and not on `/editor` or `/admin`; submit a prompt from the home screen and confirm it reaches the generation-progress view and then the editor without an intermediate preview step; confirm file attach and settings popover reproduce today's `/create` options; confirm template card selection carries through to the generated presentation's applied template; confirm `내 발표함` shows the same data the old dashboard showed.

## Follow-up

If the template gallery needs dedicated "prompt preset" content (as opposed to visual PPTX templates) later, that's a separate design — this slice intentionally reuses only what already exists in the template system.
