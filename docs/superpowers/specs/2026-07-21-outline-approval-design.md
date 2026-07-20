# Outline Review and Approval

## Goal

Let a user review and edit the AI-generated slide outline — titles, order, and key points — before slide content is generated, instead of going straight from prompt to a finished deck.

## Background

The generation pipeline already produces an outline internally. `LlmService.generateOutline()` returns `{ title, slides: [{ order, title, type, keyPoints }] }`, and `GenerationService.processGeneration()` calls it as the first step (status `GENERATING_OUTLINE`) before generating slide content. Today this outline is never shown to the user: the home screen submits the prompt and the worker runs outline → content → design in one uninterrupted job.

This feature surfaces the outline as an explicit, editable step between prompt submission and content generation. Citation validation (verifying each key point maps to an uploaded-file locator) is explicitly out of scope for this slice — it is deferred to a later spec.

## Scope

### Backend: split outline generation from content generation

Add `POST /generation/outline`. It reuses the existing `LlmService.generateOutline()` and returns the outline JSON directly. It creates no presentation, no `GenerationJob`, and touches no persistence. Skill guidance is folded into the content the same way `processGeneration` does today (`content` + `\n\n[작성 Skill 가이드]\n` + `skillGuidance`), so an outline generated with a Skill reflects that Skill.

Request body mirrors the outline-relevant fields of the current start flow:

- `content: string` (required)
- `sourceType`, `language`, `slideCount`, `skillId`, `options` (all optional, same meaning as `StartGenerationDto`)

Response: `{ title: string, slides: [{ order: number, title: string, type: string, keyPoints: string[] }] }` — the existing `SlideOutline` shape.

Skill visibility for `skillId` uses the same three-way check as `startGeneration` (public OR own-user OR same-organization). The endpoint requires auth via the existing `JwtAuthGuard`.

Extend `StartGenerationDto` with an optional `outline?: SlideOutlineDto`. When present, `processGeneration` skips its own outline-generation step and uses the supplied outline for content generation. The supplied outline is run through the existing `validateOutline` logic (adapted to accept the client-provided slide count = `outline.slides.length`) before content generation begins; an invalid outline rejects the request at the API boundary with a 400, not mid-job. When `outline` is absent, the pipeline behaves exactly as today (full backward compatibility).

Because the user may have added/removed slides during review, `slideCount` is no longer authoritative when `outline` is present — the number of slides generated equals `outline.slides.length`.

### Frontend: review/edit step on the home screen

The home screen (`apps/web/src/app/dashboard/page.tsx`) gains an `outline` review state between the prompt composer and the generation-progress view. Flow:

1. User clicks send. The composer area switches to a short loading state ("아웃라인 생성 중…") while `generationApi.outline(...)` runs.
2. On success, the same area shows the review UI:
   - Presentation title — editable text input.
   - An ordered list of slides. Each slide shows: an editable title input, its key points as an editable bullet list (edit text inline, delete a point, "+ 요점 추가" to append), a move-up / move-down control pair, and a delete-slide control.
3. Footer actions: **취소** (discard the draft, return to the composer with the prompt intact) and **승인하고 생성** (submit the edited outline).
4. On approval, the client calls `generationApi.start(...)` with the edited `outline` included, then transitions to the existing `GenerationProgress` view and, on completion, to `/editor/[id]` — unchanged from today.

Reordering uses move-up/move-down buttons rather than drag-and-drop: the list is short and this avoids pulling `react-dnd` into the home route. After any edit, the client renumbers `order` sequentially before submitting so the backend receives a clean 0..n-1 ordering.

No "regenerate outline" button: to get a different outline the user cancels and edits the prompt.

The PPTX "Skill로 등록" branch and the no-input guard in `handleGenerate` are unchanged and still run before the outline request.

## Non-goals

- Citation/locator validation of key points (separate future spec).
- Persisting outline drafts server-side (the browser holds the draft and resubmits it).
- Editing slide `type` or body content in the review step (body content does not exist yet at review time).
- Any credit-system change (a separate spec removes credits entirely; this spec neither adds nor removes credit logic).
- A dedicated `/outline-review` route (the review renders inline on the home screen).

## Validation

Backend: `POST /generation/outline` returns a well-formed `SlideOutline` for a valid request and 400 for empty content. `POST /generation/start` with a hand-edited `outline` (e.g. slides removed, key points changed) generates exactly the supplied slides and skips outline generation; with a malformed `outline` it returns 400 before enqueueing a job; with no `outline` it behaves as before. Skill visibility on the outline endpoint matches `startGeneration` (public/own/org allowed, others rejected).

Frontend (web test file, matching the repo's `node --test` style): the home page requests an outline before showing progress, renders the editable review step, renumbers order on submit, and passes the edited outline to `generationApi.start`.

Manual: log in, submit a prompt, edit a title and a key point, remove a slide, reorder, approve, and confirm the generated deck reflects the edits.
