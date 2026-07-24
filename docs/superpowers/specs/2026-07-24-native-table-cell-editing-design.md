# Native PPTX Table Cell-Level Editing Design

Date: 2026-07-24
Status: Approved for planning

## Problem

For a PPTX-sourced presentation, the editor shows a native table as a single
flat overlay box. Editing its content only works through a side-panel grid of
plain `<input>` fields (`selectedNativeCells`), disconnected from the actual
rendered table shown on the slide. Users cannot click into a cell on the slide
itself the way they can in PowerPoint.

Separately, the extracted object geometry and the editor's overlay approximate
a table/text object as one bounding box with no per-row/per-column sizing and
no text alignment, so the editable overlay drifts from how the same content
actually renders in the server-side PPTX preview (LibreOffice-rendered PNG):
row spacing, cell alignment, and boundaries don't match.

## Goal

1. Let users edit a native table's cell text directly on the slide canvas,
   clicking into a cell the same way they already can with a plain text
   object.
2. Make the editable overlay's row/column boundaries and text alignment match
   the real PPTX geometry, closing the visible gap between the editor canvas
   and the rendered preview.
3. Fix the underlying alignment-loss bug in AI/native edits so paragraph
   alignment survives a text edit, independent of the overlay work.

This does not add drag-to-resize for table rows/columns, and does not change
shape/line/image overlay behavior — both are out of scope for this pass.

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

Also extract paragraph alignment for text objects and table cells (`left` /
`center` / `right`, from `paragraph.alignment`), added as `align` alongside
the existing per-paragraph `level`. Default to `left` when the source
paragraph has no explicit alignment (matches PowerPoint's own default).

## Editor changes (web)

Where the editor currently renders `selectedNativeObject.kind === 'table'`
content only inside the side panel (`apps/web/src/app/editor/[id]/page.tsx`,
the `selectedNativeCells` grid), add a cell-grid overlay positioned on top of
the table's overlay box on the canvas itself:

- A CSS grid whose row/column tracks are each `rowHeights[i] / sum(rowHeights)`
  and `columnWidths[j] / sum(columnWidths)` as percentages, so cell boundaries
  land exactly where the real table's boundaries are.
- Each cell is a `contentEditable` element, reusing the same inline-edit
  mechanism already used for plain text objects (`data-taeslide-editing`,
  the existing blur/commit handling), rather than a new editing primitive.
- Typing into a cell updates `objectEdits[].cells` through the existing
  `updateNativeObject` path — no new persistence shape, no backend change.
- The side-panel grid of `<input>` cells is removed for tables now that the
  canvas is directly editable; the side panel keeps only cell-independent
  table properties if any exist (currently none beyond content).

Apply the extracted `align` value when rendering both plain text objects and
table cells in the overlay, so the on-canvas text alignment matches the
rendered preview.

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

- Renderer: extend `test_pptx_to_html.py` / `test_style_extractor.py` with a
  table that has uneven row heights and column widths, asserting the
  extracted `rowHeights`/`columnWidths` match the source table's real values;
  add a case asserting extracted `align` for a right-aligned and a
  center-aligned paragraph.
- Renderer: extend `test_pptx_generator.py` with a text-replace and a
  table-cell-replace case where the source paragraph is right/center aligned,
  asserting the generated output preserves that alignment.
- Web: extend the existing source-pattern test style (`apps/web/test/*.test.js`)
  to assert the cell-grid overlay markup and `contentEditable` wiring exist,
  and that the old side-panel input grid for tables is gone.

## Scope and Limits

- No drag-to-resize of table rows/columns in this pass.
- No changes to shape/line/image overlay precision.
- No backend/API schema changes — `objectEdits[].cells` stays the same shape;
  only the renderer's *extraction* output and the editor's *rendering* of
  existing data change.
