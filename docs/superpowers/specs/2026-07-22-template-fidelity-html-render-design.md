# Template-Fidelity Generation via Headless-Browser HTML Rendering

Date: 2026-07-22
Status: Approved (design)

## Problem

Uploaded templates are rich HTML/CSS (ZIP) or PPTX decks. Generated presentations
do not look like the template. Root cause: every output path (PPTX, PDF, preview)
reconstructs the design as native `python-pptx` shapes, which cannot reproduce CSS
layout, HTML tables, gradients, web fonts, or badges. The current renderer even
hardcodes bespoke layouts to one specific deck's slide names
(`_add_semantic_html_layout`, `_add_threat_model`, `_add_rsp_tier`,
`_add_methodology`, `_add_external_evaluators`), so it does not generalize.

## Goal

Make generated slides match the uploaded template pixel-for-pixel, for **both**
template kinds:
- **ZIP HTML template** — already ships per-slide HTML.
- **PPTX template** — currently reduced to color/font tokens + a title/body layout
  hint; design is discarded.

## Approach

The template is (or becomes) HTML, so render it with a real browser (Chromium)
and swap in AI-generated content. This is the Gamma/Genspark model.

### Unify both template kinds into "HTML slides"

```
upload ─┬─ ZIP  → (already) HTML slides
        └─ PPTX → pptx_to_html → HTML slides
                                     │
        generate: template slide HTML (exemplar) + keyPoints → content.html (content swap)
                                     │
        Chromium render → preview PNG / PDF / PPTX (image per slide)
```

Downstream (generation + render) is identical for both kinds. One pipeline.

## Decisions (confirmed with user)

1. **Rendering:** headless browser (Chromium). Accepted tradeoff: PPTX export is
   image-per-slide (not natively text-editable in PowerPoint), heavier renderer
   image, more tokens for full-HTML generation.
2. **Editing:** AI-edit–centric. Slide HTML is the source of truth; edits are made
   by the AI-edit flow (natural language) operating on the HTML. Quick inline text
   edits (contenteditable) are a later phase. The existing structured editor is
   superseded for HTML slides.
3. **PPTX templates must work as a generation basis** — not just ZIP.

## Data model

- Add `html` to `Slide.content` JSON: the slide's full HTML (render source of truth).
- Keep structured fields (`heading/subheading/body/bullets/chart`) for backward
  compatibility. Render uses `content.html` when present; otherwise the existing
  structured `python-pptx` path (old presentations keep working).
- Template `config` for both kinds ends up with `htmlSlides: string[]` (already true
  for ZIP; PPTX import now populates it via conversion) plus existing
  `colors`/`typography` tokens and `zipTemplate.slides` name metadata (PPTX supplies
  synthetic slide names, e.g. `slide-01`).

## Components

### 1. `apps/renderer/src/services/pptx_to_html.py` (new)
Convert an uploaded PPTX into per-slide absolute-positioned HTML on a 1920×1080
canvas (matching the ZIP `data-object` convention):
- For each slide, each shape → a positioned `<div>` (`left/top/width/height` in px,
  scaled from EMU/inches to the 1920×1080 canvas).
- Text frames → text divs with font family, size, weight, color, alignment.
- Solid fills → shape divs with `background`.
- Pictures → `<img>` with the blob embedded as a `data:` URI.
- Slide background fill → container `background`.
- Emit `data-object="true"` / `data-object-type="textbox"|"shape"` so the same
  parsers/generators recognize it.
- Returns the same dict shape as `extract_html_template_archive`:
  `{ htmlSlides, htmlTemplate, archive: { slides: [...synthetic names...], canvas } }`
  plus `colors`/`typography` from the existing extractor.

### 2. `apps/renderer/src/services/html_renderer.py` (new)
Headless Chromium (Playwright) renderer:
- `render_slide_png(html: str, width=1920, height=1080, scale=2) -> bytes`
- `render_slides_pdf(htmls: list[str], canvas) -> bytes` — Chromium print-to-pdf per
  slide at exact canvas size, merged.
- Reuse a single browser instance per request batch (launch once, render N, close).
- Waits for fonts/network idle before capture.

### 3. `apps/renderer/src/generators/pptx_generator.py` (change)
- When a slide has `content.html`: render it to PNG via `html_renderer` and place it
  as a full-bleed picture (0,0 → 13.333"×7.5"). No shape reconstruction.
- When no `html`: keep the existing structured layout path (backward compat).
- **Delete** the hardcoded, deck-specific methods: `_add_semantic_html_layout`,
  `_add_threat_model`, `_add_table_row`, `_add_rsp_tier`, `_add_methodology`,
  `_add_external_evaluators`. (The generic structured path — `_add_title_slide`,
  `_add_content_slide`, etc. — stays for the no-template/backward-compat case.)

