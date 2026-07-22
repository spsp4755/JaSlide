# Editor AI chat

## Goal

Replace the per-slide AI edit button and modal with an editor-side chat tab.
The chat accepts whole-deck instructions while applying changes only to the
slides explicitly named by the user when slide numbers are present.

## UI

- The right editor area has `Edit` and `AI Chat` tabs.
- The chat shows user prompts and completion/error messages.
- The input remains fixed at the bottom of the tab.
- The existing action buttons under the canvas and the old AI edit modal are removed.

## Target selection

- `3번`, `3번 슬라이드`, and `3페이지` target slide 3.
- `2~4번` targets slides 2 through 4.
- Multiple explicit numbers are combined and de-duplicated.
- A prompt without a slide number targets all slides.
- Invalid slide numbers are ignored; if none remain after parsing, use all slides.

## Data flow

1. The user sends a prompt from the chat tab.
2. The client resolves target slide IDs from the current presentation order.
3. It calls the existing `generationApi.aiEdit` endpoint with the instruction and target IDs.
4. Returned slides replace their client-side copies and the preview refreshes.
5. The chat appends a success or failure message.

## Boundaries

- Reuse the existing authenticated AI-edit API; no new backend endpoint or database schema.
- Chat history is session-only for this first version; it is not persisted.
- Text, HTML, chart, and table edits continue to use the existing slide edit path.

## Verification

- Add a small source-level regression test for the chat tab and target parser.
- Run the web test suite and production build.
