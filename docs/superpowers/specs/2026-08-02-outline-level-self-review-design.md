# Outline-Level Self-Review Loop — Design Spec

Date: 2026-08-02

## Context

This is the deferred "separate, not-yet-scoped" item from the slide-content
self-review spec (`docs/superpowers/specs/2026-08-02-slide-content-self-review-design.md`,
merged to `main` at commit `3b947da`): that sub-project reviews each
slide's content in isolation (are the bullets concrete, does the heading
match the body, are the key points covered) but never looks at the outline
as a whole. This sub-project adds that missing layer without touching the
per-slide review, which stays exactly as it is.

Today's flow (`apps/core-api/internal/generation/service.go:316`, `Process`):
calls `service.llm.Outline(...)` once to get the slide-by-slide outline
(skipped entirely when the caller supplied their own outline via
`input.Outline`), then loops over `outline.Slides`, generating and
self-reviewing each slide's content independently. Nothing ever judges the
outline as a whole — slide order, duplication across slides, or whether
content is unevenly distributed across the deck.

## Scope

Add one review step, run once per generation, immediately after
`service.llm.Outline(...)` succeeds and before the per-slide content loop
begins:

1. Critique the outline against three checks: slide order/flow, duplication
   or coverage gaps versus the source content, and slide count/content
   distribution (no slide starved or overloaded).
2. If the critique finds something worth fixing, it returns the corrected
   outline directly in the same call — no separate feedback-then-edit
   round trip. This differs from the slide-content pattern because outline
   fixes are structural (reorder, merge, split, rebalance), and having the
   model reconstruct the outline in one pass avoids translation loss
   between free-text feedback and a second edit call.
3. Never re-critique the corrected outline. Never fail generation over a
   review-step error — fall back to the original outline unchanged.

**Only applies to LLM-generated outlines.** When the caller supplies their
own outline (`input.Outline != nil`), `service.llm.Outline(...)` is never
called, and this review step is skipped along with it — a user's own
outline is a deliberate choice, not something to second-guess.

This bounds cost to exactly one extra LLM call per generation (not per
slide), regardless of slide count — cheaper than the slide-content
self-review's per-slide multiplier, since the outline step runs once for
the whole deck.

## Architecture

Add one method to the `LLM` interface (`service.go:121`):

```go
type LLM interface {
	Outline(context.Context, OutlineRequest) (Outline, error)
	SlideContent(context.Context, SlideRequest) (json.RawMessage, error)
	Critique(context.Context, CritiqueRequest) (string, error)
	CritiqueOutline(context.Context, Outline) (Outline, bool, error)
	Edit(context.Context, json.RawMessage, string, string) (json.RawMessage, error)
	SlideHTML(context.Context, string, SlideRequest) (string, error)
	EditHTML(context.Context, string, string) (string, error)
}
```

`CritiqueOutline` returns `(outline, false, nil)` when the input is approved
as-is (the returned outline is the same one passed in). It returns
`(revisedOutline, true, nil)` when the model corrected it — the bool is
what `Process` branches on to decide whether to adopt the returned outline.
It never returns a structured "reasons"
list separate from the outline itself — there's nothing downstream that
consumes free-text outline feedback, unlike slide `Critique`, whose text
feeds straight into `Edit`.

Implementation (`OpenAIClient.CritiqueOutline`) follows the same shape as
every other LLM-backed method in `llm.go`: build a prompt, call
`client.validated(...)` with a validator that unmarshals
`{"approved": bool, "outline": {...}}`, and when `approved` is `false`,
parses the `outline` field with the existing `parseOutline` function
(`llm.go:312`) to confirm it's structurally valid (right slide count bounds,
required fields) before accepting it — a malformed correction retries, same
as any other malformed response from `validated`.

**Critique prompt covers exactly three checks**, matching the design
question's answers:
1. Slide order/flow — does the deck progress logically (e.g., intro before
   detail, no jarring topic jumps)?
2. Duplication/coverage — do any two slides cover the same ground, and does
   the outline reflect the source content's key topics without gaps?
3. Slide count/distribution — is any single slide overloaded or starved
   relative to the others?

The prompt includes the outline (title + all slides with their titles and
key points) and the original source content so the model has something to
check coverage against.

## Process Wiring

In `service.go`'s `Process`, right after the existing LLM-outline branch:

```go
outline, err = service.llm.Outline(ctx, OutlineRequest{
	Content: content, Language: input.Language, SlideCount: input.SlideCount,
	TemplateSlides: catalog,
})
if err != nil {
	service.fail(ctx, jobID, err)
	return
}
if revised, changed, critiqueErr := service.llm.CritiqueOutline(ctx, outline); critiqueErr == nil && changed {
	outline = revised
}
```

placed inside the `else` branch that already guards LLM-generated outlines
(the `if input.Outline != nil { outline = *input.Outline } else { ... }`
block), so the user-supplied-outline path is structurally excluded, not
just skipped by a runtime check. A `CritiqueOutline` error is swallowed —
the existing `err` handling for `Outline` itself is untouched and remains
the only failure path for outline generation.

## Testing

- `OpenAIClient.CritiqueOutline` tests (`llm_test.go`, `httptest.NewServer`
  pattern, mirroring the existing `Critique` tests): approves a well-formed
  outline unchanged, returns a corrected outline when the model flags an
  issue, retries when the corrected `outline` field fails `parseOutline`
  validation.
- `Service.Process` wiring tests (`handlers_test.go`, fake-LLM pattern):
  a fake whose `CritiqueOutline` returns `(outline, false, nil)` results in
  the original outline's slides being generated; a fake that returns a
  changed outline results in the corrected outline's slides being
  generated instead; a fake that returns an error still completes
  generation using the original outline. A fourth test confirms
  `CritiqueOutline` is never called at all when `input.Outline` is supplied
  by the caller (the LLM-outline branch is skipped entirely).
- The existing test fakes in `handlers_test.go` (`maliciousHTMLLLM`,
  `cancellableLLM`, `reviewLLM`) need a `CritiqueOutline` method added to
  keep implementing the `LLM` interface — all return `(outline, false,
  nil)` (approved, no-op), preserving their current test behavior exactly.
