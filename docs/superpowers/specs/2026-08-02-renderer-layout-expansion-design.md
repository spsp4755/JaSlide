# Renderer Layout Expansion — Design Spec

Date: 2026-08-02

## Context

This is the first sub-project of a larger initiative to raise TaeSlide's generation
quality toward what a strong model produces manually. That initiative was decomposed
into two independent sub-projects during brainstorming:

1. **Renderer layout intelligence** (this spec) — `apps/renderer`'s slide-drawing logic.
2. **Generation pipeline self-review loop** (future spec) — `apps/core-api`'s
   outline/slide generation flow (draft → critique → revise). Not started; the model
   itself is out of scope entirely, since the closed-network deployment will swap in a
   larger local model regardless of anything done here.

Within the renderer sub-project, the user identified "slide type / layout variety" as
the most painful gap: today `pptx_generator.py` only knows TITLE, TWO_COLUMN, CONTENT,
BULLET_LIST, QUOTE, SECTION_HEADER, TABLE, and CHART. Anything else (timelines,
roadmaps, process flows, comparisons, KPI dashboards) collapses into a generic CONTENT
slide with a flat bullet list, discarding the shape the source material actually has.

## Scope

This spec covers exactly:

1. Four new slide layouts: **timeline/roadmap**, **process/step flow**,
   **comparison (VS)**, **KPI cards**.
2. A shared text auto-fit helper, needed because these new layouts have text amounts
   that vary far more than a bullet list can absorb without overflowing or looking
   sparse — applied to the text elements these four layouts introduce.

Explicitly out of scope for this spec (captured in Future Work below): image
placement, template-wide design consistency, retrofitting auto-fit onto existing
layout types, and the generation pipeline self-review loop.

## Architecture

Same two-layer split already established by the TABLE/CHART/COLUMNS work
(`apps/core-api/internal/generation/llm.go`, `apps/renderer/src/generators/pptx_generator.py`):

- **Go (`core-api/internal/generation`)**: `outlinePrompt`/`slidePrompt` advertise the
  four new content schemas so the model knows they exist. `parseSlideContent` gains one
  "valid-or-nil" validator per schema (`validTimeline`, `validProcess`,
  `validComparison`, `validKPI`), following the exact pattern of `validTable`/`validChart`/`validColumns`.
- **Python (`renderer/src/generators/pptx_generator.py`)**: four new `_add_*_slide`
  draw functions, plus a shared `_fit_text` helper. `_add_slide`'s dispatch keeps
  trusting **content shape over the declared type label** — the same principle that
  fixed the TWO_COLUMN mislabeling bug — because the local model has already shown it
  mislabels slide types even when the content shape is correct.

## Content Schemas

Each new layout is keyed by a distinct top-level field in `content`, chosen so it can
never collide with the existing `table`/`chart`/`columns` keys or each other:

| Layout | Key | Shape | Count |
|---|---|---|---|
| Timeline/roadmap | `timeline` | `{items: [{date, label, description}]}` | 3–8 items |
| Process/step flow | `process` | `{steps: [{label, description}]}` | 2–6 steps |
| Comparison (VS) | `comparison` | `{left: {title, bullets}, right: {title, bullets}}` | exactly 2 sides |
| KPI cards | `metrics` | `{metrics: [{value, label}]}` | 2–6 cards |

`comparison` is intentionally a different shape from `columns` (object with `left`/`right`
keys vs. a 2-element array) so the dispatcher can tell them apart structurally without
relying on any type label — avoiding a repeat of the table/chart-vs-columns collision
bug fixed in the prior feature.

Rendering notes:
- Timeline: markers along a horizontal line, date above, label+description below (or
  vertical stack if items don't fit horizontally — decided during implementation based
  on item count).
- Process: numbered boxes connected by arrow connectors, left to right, capped at 6 to
  keep boxes legible.
- Comparison: two side-by-side panels with a centered "VS" badge divider.
- KPI: card grid, large value text + smaller label beneath, arranged in a row (2–3
  columns depending on count).

## Text Auto-Fit

`_fit_text(text_frame, char_count, box_width_in, box_height_in)`: a deterministic
step-down font-size chooser. It estimates characters-per-line from box width at a
candidate font size, computes the resulting line count for the given char count, and
picks the largest font size (from a fixed descending list) whose estimated line count
still fits the box height. No iterative measurement against the actual rendered
text — same "compute deterministically" principle used elsewhere in this codebase
rather than depending on python-pptx's limited auto-fit support.

Scope for this spec: wired into the four new draw functions only (their label/
description/value text elements). Retrofitting existing layout types (CONTENT,
BULLET_LIST, TWO_COLUMN, ...) with the same helper is deferred — see Future Work.

## Dispatch and Error Handling

`_add_slide` keeps the existing priority order (TITLE → has_columns/TWO_COLUMN →
table/chart-bearing CONTENT → ...) and appends checks for `timeline` / `process` /
`comparison` / `metrics` content keys before falling back to CONTENT/BULLET_LIST. Each
Go validator returns nil on any schema mismatch (wrong item count, missing required
field), so a malformed shape simply falls through dispatch to the next check rather than
crashing — consistent with every other validator in `llm.go`.

## Testing

- **Go** (`llm_test.go`): one test group per validator — valid shape accepted, missing
  required field rejected, item count outside the allowed range rejected. Mirrors the
  existing `validTable`/`validChart`/`validColumns` test structure.
- **Python** (`test_pptx_generator.py`):
  - One rendering test per new layout, asserting the expected shapes/text appear and
    stay within slide bounds, with and without an attached template.
  - `_fit_text` unit tests covering short text (max font size), very long text (smallest
    font size, no crash), and the boundary between size steps.
  - Dispatch-priority tests confirming table/chart/columns still win when a slide's
    content carries both one of those and one of the four new keys (regression guard
    for the exact bug class fixed in the prior feature).

## Future Work

Captured here per the user's request, in the rough order suggested during
brainstorming — each item gets its own brainstorming session and spec before
implementation:

1. Retrofit `_fit_text` onto the existing layout types (CONTENT, BULLET_LIST,
   TWO_COLUMN, SECTION_HEADER) so overflow protection isn't limited to the four new
   layouts.
2. Automatic image placement — deciding where and how large to place generated
   images/logos within a slide.
3. Template-wide design consistency — propagating a registered template's colors,
   fonts, and margins uniformly across every slide type, instead of the current
   per-slide-type hardcoded styling.
4. Generation pipeline self-review loop (`apps/core-api`) — a draft → critique →
   revise step in outline/slide generation, independent of renderer work and of any
   change to the underlying model.
