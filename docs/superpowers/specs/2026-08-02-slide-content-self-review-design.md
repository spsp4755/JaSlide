# Slide Content Self-Review Loop — Design Spec

Date: 2026-08-02

## Context

This is a separate sub-project from the renderer layout work completed
earlier today, decomposed during the initial brainstorming of "make TaeSlide
generate PPTX as well as Claude does": that initiative split into renderer
layout intelligence (done — timeline/process/comparison/KPI layouts, text
auto-fit, template position overrides) and this one, the Go `core-api`
generation pipeline. The underlying model's size/capability is out of scope
(a closed-network deployment will swap in a larger local model regardless).
Automatic image placement is out of scope for this sub-project too.

Today's generation flow (`apps/core-api/internal/generation/service.go:309`,
`Process`) calls `service.llm.Outline(...)` once, then
`service.llm.SlideContent(...)` once per slide, and stores whatever comes
back. The only existing validation
(`OpenAIClient.validated`, `llm.go:144`) checks that the response is
well-formed JSON with the required fields — it never judges whether the
*content* is any good (vague bullets, key points left out, a heading that
doesn't match the body).

## Scope

Add a single bounded review step per slide, inserted right after
`SlideContent()` in `Process`'s loop:

1. Critique the generated content against its title and key points.
2. If the critique finds something worth fixing, revise it once using the
   critique's feedback as the instruction.
3. Never review the revision — use it as-is. Never fail generation over a
   review-step error — fall back to the un-reviewed content.

This bounds cost to at most one extra LLM call for an approved slide, two
for a revised one — not an iterate-until-approved loop, and not a review of
the outline as a whole (a separate, not-yet-scoped possibility for later).

## Architecture

Reuse `OpenAIClient.Edit` (`llm.go:92`), which already takes a slide's
current JSON plus a free-text instruction and returns revised JSON — this is
exactly the "revise" half of the loop, already built and already exercised
by the AI-edit feature. The only new piece is the "critique" half.

Add one method to the `LLM` interface (`service.go:121`):

```go
type LLM interface {
	Outline(context.Context, OutlineRequest) (Outline, error)
	SlideContent(context.Context, SlideRequest) (json.RawMessage, error)
	Critique(context.Context, CritiqueRequest) (string, error)
	Edit(context.Context, json.RawMessage, string, string) (json.RawMessage, error)
	SlideHTML(context.Context, string, SlideRequest) (string, error)
	EditHTML(context.Context, string, string) (string, error)
}

type CritiqueRequest struct {
	Content   json.RawMessage
	Title     string
	KeyPoints []string
}
```

`Critique` returns an empty string when the content is approved, or
non-empty feedback text (suitable to pass straight to `Edit` as its
`instruction` argument) when it isn't. It never returns a structured
"reasons" list — free text is what `Edit` already consumes, so there's
nothing to gain from a richer type here.

Implementation (`OpenAIClient.Critique`) follows the exact shape of every
other LLM-backed method in `llm.go`: build a prompt, call
`client.validated(...)` with a validator that unmarshals
`{"approved": bool, "feedback": string}` and returns an error if `approved`
is `false` and `feedback` is empty (a malformed "reject with no reason"
response should retry, same as any other malformed response).

**Critique prompt covers exactly three checks** (matching what a slide's
`SlideRequest.KeyPoints`/`Title` can actually be judged against without
inventing criteria the input doesn't support):
1. Every key point is reflected somewhere in the content.
2. Bullets are concrete, not generic filler ("다양한 방안 검토" without saying
   which).
3. The heading matches what the body/bullets actually say.

## Process Wiring

In `service.go`'s `Process` loop, change:

```go
		rawContent, contentErr := service.llm.SlideContent(ctx, SlideRequest{
			Title: item.Title, Type: item.Type, Language: input.Language, KeyPoints: item.KeyPoints,
		})
		if contentErr != nil {
			service.fail(ctx, jobID, contentErr)
			return
		}
```

to additionally call `Critique`, then `Edit` only if feedback is non-empty,
swallowing errors from both (falling back to `rawContent` unchanged) since a
review-step failure must never turn into a generation failure — the
existing `contentErr` handling (a `SlideContent` failure *does* fail
generation) is unchanged and stays the only failure path here.

## Testing

- `OpenAIClient.Critique` tests (mirroring existing `TestConfiguredLocalModel...`-style
  tests in `llm_test.go`): approves well-formed content, requests changes
  when a key point is missing, retries on a malformed
  `{"approved": false}` with no feedback.
- `Service.Process` tests (mirroring `handlers_test.go`'s fake-LLM pattern):
  a fake LLM whose `Critique` returns `""` never has `Edit` called and the
  original content is stored; a fake whose `Critique` returns feedback has
  `Edit` called exactly once and *that* result is stored; a fake whose
  `Critique` returns an error still completes generation with the original
  content.
- The two existing test fakes in `handlers_test.go`
  (`maliciousHTMLLLM`, `cancellableLLM`) need a `Critique` method added to
  keep implementing the `LLM` interface — both return `("", nil)` (approved,
  no-op), preserving their current test behavior exactly.
