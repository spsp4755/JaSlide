# New-Layout Template Position Overrides — Design Spec

Date: 2026-08-02

## Context

This is Future Work item #3 from the renderer layout expansion spec
(`docs/superpowers/specs/2026-08-02-renderer-layout-expansion-design.md`),
scoped down during brainstorming after finding that styling actually splits
into three parallel systems in `apps/renderer/src/generators/pptx_generator.py`:

1. The generic `self.tokens`-driven path (colors/fonts) plus `self._layout()`
   (position/size overrides from an uploaded HTML template's
   `data-jaslide-slot` elements) — used consistently by the six pre-existing
   layouts (title, content, bullet-list, two-column *title*, quote,
   section-header).
2. The four newer layouts (timeline, process, comparison, KPI) plus the
   two-column layout's *column bodies* — these already use `self.tokens` for
   color correctly, but their body content (timeline markers, process boxes,
   comparison columns, KPI cards) is drawn at hardcoded `Inches()` coordinates
   that never call `self._layout()`, so an uploaded template can reposition
   their titles but nothing else.
3. `_add_html_template_slide`/`_add_semantic_html_layout` — a separate,
   bespoke rendering path used only when a `zipTemplate`/`htmlTemplate` with
   its own parsed HTML objects is attached, including hardcoded drawers for
   specific template names (`threat-model`, `rsp-tier`, etc.).

This spec covers only #2: giving the five newer-layout bodies the same
template-overridable positioning the six older layouts already have. #1 is
unaffected (already correct). #3 is out of scope — unifying it would mean
rearchitecting a separate, intentionally bespoke rendering path, not fixing
an inconsistency.

## Root Cause

`self._layout(slot, defaults)` (`pptx_generator.py:122`) already merges
`self.html_layout.get(slot, {})` over `defaults`, so calling it is not by
itself sufficient: `self.html_layout` is populated by
`parse_html_layout()` (`apps/renderer/src/services/html_template.py:61`),
whose `_LayoutParser` only recognizes `data-jaslide-slot` values in the
hardcoded `SLOTS = {"title", "subtitle", "body", "bullets"}`
(`html_template.py:16`). A template author cannot define a
`data-jaslide-slot="timeline"` element today — the parser silently drops it.

## Scope

1. Extend `SLOTS` in `html_template.py` with five new names: `"timeline"`,
   `"process"`, `"comparison"`, `"kpi"`, `"columns"` (the last for the
   two-column layout's column body region, distinct from its already-covered
   `"title"` slot).
2. In each of the five affected functions, replace the block of hardcoded
   coordinate literals with one `self._layout(<slot>, {...defaults...})` call
   whose defaults exactly reproduce today's hardcoded bounding box, then
   derive every internal element's position as a proportion of the returned
   rect instead of a fixed literal. With no template override, output is
   pixel-identical to today (verified by the existing test suite, which
   already renders these layouts with no template attached).

## Default Rects (per function, matching current hardcoded bounds exactly)

| Function | Slot | Default rect |
|---|---|---|
| `_add_timeline_slide` | `timeline` | `{"x": 1.0, "y": 3.05, "w": 11.333, "h": 2.65}` |
| `_add_process_slide` | `process` | `{"x": 0.7, "y": 2.8, "w": 11.933, "h": 1.8}` |
| `_add_comparison_slide` | `comparison` | `{"x": 0.5, "y": 1.3, "w": 12.3, "h": 5.7}` |
| `_add_kpi_slide` | `kpi` | `{"x": 0.7, "y": 1.6, "w": 11.933, "h": 5.3}` |
| `_add_two_column_slide` (column body only; title already covered) | `columns` | `{"x": 0.5, "y": 1.15, "w": 12.3, "h": 5.85}` |

Each was computed as the tightest box containing every element the function
draws today (e.g. timeline's rect top is the date-label box's current top,
`3.6 - 0.55 = 3.05`; its bottom is the label/description box's current
bottom, `3.6 + 0.3 + 1.8 = 5.7`, giving height `5.7 - 3.05 = 2.65`). The
`columns` rect's top (`1.15`) is the optional per-column header box's current
top — the tightest box has to include it even though it's absent when a
column has no header — and its bottom (`7.0`) is the bullets box's current
bottom in the no-header case, giving height `7.0 - 1.15 = 5.85`.

## Transformation Principle (worked example: timeline)

Before (hardcoded):
```python
left, right, line_y = 1.0, 12.333, 3.6
# date_box: y = line_y - 0.55, h = 0.4
# text_box: y = line_y + 0.3, h = 1.8
```

After (rect-driven, identical output for the default rect):
```python
rect = self._layout("timeline", {"x": 1.0, "y": 3.05, "w": 11.333, "h": 2.65})
left, right = rect["x"], rect["x"] + rect["w"]
line_y = rect["y"] + rect["h"] * 0.2075          # (3.6 - 3.05) / 2.65
date_top, date_h = rect["y"], rect["h"] * 0.1509  # 0.4 / 2.65
text_top, text_h = rect["y"] + rect["h"] * 0.3208, rect["h"] * 0.6792  # (3.9-3.05)/2.65, 1.8/2.65
```
Marker geometry (a fixed-size decorative circle, not a text box) stays an
absolute `0.18in`, positioned relative to the now-dynamic `line_y` — markers
don't need to grow/shrink with the rect, only move with it.

The same principle (fixed-box defaults reproduced exactly, internal offsets
expressed as a fraction of the rect, purely decorative fixed-size elements
like markers/arrows/badge left at their absolute size) applies to the other
four functions. The implementation plan works out each function's exact
fractions the same way this example did.

## Testing

- One test per affected function: inject a custom `self.html_layout` entry
  (via a template's `htmlTemplate` containing a `data-jaslide-slot="timeline"`
  element with `data-x`/`data-y`/`data-w`/`data-h` at a different position)
  and assert the rendered shapes actually land at the overridden coordinates
  instead of the defaults.
- The existing test suite (no template attached) continues to pass
  unmodified — it is the regression guard proving default-rect output is
  unchanged.
