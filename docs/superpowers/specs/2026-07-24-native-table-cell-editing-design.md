# Native PPTX Object Direct-Canvas Editing Design

Date: 2026-07-24
Status: Approved for planning

## Problem

For a PPTX-sourced presentation, native objects (text boxes and tables) only
support move/resize directly on the slide canvas. Editing their *content*
always happens through the right-side property panel (a plain `<textarea>`
for text objects, a grid of `<input>` cells for tables — `selectedNativeCells`)
— never by clicking into the text on the slide itself, the way PowerPoint
works. This was mis-scoped as "tables only" in an earlier pass of this design;
re-reading the editor code showed text objects have exactly the same
side-panel-only limitation.

Separately, the extracted object geometry approximates a table/text object as
one bounding box with no per-row/per-column sizing and no text alignment, so
the editable overlay drifts from how the same content actually renders in the
server-side PPTX preview (LibreOffice-rendered PNG): row spacing, alignment,
and boundaries don't match.

## Goal

1. Let users edit both a native text box's text and a native table's cell
   text directly on the slide canvas, by clicking into it — not only through
   the side panel.
2. Make the editable overlay's row/column boundaries and text alignment match
   the real PPTX geometry, closing the visible gap between the editor canvas
   and the rendered preview.
3. Fix the underlying alignment-loss bug in AI/native edits so paragraph
   alignment survives a text edit, independent of the overlay work.

This does not add drag-to-resize for table rows/columns, and does not change
shape/line/image overlay behavior (they have no editable text content) —
both are out of scope for this pass.

## Data model changes (renderer)

`apps/renderer/src/services/pptx_to_html.py` (or wherever table objects are
built during `/api/extract/style`) currently emits, per table object:

```
{ id, left, top, width, height, kind: "table", cells: string[][] }
```

Extend this with real per-row/per-column geometry, read directly from the
table's `python-pptx` `GraphicFrame`/`Table` (row `height` and column `width`
are native properties on `table.rows[i].height` / `table.columns[j].width`):

```
{ ..., rowHeights: number[], columnWidths: number[] }
```

Both arrays are in the same 1920x1080 coordinate space already used for
`left/top/width/height`, so the editor can compute each cell's box as a
percentage of the table's own width/height without a second unit conversion.

Also extract paragraph alignment for text objects only (`left` / `center` /
`right`, from `paragraph.alignment`), added as `align` alongside the existing
per-paragraph `level`. Default to `left` when the source paragraph has no
explicit alignment (matches PowerPoint's own default). Table cell alignment
extraction is skipped in this pass — see Scope and Limits.

## Editor changes (web)

The native-object overlay (`apps/web/src/app/editor/[id]/page.tsx`, the
`nativeObjects.map(...)` block around line 1808) currently renders an empty
`<div>` per object — a move/resize handle with no visible or editable text;
all content editing happens in the side panel. Replace the empty div's
content based on `object.kind`:

- **`text`**: render the object's text as a `contentEditable` element inside
  the overlay div. On blur, commit via `updateNativeObject(object.id, { text })`
  (existing function, unchanged signature).
- **`table`**: render a CSS grid inside the overlay div whose row/column
  tracks are each `rowHeights[i] / sum(rowHeights)` and
  `columnWidths[j] / sum(columnWidths)` as percentages, so cell boundaries
  land exactly where the real table's boundaries are. Each cell is a
  `contentEditable` element; on blur, commit the full updated `cells` grid
  via the existing `updateNativeObject(object.id, { cells })`.
- Both reuse the same commit path (`updateNativeObject` → `objectEdits`),
  so no new persistence shape and no backend change.
- The side-panel `<textarea>` (text) and `<input>` grid (table, i.e.
  `selectedNativeCells`) are removed now that the canvas is directly
  editable; the side panel keeps only non-content properties (font, color,
  size, position — already separate fields).

Apply the extracted `align` value when rendering plain text objects in the
overlay (`text-align` CSS), so on-canvas text alignment matches the rendered
preview. Table cells keep the same left-alignment default the raw `cells`
strings already render with today — no per-cell alignment extraction in this
pass (see Scope and Limits).

## Alignment-preservation bug fix (renderer)

`PPTXGenerator._apply_native_edit` (`apps/renderer/src/generators/pptx_generator.py`)
already preserves paragraph `level` when replacing a shape's text or a table
cell's text, but does not preserve `paragraph.alignment`. Fix both text-replace
branches (the `shape.text = edit["text"]` branch and the table `cells` branch)
to read each source paragraph's `alignment` before clearing/replacing text and
re-apply it to the corresponding output paragraph, the same way `level` is
already carried over. This is a standalone bug fix, independent of the
overlay/geometry work above, and lands first.

## Testing

- Renderer: extend `test_pptx_to_html.py` with a table that has uneven row
  heights and column widths, asserting the extracted `rowHeights`/
  `columnWidths` match the source table's real values; add a case asserting
  extracted `align` for a right-aligned and a center-aligned text object.
- Renderer: extend `test_pptx_generator.py` with a text-replace and a
  table-cell-replace case where the source paragraph is right/center aligned,
  asserting the generated output preserves that alignment.
- Web: extend the existing source-pattern test style (`apps/web/test/*.test.js`)
  to assert the on-canvas `contentEditable` wiring exists for both text and
  table objects, and that the old side-panel `<textarea>`/input-grid content
  editing for native objects is gone.

## Scope and Limits

- No drag-to-resize of table rows/columns in this pass.
- No per-cell text alignment extraction or rendering — cells keep their
  current left-aligned rendering; add per-cell `align` if a real template
  surfaces visibly misaligned cell text.
- No changes to shape/line/image overlay precision (they carry no editable
  text).
- No backend/API schema changes — `objectEdits[].text` / `.cells` stay the
  same shape; only the renderer's *extraction* output and the editor's
  *rendering* of existing data change.
