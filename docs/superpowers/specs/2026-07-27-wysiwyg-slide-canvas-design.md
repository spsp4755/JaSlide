# WYSIWYG Slide Canvas: Edit the Slide, Not a Text Box

Date: 2026-07-27
Status: Approved (design)

## Problem

Editing a generated slide does not feel like editing the slide. It feels like
typing into a notepad pasted on top of one. Two distinct failures produce that,
and the second one destroys data.

**1. The editing surface is a picture with holes punched in it.**

Both template kinds render the slide as a server-produced PNG, overlay
transparent hit-boxes on it, and open an opaque white `<textarea>` when you
double-click:

- `apps/web/src/app/editor/[id]/page.tsx:2036` — native (PPTX) path
- `apps/web/src/app/editor/[id]/page.tsx:2112` — HTML (ZIP) path

The textarea approximates the slide's type with hardcoded arithmetic:
`nativeTextStyle` scales font size by `/5.4cqh`; the HTML path uses
`fontSize/4` with a `Math.max(12, …)` floor. Its `bg-white` hides the slide's
own background, table cell fills and borders while you type. Geometry is
re-derived per element as percentages (`/19.2`, `/10.8`) instead of using the
template's own coordinates.

**2. Saving a text edit destroys per-run formatting.**

`apps/renderer/src/generators/pptx_generator.py:381`:

```python
shape.text = edit["text"]
```

python-pptx's `.text` setter collapses the entire text frame into a single run.
The surrounding code carefully restores `level` and `alignment`, but every
per-run property — bold, colour, size, family — is gone. Editing one word in a
box flattens that box's formatting in the exported PPTX. The table-cell path
partially mitigates this by restoring each paragraph's first run
(`pptx_generator.py:425-450`); the plain-text path restores nothing.

**3. The browser and the renderer never draw the same glyphs.**

The renderer has 29 Korean families (Nanum*, Noto CJK). A deck asking for
`HY헤드라인M` silently falls back to Noto Sans CJK KR. The browser, given the
same family name, falls back to whatever Windows offers — Malgun Gothic. So
even a perfectly positioned overlay shows a different typeface than the PNG
beneath it.

## Goal

Google-Slides-style editing: click into text on the slide itself and type, with
the slide's real fonts, sizes, colours, positions and backgrounds intact — for
both template kinds (ZIP HTML and PPTX).

## Decisions (confirmed with user)

1. **The browser renders the slide directly as live DOM.** No PNG beneath the
   editing canvas. Chosen over "keep the PNG and improve the overlay" because
   an overlay can never reveal what the image already painted.
2. **The edit surface is the reference.** The exported `.pptx` stays natively
   editable and may differ slightly from the browser view. This is the same
   architecture and the same tradeoff Google Slides makes with an imported
   PPTX. "일반 보기" remains the server-rendered truth check.
3. **Phased.** Phase 1 is specified here. Phases 2–3 are sketched only.

Explicitly rejected: making HTML the export source of truth for PPTX decks.
It would remove native editability of the exported file, which is a shipped
feature (`9078419 feat(export): offer a PPTX the recipient can actually edit`).

## Evidence that the HTML is good enough to render

Both template kinds already have per-slide HTML: ZIP decks store `content.html`;
PPTX templates store `config.htmlSlides[]`, produced at import by
`apps/renderer/src/services/pptx_to_html.py`.

Rendering the reference deck's stored `htmlSlides[0]` through Chromium
reproduces the title, the top-right label, the two-column 실적/계획 table and
the full nested bullet hierarchy — matching Google Slides' own import of the
same file line for line. Two visible gaps: table cells render vertically
centred rather than top-anchored, and cell borders are lighter than the deck's.
Both are extractor defects and are fixed in phase 1 because this HTML becomes
the editing surface.

The extracted HTML already carries per-run `<span>`s
(`font-size`/`color`/`font-family`/`font-weight`/`font-style`/`text-decoration`)
and paragraph indents (`margin-left`/`text-indent`) with bullet markers —
`pptx_to_html.py:127-157`. Rendering it live gives rich text display for free.
Today's textarea discards all of it on the first keystroke.

