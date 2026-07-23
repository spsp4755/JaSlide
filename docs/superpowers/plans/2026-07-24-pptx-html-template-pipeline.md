# PPTX and HTML Template Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the editable source format for uploaded PPTX and HTML ZIP templates while providing one TaeSlide editing experience.

**Architecture:** Store template kind and source metadata in the existing template `config` JSON. PPTX export starts from the stored original deck and applies object-targeted updates with `python-pptx`; HTML ZIP export uses the existing HTML object parser to create native editable PPTX objects. The editor continues to send object-level edits rather than full-slide rewrites.

**Tech Stack:** NestJS, Prisma JSON config, Python `python-pptx`, existing renderer FastAPI, React/Next.js.

## Global Constraints

- Keep every component usable without network access.
- Preserve unsupported native PPTX objects unchanged; do not flatten them silently.
- Reuse the existing `data-object` HTML convention and `Slide.content` JSON column.
- Preserve both template kinds; do not replace ZIP support with PPTX-only code.

---

### Task 1: Persist template kind and PPTX object map

**Files:**
- Modify: `apps/renderer/src/services/pptx_to_html.py`
- Modify: `apps/api/src/modules/admin/templates/admin-templates.service.ts`
- Modify: `apps/api/src/modules/skills/skills.service.ts`
- Test: `apps/renderer/tests/test_pptx_to_html.py`
- Test: `apps/api/src/modules/admin/templates/admin-templates.service.spec.ts`

**Interfaces:**
- Produces `config.source = { kind: 'pptx', storageKey, slides: [{ index, objects }] }` for PPTX.
- Produces `config.source = { kind: 'html_zip', storageKey }` for ZIP.

- [ ] **Step 1: Write failing renderer tests**

```python
result = pptx_to_html(sample_pptx_bytes)
assert result["source"]["kind"] == "pptx"
assert result["source"]["slides"][0]["objects"][0]["id"]
assert result["source"]["slides"][0]["objects"][0]["kind"] == "table"
```

- [ ] **Step 2: Run the focused renderer test**

Run: `pytest apps/renderer/tests/test_pptx_to_html.py -q`
Expected: FAIL because `source` is absent.

- [ ] **Step 3: Add the minimum map during PPTX conversion**

```python
objects.append({"id": str(shape.shape_id), "kind": "table", "index": shape_index})
return {**tokens, "htmlSlides": html_slides, "source": {"kind": "pptx", "slides": maps}}
```

- [ ] **Step 4: Persist source metadata alongside the existing storage key**

```ts
config: { ...extracted, source: { ...extracted.source, storageKey: uploaded.key } }
```

- [ ] **Step 5: Run focused tests and commit**

Run: `pytest apps/renderer/tests/test_pptx_to_html.py -q; pnpm --filter @jaslide/api test -- admin-templates.service.spec.ts`
Expected: PASS.

```bash
git add apps/renderer/src/services/pptx_to_html.py apps/renderer/tests/test_pptx_to_html.py apps/api/src/modules/admin/templates apps/api/src/modules/skills
git commit -m "feat: store native PPTX template object maps"
```

### Task 2: Apply PPTX edits to a copy of the original deck

**Files:**
- Modify: `apps/renderer/src/generators/pptx_generator.py`
- Test: `apps/renderer/tests/test_pptx_generator.py`

**Interfaces:**
- Consumes `template_config.source.kind === 'pptx'`, stored source bytes and `Slide.content.objectEdits`.
- Produces a PPTX containing native text/table/shape objects.

- [ ] **Step 1: Write failing native-object export test**

```python
deck = generate_from_pptx_template(template_bytes, [{"objectId": "7", "text": "새 주간 보고"}])
prs = Presentation(BytesIO(deck))
assert prs.slides[0].shapes[7].has_text_frame
assert "새 주간 보고" in prs.slides[0].shapes[7].text
```

- [ ] **Step 2: Run it**

Run: `pytest apps/renderer/tests/test_pptx_generator.py -q`
Expected: FAIL because generation creates a blank deck.

- [ ] **Step 3: Add a native-template branch before `_reset_presentation()`**

```python
self.prs = PPTXPresentation(BytesIO(template_bytes))
for edit in object_edits:
    shape = next(shape for shape in self.prs.slides[edit["slide"]].shapes if str(shape.shape_id) == edit["objectId"])
    apply_edit(shape, edit)
```

- [ ] **Step 4: Implement only text, table cells, bounds, fill and line edits**

Use `shape.text_frame`, `shape.table.cell(row, col)`, `shape.left/top/width/height`, and existing `RGBColor` helpers. Leave unrecognised objects unchanged.

- [ ] **Step 5: Run focused tests and commit**

Run: `pytest apps/renderer/tests/test_pptx_generator.py -q`
Expected: PASS and reopened deck has native objects.

