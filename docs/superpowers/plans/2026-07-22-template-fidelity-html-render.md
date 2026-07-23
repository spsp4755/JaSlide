# Template-Fidelity HTML Render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render generated HTML-template slides through Chromium so preview, PDF, and PPTX exports preserve the template design.

**Architecture:** `Slide.content.html` becomes the optional render source. The renderer uses Playwright to capture it and either returns the image/PDF directly or embeds a full-slide image in PPTX. Legacy structured slides retain the present `python-pptx`/LibreOffice path.

**Tech Stack:** NestJS, Prisma JSON content, Python FastAPI, Playwright Chromium, python-pptx, pytest, Jest.

## Global Constraints

- Keep `content.html` optional; existing presentations render through the legacy path.
- HTML slide failures must return clear errors; never produce a blank placeholder.
- PPTX output for HTML slides is an image-per-slide and is intentionally not natively editable.
- Do not hardcode template/deck names; `templateIndex` selects from `htmlSlides`.
- Preserve the 20 MB template upload limit and existing safe-PPTX package limits.

---

### Task 1: Add the renderer's HTML capture primitive

**Files:**
- Create: `apps/renderer/src/services/html_renderer.py`
- Modify: `apps/renderer/pyproject.toml`
- Modify: `docker/renderer.Dockerfile`
- Test: `apps/renderer/tests/test_html_renderer.py`

**Interfaces:**
- Produces `render_slide_png(html: str, width: int = 1920, height: int = 1080, scale: int = 2) -> bytes`.
- Produces `render_slides_pdf(htmls: list[str], width: int = 1920, height: int = 1080) -> bytes`.

- [ ] Write tests that render a minimal full-canvas HTML slide, assert PNG dimensions/non-empty pixels, and assert a two-slide PDF has two pages.
- [ ] Run `docker run --rm -v "${PWD}:/work" -w /work jaslide-renderer pytest apps/renderer/tests/test_html_renderer.py -q`; expect failure because the module does not exist.
- [ ] Implement a request-scoped Playwright browser context that sets the 1920×1080 viewport, waits for `document.fonts.ready`, and captures PNG/PDF bytes.
- [ ] Add the Python Playwright dependency and Chromium install to the renderer image; retain LibreOffice and Noto CJK fonts.
- [ ] Convert Playwright launch/navigation/timeout exceptions to `RuntimeError("HTML rendering failed: …")`.
- [ ] Re-run the targeted renderer test; expect pass.
- [ ] Commit: `feat(renderer): add Chromium HTML rendering`.

### Task 2: Route HTML slide exports through the renderer

**Files:**
- Modify: `apps/renderer/src/main.py`
- Modify: `apps/renderer/src/generators/pptx_generator.py`
- Modify: `apps/renderer/src/generators/pdf_exporter.py`
- Modify: `apps/renderer/tests/test_pptx_generator.py`
- Modify: `apps/renderer/tests/test_pdf_exporter.py`

**Interfaces:**
- Consumes `slide.content.html: string`.
- `PPTXGenerator.generate()` embeds one full-bleed PNG for an HTML slide; slides without `html` retain the structured generator.
- `/api/render/preview` and `/api/render/pdf` call HTML rendering only when every requested slide has `content.html`; mixed/legacy inputs retain the existing conversion path.

- [ ] Add a failing PPTX generator test using a mocked `render_slide_png`; assert exactly one picture covers `0,0,13.333,7.5` for an HTML slide and that a structured slide has no image.
- [ ] Add endpoint tests that mock `render_slide_png`/`render_slides_pdf`; assert preview/PDF return their bytes rather than invoking LibreOffice.
- [ ] Implement the `content.html` branch in the shared generator and endpoints; keep the current `PDFExporter` APIs unchanged for legacy content.
- [ ] Remove the deck-specific HTML reconstruction methods (`_add_semantic_html_layout`, `_add_threat_model`, `_add_table_row`, `_add_rsp_tier`, `_add_methodology`, `_add_external_evaluators`), because the browser now owns HTML layout.
- [ ] Run `pytest apps/renderer/tests/test_pptx_generator.py apps/renderer/tests/test_pdf_exporter.py -q`; expect pass.
- [ ] Commit: `feat(renderer): export HTML slides without shape reconstruction`.

### Task 3: Convert PPTX templates to HTML slides on import

**Files:**
- Create: `apps/renderer/src/services/pptx_to_html.py`
- Modify: `apps/renderer/src/main.py`
- Modify: `apps/api/src/modules/admin/templates/admin-templates.service.ts`
- Modify: `apps/renderer/tests/test_pptx_to_html.py`
- Modify: `apps/api/src/modules/admin/templates/admin-templates.service.spec.ts`

