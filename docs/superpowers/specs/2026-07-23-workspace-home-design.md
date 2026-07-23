# Workspace Home Design

## Goal

Make JaSlide an app inside an extensible internal AI workspace. The workspace home is the authenticated entry point; AI Slide opens the existing presentation-generation flow.

## Routes

- `/` redirects authenticated users to `/home` and unauthenticated users to `/login`.
- `/home` is the workspace home.
- `/dashboard` remains the existing JaSlide AI Slide creation surface.

## Home layout

- A compact left rail contains the JaSlide mark, New, Home, Skills, and a reserved “More” entry.
- The center contains a workspace greeting and a single prompt box. Submitting a non-empty prompt opens `/dashboard` with the prompt prefilled.
- An app row groups current and future tools. `AI 슬라이드` is active and opens `/dashboard`; other entries are visibly marked as planned and do not imply unavailable functionality exists.
- The page uses the existing authenticated navigation and Lucide icons. No new dependencies or backend APIs are required.

## Behavior and validation

- Home and AI Slide links preserve authentication handling through the existing auth store.
- New and AI Slide both navigate to `/dashboard`; the prompt input uses the existing `focus` query parameter plus a new content query parameter consumed by the dashboard.
- Add a focused source test for the workspace route and AI Slide handoff, then verify the web test suite, production build, and the rendered desktop/mobile home screen.