## Approach — Phase 1

### SlideCanvas

New component, `apps/web/src/components/editor/slide-canvas.tsx`.

Renders the slide HTML into a fixed 1920×1080 stage and scales the whole stage
with `transform: scale(k)`, `transform-origin: top left`, where
`k = containerWidth / 1920`. Children keep the template's own absolute pixel
coordinates; nothing is re-derived per element.

Pointer deltas convert once, `delta / k`, replacing the current
`* 1920 / bounds.width` at each call site.

Objects are located by `[data-object-id]`. The selection outline and the eight
resize handles are drawn as siblings positioned from the located element's
offset box, so they follow the real rendered geometry rather than a parallel
copy of it.

### Resolving a slide's base HTML

- **ZIP deck:** `content.html` — already per-slide and already carries the
  generated content.
- **PPTX deck:** the template's `htmlSlides[content.templateIndex]`.

New endpoint: `GET /api/presentations/:id/slides/:order/template-html`,
returning the base HTML for one slide. It is immutable for a given slide, so it
is cacheable, and fetching per slide keeps the presentation payload from
carrying every template slide's inlined base64 images (a 17-slide ZIP template
runs to megabytes).

### Merging edits in the browser

`applyObjectEdits(baseHtml, objectEdits)` — a pure function in
`packages/shared`, unit-testable without a DOM harness beyond `DOMParser`.

For each edit, locate `[data-object-id="…"]` and apply: `text`, `cells`,
geometry (`left`/`top`/`width`/`height`), `color`/`fontSize`/`fontFamily`/
`bold`/`italic`, `fillColor`/`lineColor`/`lineWidth`, `rotation`, `delete`.

Applied locally on every keystroke, so feedback is instant and no round trip is
involved. The debounced save to the API is unchanged.

**How `text` lands on an object that has several runs.** An unedited object
renders its original spans untouched, so it keeps its bold sub-headings and
mixed colours. Once an edit carries `text`, that object's text container is
replaced by a *single* span carrying the first run's style — deliberately
mirroring what `shape.text = …` does on export in this phase. The canvas must
not display formatting the exported file will not have. Phase 2 removes the
flattening from both sides at once.

### In-place text editing

`contentEditable` on the object's text container — not an overlay, not a
textarea. Because the DOM *is* the slide, the object's own background, borders
and neighbours stay visible while the caret is in it.

Interaction matches Google Slides: single click selects the object and shows
handles; double-click or Enter puts the caret into the text; Escape returns to
object selection.

Phase 1 writes plain text back to `objectEdits[id].text`. The stored contract
is unchanged, so export keeps working exactly as today.

### Renderer: emit the object id

`pptx_to_html.py` builds the HTML and the object map in the same loop, so they
are positionally aligned — but the HTML carries no id, and binding edits by
array position would break the moment either list changes.

Add `data-object-id="{shape.shape_id}"` to all five emitted object kinds
(inlined image, image placeholder, table, textbox, shape) at
`pptx_to_html.py:234-271`. Teach the parser in
`apps/renderer/src/services/html_template.py:89-107` to read it back.

Existing PPTX templates backfill through the endpoint that already exists,
`POST /api/admin/templates/:id/reextract-pptx`.

ZIP templates authored outside JaSlide may have no `data-object-id`. Fall back
to the element's index among `[data-object="true"]`, which is already how the
ZIP path keys its edits (`htmlTextFields[index]`).

### Fonts

Self-host NanumGothic and Noto Sans CJK KR — the families the renderer actually
resolves to — as webfonts served by the web app. The network is closed, so no
external CDN.

No mapping table is needed in the browser: the extracted HTML already names the
real per-run font. Only availability is missing.

Use `font-display: block` on the canvas so slide text never paints in a
fallback face and then reflow.

### Extractor fidelity fixes