```bash
git add apps/renderer/src/generators/pptx_generator.py apps/renderer/tests/test_pptx_generator.py
git commit -m "feat: export editable slides from PPTX templates"
```

### Task 3: Make generation use template slots, not full HTML rewrites

**Files:**
- Modify: `apps/api/src/modules/generation/generation.service.ts`
- Modify: `apps/api/src/modules/llm/prompt-template.service.ts`
- Test: `apps/api/src/modules/generation/generation.service.spec.ts`

**Interfaces:**
- Produces `content.objectEdits: Array<{ objectId: string; text?: string; cells?: string[][] }>` for PPTX.
- Keeps `content.html` for HTML ZIP templates.

- [ ] **Step 1: Write a failing generation test**

```ts
expect(createdSlide.content).toEqual(expect.objectContaining({ objectEdits: [expect.objectContaining({ objectId: '7' })] }));
expect(createdSlide.content).not.toHaveProperty('html');
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @jaslide/api test -- generation.service.spec.ts`
Expected: FAIL because all templates produce HTML.

- [ ] **Step 3: Branch by `config.source.kind`**

```ts
const isPptx = templateConfig.source?.kind === 'pptx';
const content = isPptx ? { ...generated, objectEdits } : { ...generated, html };
```

- [ ] **Step 4: Keep ZIP behavior unchanged and add explicit fallback**

If AI cannot select a compatible native slot, retain the selected source slide and record no edit rather than synthesizing a generic layout.

- [ ] **Step 5: Run focused tests and commit**

Run: `pnpm --filter @jaslide/api test -- generation.service.spec.ts`
Expected: PASS.

```bash
git add apps/api/src/modules/generation/generation.service.ts apps/api/src/modules/llm/prompt-template.service.ts apps/api/src/modules/generation/generation.service.spec.ts
git commit -m "feat: generate PPTX template edits by object"
```

### Task 4: Route manual and AI edits through the shared object contract

**Files:**
- Modify: `apps/web/src/app/editor/[id]/page.tsx`
- Modify: `apps/api/src/modules/generation/generation.service.ts`
- Test: `apps/web/test/taeslide-object-editing.test.js`
- Test: `apps/api/src/modules/generation/generation.service.spec.ts`

**Interfaces:**
- Consumes selected object ID and one property update from editor controls or AI chat.
- Produces a persisted `objectEdits` entry for PPTX or a DOM edit for HTML ZIP.

- [ ] **Step 1: Write failing editor tests**

```js
assert.match(editor, /objectEdits/);
assert.match(editor, /selectedObjectId/);
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @jaslide/web test -- taeslide-object-editing.test.js`
Expected: FAIL because only HTML indexes are persisted.

- [ ] **Step 3: Store PPTX edits by mapped `objectId`**

```ts
const objectEdits = upsertObjectEdit(content.objectEdits ?? [], selectedObjectId, patch);
updateSlide(slide.id, { content: { ...content, objectEdits } });
```

- [ ] **Step 4: Make AI edit return the same patches**

PPTX AI edit updates only mapped text/table slots. HTML AI edit remains `editSlideHtml`.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm --filter @jaslide/web test; pnpm --filter @jaslide/api test -- generation.service.spec.ts`
Expected: PASS.

```bash
git add apps/web/src/app/editor/[id]/page.tsx apps/web/test/taeslide-object-editing.test.js apps/api/src/modules/generation
git commit -m "feat: edit native PPTX template objects in TaeSlide"
```

### Task 5: End-to-end template-fidelity verification

**Files:**
- Test: `apps/renderer/tests/test_pptx_generator.py`
- Test: `apps/renderer/tests/test_pptx_to_html.py`
- Modify: `docker/renderer.Dockerfile` only if required fonts are missing.

- [ ] **Step 1: Add supplied-deck regression fixtures outside Git**

Use `C:\Users\USER\Downloads\박태지_0723_업무보고_AI엔지니어링.pptx` and `C:\Users\USER\Downloads\ai-safety-red-team-report.zip`; do not add user decks to the repository.

- [ ] **Step 2: Test native round-trip**

Run conversion, generate one weekly-report slide, export, reopen with `python-pptx`, then assert table count, text font and native object count match the template baseline.

- [ ] **Step 3: Test ZIP round-trip**

Generate from the ZIP, inspect the editor preview and exported PPTX for expected slide count, text and object placement.

- [ ] **Step 4: Build and deploy locally**

Run: `pnpm --filter @jaslide/api test; pnpm --filter @jaslide/web test; pnpm --filter @jaslide/web build; docker compose build api renderer web; docker compose up -d api renderer web`
Expected: all commands pass and `http://localhost:3100` responds with 200.

- [ ] **Step 5: Commit verification changes**

```bash
git add apps/renderer/tests docker/renderer.Dockerfile
git commit -m "test: verify editable template exports"
```