### 4. `apps/renderer/src/generators/pdf_exporter.py` / preview (change)
- HTML slides: preview PNG and PDF come from `html_renderer` directly (skip
  PPTX→PDF→PNG). Structured slides keep the LibreOffice path.

### 5. `apps/renderer/src/main.py` (change)
- Wire `import-pptx` to use `pptx_to_html` (full design retained) instead of the
  tokens-only `extract_template_tokens`.
- Render endpoints branch on presence of `content.html`.

### 6. `apps/api` — `LlmService` (change)
- New `generateSlideHtml(templateSlideHtml, slide, language) -> string`:
  give the chosen template slide's HTML as an exemplar + the slide's keyPoints;
  instruct: "return a complete HTML slide with identical structure, classes, inline
  styles, positions, and table markup — change only the human-readable text content
  to fit the new topic." Validate: non-empty, contains a slide container / `data-object`
  / `<body`. Respects admin `maxTokens` (same `Number.MAX_SAFE_INTEGER` clamp pattern).
- `generation.service`: when the template has `htmlSlides`, produce `content.html`
  per slide (one call each, using `templateIndex` to pick the exemplar). Otherwise
  fall back to structured `generateSlideContent`.
- AI edit (`editSlideContent`): when the slide has `content.html`, edit the HTML
  (LLM rewrites the HTML per instruction, same validated path) instead of the
  structured object.

### 7. `apps/web` — editor (change)
- Preview already renders the server image; it becomes pixel-perfect automatically.
- AI edit dialog already calls `/generation/edit`; no change needed for HTML slides
  (backend branches). Structured property panel is hidden/N-A for HTML slides.
- Contenteditable quick edits: later phase.

## Template-index selection

Keep the existing outline `templateIndex` mechanism (LLM picks the best template
slide per generated slide from the full catalog). `pptx_to_html` supplies synthetic
slide names so keyword matching still has something to work with; when names are
uninformative, the even-spread fallback applies. No hardcoded deck names.

## Phases

1. **Renderer HTML rendering + exports.** Add Playwright/Chromium to
   `renderer.Dockerfile`; `html_renderer.py`; wire preview/PDF/PPTX for slides that
   carry `html`. Verify by rendering raw ZIP template HTML directly.
2. **PPTX → HTML conversion.** `pptx_to_html.py`; switch `import-pptx` to it.
3. **Generation produces `content.html`.** `generateSlideHtml`; branch in
   `generation.service`.
4. **AI edit on HTML.** Extend `editSlideContent` for HTML slides.
5. **(Later)** contenteditable quick text edits in the editor.

## Error handling

- Chromium launch/timeout failures raise a clear renderer error (like the existing
  "LibreOffice is required" contract); never emit a blank/placeholder slide silently.
- `generateSlideHtml` validation failure retries (existing 4-attempt loop), then
  falls back to structured content for that slide rather than failing the whole job.
- `pptx_to_html` on a malformed/complex PPTX: convert what it can; shapes it cannot
  represent are skipped (logged), not fatal.
- Image embedding cap: skip/scale images beyond a size budget to bound HTML size.

## Testing

- Renderer pytest:
  - `html_renderer`: HTML → PNG is non-blank and of expected dimensions; PDF has N
    pages.
  - `pptx_to_html`: a small synthetic PPTX yields positioned divs with expected
    coordinates/text; images embed as data URIs.
  - `pptx_generator`: a slide with `html` embeds exactly one full-bleed image;
    a slide without `html` still uses the structured path (backward compat).
- API jest:
  - `generateSlideHtml` returns validated HTML (mocked LLM); falls back to structured
    on repeated invalid output.
  - AI edit routes to HTML edit when `content.html` present.
- E2E: generate from the real `ai-safety-red-team-report.zip`, export, and compare
  against the ZIP's own `previews/*.png` reference images.

## Out of scope

- Native text-editable PPTX for HTML slides (image-based is the accepted tradeoff).
- contenteditable inline editing (Phase 5, later).
- Animations/transitions from templates.

## Risks

- LLM may drift from the template's styling during content swap. Mitigation: strong
  "change only text" prompt; validation; optionally constrain edits to inner content
  while preserving the outer container/CSS.
- Full-HTML generation is token- and time-heavy. Mitigation: admin `maxTokens` is
  configurable; per-slide independent calls can run concurrently.
- Chromium in the renderer image (~450MB) and per-render latency. Mitigation: reuse
  one browser instance per request batch.