Both are visible in the new canvas because it renders this HTML directly:

- **Table cell vertical anchor.** Emit `vertical-align` from the cell's
  `text_frame.vertical_anchor`, defaulting to top. Cells currently centre.
- **Table cell borders.** Emit the table's line style so borders match the deck.

### What gets deleted

- The white-background `<textarea>` in both editor branches.
- `previewStale` and the opaque double-text-prevention overlay it drives.
- `nativeTextStyle` and the `/5.4cqh`, `/4`, `Math.max(12, …)` approximations.
- The percentage geometry conversions (`/19.2`, `/10.8`) at every call site.

### Data flow

```
base slide HTML  (fetched once per slide, cached)
      │
      ├─ + objectEdits ─► SlideCanvas DOM ◄── user types (contentEditable)
      │                          │
      │                          └─► objectEdits updated
      │                                 ├─► local re-merge (instant)
      │                                 └─► debounced PATCH /slides/:id
      │
      └─ thumbnails & "일반 보기" ─► server PNG (pipeline unchanged)
```

Export is untouched: `objectEdits` → python-pptx → native `.pptx`.

### Error handling

- **No base HTML** for the slide (missing `htmlSlides[templateIndex]`, template
  deleted, blank string): fall back to today's PNG canvas rather than a blank
  stage, and log the reason. A slide must never render empty.
- **Endpoint failure:** keep the last good HTML; if there is none, PNG canvas.
- **Webfont load failure:** the HTML's own font stack still applies; degrade to
  the system fallback rather than blocking the render.
- **An edit whose `objectId` matches nothing** in the HTML is skipped, not
  thrown. A stale edit must not blank a slide.

### Testing

- **Unit (`packages/shared`):** `applyObjectEdits` — text replacement, cell
  fill, geometry, delete, unknown id skipped, malformed edit ignored.
- **Unit (web):** pointer-delta conversion at a given scale; base-HTML
  selection per template kind and its fallback.
- **Renderer:** `data-object-id` present on every emitted object kind; table
  vertical anchor and border style emitted.
- **Visual:** the same slide rendered through SlideCanvas and through
  `/api/render/preview`, compared side by side, for both reference files
  (the PPTX weekly report and the 17-slide ZIP deck).
- **Regression:** existing export tests stay green — the export contract does
  not change in this phase.

### Acceptance

1. Typing in a text box shows no white rectangle; the slide's background, table
   cell fills and borders remain visible throughout.
2. On-screen text during editing matches the "일반 보기" render in family, size
   and colour.
3. Both reference files edit correctly: the PPTX weekly-report table and the
   ZIP deck's data table.
4. Exported `.pptx` remains natively editable and unchanged in content from
   today for an unedited deck.

## Out of scope for phase 1

**Phase 2 — character-level formatting.** Select part of a paragraph and change
its weight, colour or size; nested bullet levels; editing that preserves the
per-run spans instead of flattening them. This also fixes the
`shape.text = …` data loss, by sending `paragraphs`/runs rather than a flat
string. Smaller than it looks: the run data already exists in the HTML and in
`source.slides[].objects[].paragraphs`, and `_apply_native_edit` already has a
`paragraphs` branch (`pptx_generator.py:369-378`).

**Phase 3 — chrome.** Ruler, a formatting toolbar that reflects the caret's
actual formatting, and autofit parity with the renderer's `_shrink_text_to_fit`.

## Risks

- **Browser/renderer divergence.** Accepted by decision 2 and bounded by
  keeping "일반 보기" as the server-rendered check.
- **Payload size.** PPTX slides inline base64 images up to a cap; per-slide
  fetching bounds this and the response is cacheable.
- **ZIP templates without ids** rely on element ordering. Stable in practice
  because the same stored HTML string is both the key and the render source.
- **`contentEditable` quirks** (browser-inserted markup on paste, IME
  composition for Korean input). Phase 1 stores plain text, so normalise on
  input and test IME composition explicitly.
