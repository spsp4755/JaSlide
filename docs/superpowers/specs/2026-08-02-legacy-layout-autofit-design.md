# Legacy Layout Text Auto-Fit — Design Spec

Date: 2026-08-02

## Context

This is Future Work item #1 from the renderer layout expansion spec
(`docs/superpowers/specs/2026-08-02-renderer-layout-expansion-design.md`),
which scoped text auto-fit to only the four newly added layouts (timeline,
process, comparison, KPI). The six layout functions that predate that work —
`_add_title_slide`, `_add_content_slide`, `_add_bullet_slide` (and the shared
`_add_bullets` helper), `_add_two_column_slide` (and the shared
`_add_column_bullets` helper), `_add_quote_slide`, `_add_section_header_slide`
— never call the existing auto-fit primitive
(`fit_font_scale`/`_shrink_text_to_fit`, `apps/renderer/src/generators/pptx_generator.py:40,137`)
at all, so their text can overflow its box exactly the way the new layouts'
would have without it.

## Scope

Wire the existing `_shrink_text_to_fit` helper into every textbox drawn by
the six pre-existing layout functions. This is a pure addition — one
`self._shrink_text_to_fit(box)` call after each box's text/style is set — with
no change to any existing layout logic, geometry, or styling.

Out of scope: any change to `_shrink_text_to_fit`/`fit_font_scale` themselves,
image placement, template design consistency, or the generation pipeline
self-review loop (the remaining Future Work items, each to be brainstormed
separately).

## Call Sites

| Function | Textbox(es) |
|---|---|
| `_add_title_slide` | title box, subtitle box |
| `_add_content_slide` | title box, body box (bullets covered via `_add_bullets`) |
| `_add_bullets` (shared by `_add_content_slide` and `_add_bullet_slide`) | bullet box |
| `_add_two_column_slide` | title box, each column's header box (column bullets covered via `_add_column_bullets`) |
| `_add_column_bullets` (shared, also used by the comparison layout) | bullet box |
| `_add_quote_slide` | quote box |
| `_add_section_header_slide` | title box |

`_add_bullet_slide` itself needs no direct change — it only calls `_add_bullets`,
already covered.

## Behavior

`_shrink_text_to_fit(shape, default_pt=18.0)` already reads each run's actual
set font size (via `run.font.size.pt`) rather than requiring a caller-specified
size, and every call site here sets an explicit size through `_style_paragraph`
first — so no call site needs its own `default_pt` tuning. The call is added
immediately after a box's paragraphs (and any additional paragraphs, e.g.
bullets) are fully populated, matching the pattern already used in the four
newer layouts and in `_apply_native_edit`.

## Testing

One test per call site confirming that very long text produces a
`fontScale` below 100% in the generated `<a:normAutofit>` element (mirroring
the existing `test_pptx_template_shrinks_generated_text_that_outgrew_its_box`
assertion style), plus one regression test confirming short text in one of
these layouts is unaffected (no shrink, matching
`test_pptx_template_leaves_text_that_still_fits_at_full_size`).