**Interfaces:**
- Produces `pptx_to_html(pptx_bytes: bytes) -> dict` containing `htmlSlides`, `htmlTemplate`, `archive: { slides, canvas }`, `colors`, and `typography`.
- The existing `POST /api/extract/style` returns that complete config for PPTX imports.

- [ ] Build a synthetic PPTX test fixture with background, textbox, solid rectangle, and one image; assert generated HTML contains scaled absolute positions, escaped text, data URI image, and synthetic `slide-01` metadata.
- [ ] Run the new test; expect failure because `pptx_to_html` is absent.
- [ ] Implement only supported shapes: backgrounds, solid-filled auto shapes, text frames, and pictures. Escape text and embed images under a fixed per-image/total byte cap; skip unsupported shapes instead of failing the full upload.
- [ ] Switch `/api/extract/style` to call the converter and update the admin config guard to require non-empty `htmlSlides` plus archive metadata.
- [ ] Run the converter and admin-template specs; expect pass.
- [ ] Commit: `feat(templates): preserve PPTX layouts as HTML slides`.

### Task 4: Generate HTML per selected template slide

**Files:**
- Modify: `apps/api/src/modules/llm/llm.service.ts`
- Modify: `apps/api/src/modules/llm/prompt-template.service.ts`
- Modify: `apps/api/src/modules/generation/generation.service.ts`
- Modify: `apps/api/src/modules/llm/llm.service.spec.ts`
- Modify: `apps/api/src/modules/generation/generation.service.spec.ts`

**Interfaces:**
- Add `generateSlideHtml({ templateHtml, title, type, keyPoints, language }): Promise<string>`.
- Add `editSlideHtml({ currentHtml, instruction, language }): Promise<string>`.
- `GenerationService` reads `template.config.htmlSlides` and stores `content.html` for successful HTML generation, otherwise stores the existing structured content.

- [ ] Add LLM unit tests for valid HTML acceptance, four invalid replies followed by structured-content fallback, and maximum-token forwarding through `generateValidatedJson`.
- [ ] Implement validation requiring a non-empty document with a slide container and `data-object="true"`; preserve the exact template structure instruction and limit changes to human-readable text.
- [ ] In `processGeneration`, resolve the selected exemplar from `templateIndex`; call `generateSlideHtml` when a matching `htmlSlides` element exists, then retain `heading`, `body`, and `bullets` as fallback metadata.
- [ ] If HTML generation exhausts retries, log the slide failure and persist structured content instead of failing the job.
- [ ] Run `pnpm --filter api test -- --runInBand src/modules/llm/llm.service.spec.ts src/modules/generation/generation.service.spec.ts`; expect pass.
- [ ] Commit: `feat(generation): create template-faithful HTML slides`.

### Task 5: Extend AI edit and make HTML state explicit in the editor

**Files:**
- Modify: `apps/api/src/modules/generation/generation.service.ts`
- Modify: `apps/api/src/modules/generation/generation.service.spec.ts`
- Modify: `apps/web/src/app/editor/[id]/page.tsx`
- Modify: `apps/web/test/outline-approval.test.js`

**Interfaces:**
- `aiEdit` branches on `typeof slide.content.html === 'string'` and stores edited HTML.
- The editor disables/hides structured property controls for HTML slides and retains the AI edit action.

- [ ] Add API tests asserting an HTML slide calls `editSlideHtml`, while a legacy slide still calls `editSlideContent`.
- [ ] Implement the branch without changing the existing multi-slide edit response shape.
- [ ] Add a focused web test that HTML content hides the structured title/body inputs but leaves preview and AI edit reachable.
- [ ] Run the API unit tests and `pnpm --filter @jaslide/web test -- outline-approval.test.js`; expect pass.
- [ ] Commit: `feat(editor): route HTML slides through AI editing`.

### Task 6: Verify the real template end to end

**Files:**
- Test: `apps/renderer/tests/test_html_renderer.py`
- Test: `apps/api/src/modules/generation/generation.service.spec.ts`
- No production file changes expected.

- [ ] Import `ai-safety-red-team-report.zip`, generate a short deck, and render each preview/PDF/PPTX export through the deployed renderer.
- [ ] Compare generated preview dimensions and non-background pixel regions with the ZIP reference previews; record only meaningful visual regressions.
- [ ] Run the complete targeted suites: `pytest apps/renderer/tests -q`, `pnpm --filter api test -- --runInBand`, and `pnpm --filter @jaslide/web build`.
- [ ] Commit any test-only regression coverage: `test: cover template-fidelity rendering`.
