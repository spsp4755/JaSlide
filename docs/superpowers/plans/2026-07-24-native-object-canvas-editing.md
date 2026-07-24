# Native PPTX Object Direct-Canvas Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users edit a native PPTX text box's text and a native table's cell text directly on the slide canvas (click/double-click, like PowerPoint), instead of only through the right-side property panel — and close the geometry/alignment gap between the editor's overlay and the real rendered PPTX.

**Architecture:** Renderer extraction (`pptx_to_html.py`) gains per-table `rowHeights`/`columnWidths` and per-text-object `align`. The renderer's edit-application code (`pptx_generator.py`) preserves paragraph alignment across text replacement (a standalone bug fix). The web editor's native-object overlay (currently an empty move/resize box) gains an in-place double-click-to-edit `<textarea>` for text objects and a cell-grid of double-click-to-edit `<textarea>`s for tables, both committing through the existing `updateNativeObject` function — no backend/API schema change.

**Tech Stack:** Python (FastAPI, python-pptx, pytest) for the renderer; TypeScript/React (Next.js) for the web editor; Node's built-in `node:test` for web tests (this repo's web tests are source-pattern assertions via `fs.readFileSync` + `assert.match`, not rendered-component tests — follow that existing convention).

## Global Constraints

- No backend/API schema changes — `objectEdits[].text` and `objectEdits[].cells` keep their exact current shape.
- No drag-to-resize of table rows/columns in this pass.
- No per-cell text alignment extraction or rendering in this pass.
- No changes to shape/line/image overlay behavior (they carry no editable text).
- Every renderer change needs a real pytest test that fails before the fix and passes after (this repo has no CI job running these tests — you must run them manually via the running `jaslide-renderer`/`jaslide-api` Docker containers, copying files in with `docker cp` since the containers don't mount the source as a volume).
- Web tests follow the existing `apps/web/test/*.test.js` convention: read the source file as text and assert regex patterns exist/don't exist. Run with `node --test ./test/*.test.js` from `apps/web/`.

---

### Task 1: Preserve paragraph alignment when a native text box's text is replaced

**Files:**
- Modify: `apps/renderer/src/generators/pptx_generator.py:268-272`
- Test: `apps/renderer/tests/test_pptx_generator.py`

**Interfaces:**
- Consumes: nothing new — this is a pure bug fix inside the existing `_apply_native_edit(self, edit: dict, slide: Any) -> None` method.
- Produces: nothing new for later tasks to consume.

- [ ] **Step 1: Write the failing test**

Add to `apps/renderer/tests/test_pptx_generator.py` (needs `from pptx.enum.text import PP_ALIGN` added to the existing import block at the top of the file, alongside the existing `from pptx.enum.dml import MSO_THEME_COLOR` import):

```python
def test_pptx_text_replace_preserves_paragraph_alignment():
    source = Presentation(); slide = source.slides.add_slide(source.slide_layouts[6])
    text = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(4), Inches(1))
    text.text = "Original"
    text.text_frame.paragraphs[0].alignment = PP_ALIGN.CENTER
    buffer = BytesIO(); source.save(buffer)
    template = SimpleNamespace(config=SimpleNamespace(sourcePptx=base64.b64encode(buffer.getvalue()).decode("ascii")))

    output = PPTXGenerator(template).generate(_presentation(_slide("CONTENT", "", {
        "objectEdits": [{"slide": 0, "objectId": str(text.shape_id), "text": "Changed"}],
    })))

    paragraph = Presentation(BytesIO(output)).slides[0].shapes[0].text_frame.paragraphs[0]
    assert paragraph.text == "Changed"
    assert paragraph.alignment == PP_ALIGN.CENTER
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker exec jaslide-renderer sh -c "rm -rf /test_root && mkdir -p /test_root/apps"
docker cp "apps/renderer" jaslide-renderer:/test_root/apps/renderer
docker exec jaslide-renderer pip install --quiet pytest httpx
docker exec -w /test_root jaslide-renderer python -m pytest apps/renderer/tests/test_pptx_generator.py -q -k test_pptx_text_replace_preserves_paragraph_alignment
```

Expected: FAIL — `assert None == PP_ALIGN.CENTER` (alignment is lost because the fresh paragraph created by `shape.text = ...` defaults to no explicit alignment).

- [ ] **Step 3: Write minimal implementation**

In `apps/renderer/src/generators/pptx_generator.py`, replace:

```python
        elif isinstance(edit.get("text"), str) and getattr(shape, "has_text_frame", False):
            levels = [paragraph.level for paragraph in shape.text_frame.paragraphs]
            shape.text = edit["text"]
            for index, paragraph in enumerate(shape.text_frame.paragraphs):
                paragraph.level = levels[min(index, len(levels) - 1)] if levels else 0
```

with:

```python
        elif isinstance(edit.get("text"), str) and getattr(shape, "has_text_frame", False):
            levels = [paragraph.level for paragraph in shape.text_frame.paragraphs]
            alignments = [paragraph.alignment for paragraph in shape.text_frame.paragraphs]
            shape.text = edit["text"]
            for index, paragraph in enumerate(shape.text_frame.paragraphs):
                paragraph.level = levels[min(index, len(levels) - 1)] if levels else 0
                paragraph.alignment = alignments[min(index, len(alignments) - 1)] if alignments else None
```

- [ ] **Step 4: Run test to verify it passes**

```bash
docker cp "apps/renderer/src/generators/pptx_generator.py" jaslide-renderer:/test_root/apps/renderer/src/generators/pptx_generator.py
docker exec -w /test_root jaslide-renderer python -m pytest apps/renderer/tests/test_pptx_generator.py -q
```

Expected: all tests pass (this repo has 2 pre-existing unrelated failures in other test files from before this plan — `test_pptx_to_html.py::test_preserves_table_cell_dimensions_and_formatting` and `test_style_extractor.py::test_extract_style_upload_returns_only_config_tokens`; confirm those specific two are the only other failures, if any, and that nothing in `test_pptx_generator.py` regressed).

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/generators/pptx_generator.py apps/renderer/tests/test_pptx_generator.py
git commit -m "fix: preserve paragraph alignment when replacing native text"
```

---

### Task 2: Preserve paragraph alignment when a native table cell's text is replaced

**Files:**
- Modify: `apps/renderer/src/generators/pptx_generator.py:296-318` (table `cells` branch of `_apply_native_edit`)
- Test: `apps/renderer/tests/test_pptx_generator.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

```python
def test_pptx_table_cell_replace_preserves_paragraph_alignment():
    source = Presentation(); slide = source.slides.add_slide(source.slide_layouts[6])
    table = slide.shapes.add_table(1, 1, Inches(1), Inches(1), Inches(4), Inches(2))
    cell = table.table.cell(0, 0); cell.text = "Original"
    cell.text_frame.paragraphs[0].alignment = PP_ALIGN.RIGHT
    buffer = BytesIO(); source.save(buffer)
    template = SimpleNamespace(config=SimpleNamespace(sourcePptx=base64.b64encode(buffer.getvalue()).decode("ascii")))

    output = PPTXGenerator(template).generate(_presentation(_slide("CONTENT", "", {
        "objectEdits": [{"slide": 0, "objectId": str(table.shape_id), "cells": [["Updated"]]}],
    })))

    paragraph = Presentation(BytesIO(output)).slides[0].shapes[0].table.cell(0, 0).text_frame.paragraphs[0]
    assert paragraph.text == "Updated"
    assert paragraph.alignment == PP_ALIGN.RIGHT
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker cp "apps/renderer/tests/test_pptx_generator.py" jaslide-renderer:/test_root/apps/renderer/tests/test_pptx_generator.py
docker exec -w /test_root jaslide-renderer python -m pytest apps/renderer/tests/test_pptx_generator.py -q -k test_pptx_table_cell_replace_preserves_paragraph_alignment
```

Expected: FAIL — `assert None == PP_ALIGN.RIGHT`.

- [ ] **Step 3: Write minimal implementation**

Replace:

```python
                        source_runs = [{"name": run.font.name, "size": run.font.size, "bold": run.font.bold, "italic": run.font.italic, "color": self._safe_rgb(run.font.color)} if (run := (paragraph.runs[0] if paragraph.runs else None)) else None for paragraph in source]
                        levels = [paragraph.level for paragraph in source]
                        cell.text = value
                        for index, paragraph in enumerate(cell.text_frame.paragraphs):
                            paragraph.level = levels[min(index, len(levels) - 1)] if levels else 0
                            source_run = source_runs[min(index, len(source_runs) - 1)] if source_runs else None
                            if source_run and paragraph.runs:
                                run = paragraph.runs[0]
                                run.font.name = source_run["name"]
                                run.font.size = source_run["size"]
                                run.font.bold = source_run["bold"]
                                run.font.italic = source_run["italic"]
                                if source_run["color"]:
                                    run.font.color.rgb = source_run["color"]
```

with:

```python
                        source_runs = [{"name": run.font.name, "size": run.font.size, "bold": run.font.bold, "italic": run.font.italic, "color": self._safe_rgb(run.font.color)} if (run := (paragraph.runs[0] if paragraph.runs else None)) else None for paragraph in source]
                        levels = [paragraph.level for paragraph in source]
                        alignments = [paragraph.alignment for paragraph in source]
                        cell.text = value
                        for index, paragraph in enumerate(cell.text_frame.paragraphs):
                            paragraph.level = levels[min(index, len(levels) - 1)] if levels else 0
                            paragraph.alignment = alignments[min(index, len(alignments) - 1)] if alignments else None
                            source_run = source_runs[min(index, len(source_runs) - 1)] if source_runs else None
                            if source_run and paragraph.runs:
                                run = paragraph.runs[0]
                                run.font.name = source_run["name"]
                                run.font.size = source_run["size"]
                                run.font.bold = source_run["bold"]
                                run.font.italic = source_run["italic"]
                                if source_run["color"]:
                                    run.font.color.rgb = source_run["color"]
```

- [ ] **Step 4: Run test to verify it passes**

```bash
docker cp "apps/renderer/src/generators/pptx_generator.py" jaslide-renderer:/test_root/apps/renderer/src/generators/pptx_generator.py
docker exec -w /test_root jaslide-renderer python -m pytest apps/renderer/tests/test_pptx_generator.py -q
```

Expected: all pass (same 2 pre-existing unrelated failures elsewhere allowed, none in this file).

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/generators/pptx_generator.py apps/renderer/tests/test_pptx_generator.py
git commit -m "fix: preserve paragraph alignment when replacing native table cell text"
```

---

### Task 3: Extract per-row/per-column table geometry

**Files:**
- Modify: `apps/renderer/src/services/pptx_to_html.py:130`
- Test: `apps/renderer/tests/test_pptx_to_html.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: table `source_object` dicts (returned from `pptx_to_html()` inside `source["slides"][i]["objects"]`, and served by `POST /api/extract/style`) now include `rowHeights: list[int]` and `columnWidths: list[int]`, in the same 1920x1080 canvas-pixel space as `left/top/width/height`. Task 5 (web) reads these two fields.

- [ ] **Step 1: Write the failing test**

Add to `apps/renderer/tests/test_pptx_to_html.py` (check the existing import block at the top of that file for `Presentation`, `Inches`, `BytesIO`, `pptx_to_html` — reuse them; add `from pptx.util import Emu` only if not already imported):

```python
def test_extracts_real_row_and_column_geometry_for_a_table():
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    table = slide.shapes.add_table(2, 2, Inches(1), Inches(1), Inches(6), Inches(3)).table
    table.rows[0].height = Inches(1)
    table.rows[1].height = Inches(2)
    table.columns[0].width = Inches(4)
    table.columns[1].width = Inches(2)

    buffer = BytesIO()
    presentation.save(buffer)

    result = pptx_to_html(buffer.getvalue())
    table_object = next(obj for obj in result["source"]["slides"][0]["objects"] if obj["kind"] == "table")

    assert table_object["rowHeights"][0] < table_object["rowHeights"][1]
    assert table_object["columnWidths"][0] > table_object["columnWidths"][1]
    # 1in / 3in total row height, scaled to the object's own extracted height
    assert round(table_object["rowHeights"][0] / sum(table_object["rowHeights"]), 2) == round(1 / 3, 2)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker cp "apps/renderer/tests/test_pptx_to_html.py" jaslide-renderer:/test_root/apps/renderer/tests/test_pptx_to_html.py
docker exec -w /test_root jaslide-renderer python -m pytest apps/renderer/tests/test_pptx_to_html.py -q -k test_extracts_real_row_and_column_geometry_for_a_table
```

Expected: FAIL — `KeyError: 'rowHeights'`.

- [ ] **Step 3: Write minimal implementation**

In `apps/renderer/src/services/pptx_to_html.py`, replace line 130:

```python
                source_objects.append({**source_object, "kind": "table", "cells": [[cell.text for cell in row.cells] for row in shape.table.rows]})
```

with:

```python
                row_heights = [_px(row.height, presentation.slide_height, CANVAS_HEIGHT) for row in shape.table.rows]
                column_widths = [_px(column.width, presentation.slide_width, CANVAS_WIDTH) for column in shape.table.columns]
                source_objects.append({
                    **source_object, "kind": "table",
                    "cells": [[cell.text for cell in row.cells] for row in shape.table.rows],
                    "rowHeights": row_heights, "columnWidths": column_widths,
                })
```

- [ ] **Step 4: Run test to verify it passes**

```bash
docker cp "apps/renderer/src/services/pptx_to_html.py" jaslide-renderer:/test_root/apps/renderer/src/services/pptx_to_html.py
docker exec -w /test_root jaslide-renderer python -m pytest apps/renderer/tests/test_pptx_to_html.py -q
```

Expected: all pass except the same pre-existing `test_preserves_table_cell_dimensions_and_formatting` failure (unrelated, predates this plan).

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/services/pptx_to_html.py apps/renderer/tests/test_pptx_to_html.py
git commit -m "feat: extract per-row and per-column table geometry"
```

---

### Task 4: Extract paragraph alignment for text objects

**Files:**
- Modify: `apps/renderer/src/services/pptx_to_html.py:132-134`
- Test: `apps/renderer/tests/test_pptx_to_html.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: text `source_object` dicts now include `align: "left" | "center" | "right"`. Task 5 (web) reads this field.

- [ ] **Step 1: Write the failing test**

```python
def test_extracts_alignment_for_a_text_object():
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    box = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(4), Inches(1))
    box.text = "Heading"
    box.text_frame.paragraphs[0].alignment = PP_ALIGN.CENTER

    buffer = BytesIO()
    presentation.save(buffer)

    result = pptx_to_html(buffer.getvalue())
    text_object = next(obj for obj in result["source"]["slides"][0]["objects"] if obj["kind"] == "text")

    assert text_object["align"] == "center"


def test_defaults_alignment_to_left_when_unset():
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    box = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(4), Inches(1))
    box.text = "Body"

    buffer = BytesIO()
    presentation.save(buffer)

    result = pptx_to_html(buffer.getvalue())
    text_object = next(obj for obj in result["source"]["slides"][0]["objects"] if obj["kind"] == "text")

    assert text_object["align"] == "left"
```

This test file needs `from pptx.enum.text import PP_ALIGN` added to its import block if not already present — check first with `grep -n "^from\|^import" apps/renderer/tests/test_pptx_to_html.py`.

- [ ] **Step 2: Run test to verify it fails**

```bash
docker cp "apps/renderer/tests/test_pptx_to_html.py" jaslide-renderer:/test_root/apps/renderer/tests/test_pptx_to_html.py
docker exec -w /test_root jaslide-renderer python -m pytest apps/renderer/tests/test_pptx_to_html.py -q -k "test_extracts_alignment_for_a_text_object or test_defaults_alignment_to_left_when_unset"
```

Expected: FAIL — `KeyError: 'align'` on both.

- [ ] **Step 3: Write minimal implementation**

In `apps/renderer/src/services/pptx_to_html.py`, add a helper function near `_text_style` (after its definition, before `_table_html`):

```python
def _text_align(shape) -> str:
    paragraph = next(iter(shape.text_frame.paragraphs), None)
    alignment = paragraph.alignment if paragraph is not None else None
    return {PP_ALIGN.CENTER: "center", PP_ALIGN.RIGHT: "right"}.get(alignment, "left")
```

Add `from pptx.enum.text import PP_ALIGN` to the imports at the top of the file (alongside the existing `from pptx.enum.shapes import MSO_SHAPE_TYPE`).

Then replace line 134:

```python
                source_objects.append({**source_object, "kind": "text", "text": shape.text, "paragraphs": [{"text": paragraph.text, "level": paragraph.level} for paragraph in shape.text_frame.paragraphs], **_text_style(shape)})
```

with:

```python
                source_objects.append({**source_object, "kind": "text", "text": shape.text, "align": _text_align(shape), "paragraphs": [{"text": paragraph.text, "level": paragraph.level} for paragraph in shape.text_frame.paragraphs], **_text_style(shape)})
```

- [ ] **Step 4: Run test to verify it passes**

```bash
docker cp "apps/renderer/src/services/pptx_to_html.py" jaslide-renderer:/test_root/apps/renderer/src/services/pptx_to_html.py
docker exec -w /test_root jaslide-renderer python -m pytest apps/renderer/tests/test_pptx_to_html.py -q
```

Expected: all pass except the same pre-existing unrelated failure.

- [ ] **Step 5: Run the full renderer suite to confirm zero new regressions anywhere**

```bash
docker exec -w /test_root jaslide-renderer python -m pytest apps/renderer/tests -q
```

Expected: only the same 2 pre-existing failures (`test_pptx_to_html.py::test_preserves_table_cell_dimensions_and_formatting`, `test_style_extractor.py::test_extract_style_upload_returns_only_config_tokens`), everything else passes.

- [ ] **Step 6: Commit**

```bash
git add apps/renderer/src/services/pptx_to_html.py apps/renderer/tests/test_pptx_to_html.py
git commit -m "feat: extract text alignment for native PPTX text objects"
```

---

### Task 5: Direct-canvas editing for native text boxes

**Files:**
- Modify: `apps/web/src/app/editor/[id]/page.tsx` (state near `inlineTextIndex` at line 1558; the `nativeObjects.map` overlay block starting at line 1808; remove the text-object branch of the side-panel block at lines 1259-1267)
- Test: `apps/web/test/taeslide-object-editing.test.js`

**Interfaces:**
- Consumes: `object.align` from Task 4 (falls back to `'left'` if absent — must not crash on templates extracted before this change).
- Produces: nothing new for Task 6 to consume (Task 6 is independent, both just call the existing `updateNativeObject`).

- [ ] **Step 1: Write the failing test**

Add to `apps/web/test/taeslide-object-editing.test.js`, inside the existing `test(...)` callback (it's one large test asserting many patterns against the same `editor` source string — add these assertions alongside the existing ones, do not create a new `test(...)` block):

```javascript
    assert.match(editor, /editingNativeTextId/);
    assert.match(editor, /setEditingNativeTextId/);
    assert.match(editor, /네이티브 텍스트 직접 편집/);
    assert.match(editor, /editingNativeCell/);
    assert.match(editor, /setEditingNativeCell/);
    assert.match(editor, /표 셀 직접 편집/);
    assert.doesNotMatch(editor, /표 내용 \(줄마다 첫 번째 열\)/);
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/web
node --test test/taeslide-object-editing.test.js
```

Expected: FAIL on `assert.match(editor, /editingNativeTextId/)` (module doesn't exist yet). Ignore the one pre-existing unrelated failure this test file already has on `/object\.addText/` — confirm via `git stash && node --test test/taeslide-object-editing.test.js && git stash pop` that it fails identically on the unmodified baseline, so you know it's not something this task introduced.

- [ ] **Step 3: Write minimal implementation**

Add two new state declarations right after the existing `const [inlineTextIndex, setInlineTextIndex] = useState<number | null>(null);` (line 1558):

```typescript
    const [editingNativeTextId, setEditingNativeTextId] = useState<string | null>(null);
    const [editingNativeCell, setEditingNativeCell] = useState<{ objectId: string; row: number; col: number } | null>(null);
```

In the side panel, remove the text-object `<textarea>` branch (lines 1259-1267) — delete this block entirely (the table `<input>` grid block that follows it, lines 1268-1272, is removed in Task 6, not here):

```typescript
                                    {selectedNativeObject.kind !== 'shape' && selectedNativeObject.kind !== 'image' && <div className="space-y-2">
                                    <label className="block text-xs font-medium text-gray-600">{selectedNativeObject.kind === 'table' ? '표 내용 (줄마다 첫 번째 열)' : '텍스트'}</label>
                                    <textarea
                                        value={selectedNativeObject.kind === 'table' ? ((selectedSlide.content?.objectEdits || []).find((item: any) => item.objectId === selectedNativeObject.id)?.cells || selectedNativeObject.cells || []).map((row: string[]) => row.join(' | ')).join('\n') : ((selectedSlide.content?.objectEdits || []).find((item: any) => item.objectId === selectedNativeObject.id)?.text ?? selectedNativeObject.text ?? '')}
                                        rows={selectedNativeObject.kind === 'table' ? 6 : 4}
                                        onChange={(event) => updateNativeObject(selectedNativeObject.id, selectedNativeObject.kind === 'table' ? { cells: event.target.value.split('\n').map((row) => row.split('|').map((cell) => cell.trim())) } : { text: event.target.value })}
                                        className={selectedNativeObject.kind === 'table' ? 'hidden' : 'w-full resize-y rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500'}
                                    />
                                    </div>}
```

(Leave the `{selectedNativeObject.kind === 'table' && <div className="overflow-auto rounded border p-2">...</div>}` block right after it in place for now — Task 6 removes it.)

In the `nativeObjects.map` overlay block, replace:

```typescript
                    return <div key={object.id} data-editable-object data-native-object className={`absolute cursor-move ${selected ? 'border-2 border-purple-500 bg-purple-500/5' : 'border border-transparent hover:border-purple-400/70'}`} style={{ left: `${left / 19.2}%`, top: `${top / 10.8}%`, width: `${Math.max(1, width) / 19.2}%`, height: `${Math.max(1, height) / 10.8}%` }} onPointerDown={(event) => { onSelectNativeObject(object.id); startNativeTransform(event, object, false); }}>
                        {selected && <button type="button" aria-label="native object resize" className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-se-resize rounded-sm border border-purple-700 bg-white" onPointerDown={(event) => startNativeTransform(event, object, true)} />}
                    </div>;
```

with:

```typescript
                    return <div key={object.id} data-editable-object data-native-object className={`absolute cursor-move ${selected ? 'border-2 border-purple-500 bg-purple-500/5' : 'border border-transparent hover:border-purple-400/70'}`} style={{ left: `${left / 19.2}%`, top: `${top / 10.8}%`, width: `${Math.max(1, width) / 19.2}%`, height: `${Math.max(1, height) / 10.8}%` }} onPointerDown={(event) => { onSelectNativeObject(object.id); startNativeTransform(event, object, false); }} onDoubleClick={(event) => {
                        if (object.kind !== 'text') return;
                        event.preventDefault(); event.stopPropagation();
                        onSelectNativeObject(object.id);
                        setEditingNativeTextId(object.id);
                    }}>
                        {object.kind === 'text' && (editingNativeTextId === object.id ? <textarea
                            autoFocus
                            aria-label="네이티브 텍스트 직접 편집"
                            value={edit.text ?? object.text ?? ''}
                            onPointerDown={(event) => event.stopPropagation()}
                            onChange={(event) => updateNativeObject(object.id, { text: event.target.value })}
                            onBlur={() => setEditingNativeTextId(null)}
                            onKeyDown={(event) => { if (event.key === 'Escape') { setEditingNativeTextId(null); (event.currentTarget as HTMLTextAreaElement).blur(); } }}
                            className="absolute inset-0 h-full w-full resize-none border-2 border-purple-600 bg-white/95 p-1 text-sm leading-tight outline-none"
                        /> : <div className="pointer-events-none h-full w-full overflow-hidden p-1 text-sm leading-tight" style={{ textAlign: (edit.align ?? object.align ?? 'left') as any }}>{edit.text ?? object.text ?? ''}</div>)}
                        {selected && <button type="button" aria-label="native object resize" className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-se-resize rounded-sm border border-purple-700 bg-white" onPointerDown={(event) => startNativeTransform(event, object, true)} />}
                    </div>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/web
node --test test/taeslide-object-editing.test.js
```

Expected: PASS on all the new assertions from Step 1 (the one pre-existing unrelated `/object\.addText/` failure may still be there — confirmed pre-existing in Step 2, not a regression).

- [ ] **Step 5: Run the full web test suite to confirm zero new regressions elsewhere**

```bash
node --test ./test/*.test.js
```

Expected: same pass/fail counts as before this task, plus the new assertions passing.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/editor/[id]/page.tsx" apps/web/test/taeslide-object-editing.test.js
git commit -m "feat: edit native text boxes directly on the slide canvas"
```

---

### Task 6: Direct-canvas editing for native table cells

**Files:**
- Modify: `apps/web/src/app/editor/[id]/page.tsx` (remove the table `<input>` grid side-panel block at lines 1268-1272; extend the `nativeObjects.map` overlay block from Task 5 with a cell grid)
- Test: `apps/web/test/taeslide-object-editing.test.js`

**Interfaces:**
- Consumes: `object.rowHeights` / `object.columnWidths` from Task 3 (falls back to equal-sized rows/columns if absent, so templates extracted before this change still render — just without exact geometry until re-extracted).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing test**

Add to the same test in `apps/web/test/taeslide-object-editing.test.js`:

```javascript
    assert.match(editor, /gridTemplateRows/);
    assert.match(editor, /gridTemplateColumns/);
    assert.doesNotMatch(editor, /selectedNativeCells\.flatMap\(\(row: string\[\]/);
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/web
node --test test/taeslide-object-editing.test.js
```

Expected: FAIL on `assert.match(editor, /gridTemplateRows/)`.

- [ ] **Step 3: Write minimal implementation**

Remove the table `<input>` grid side-panel block (now that Task 5 already removed the text-object textarea block above it):

```typescript
                                    {selectedNativeObject.kind === 'table' && <div className="overflow-auto rounded border p-2">
                                        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.max(...selectedNativeCells.map((row: string[]) => row.length), 1)}, minmax(96px, 1fr))` }}>
                                            {selectedNativeCells.flatMap((row: string[], rowIndex: number) => row.map((cell: string, cellIndex: number) => <input key={`${rowIndex}-${cellIndex}`} value={cell} onChange={(event) => { const cells = selectedNativeCells.map((source: string[]) => [...source]); cells[rowIndex][cellIndex] = event.target.value; updateNativeObject(selectedNativeObject.id, { cells }); }} className="min-w-0 rounded border px-2 py-1 text-sm" />))}
                                        </div>
                                    </div>}
```

Delete it entirely (the `selectedNativeCells` variable at line 478-480 stays — it's no longer used by the side panel, but leave its declaration in place since removing an unused variable is out of scope for this task; if the linter flags it as unused, prefix with `_` — check `apps/web/tsconfig.json`'s `noUnusedLocals` setting first with `grep noUnusedLocals apps/web/tsconfig.json`; if absent, no action needed).

In the `nativeObjects.map` overlay block from Task 5, add a table branch. Insert this right after the `{object.kind === 'text' && (...)}` block added in Task 5, still inside the same outer `<div>`:

```typescript
                        {object.kind === 'table' && (() => {
                            const cells: string[][] = edit.cells || object.cells || [];
                            const rowHeights: number[] = (object.rowHeights?.length === cells.length ? object.rowHeights : cells.map(() => 1));
                            const columnWidths: number[] = (object.columnWidths?.length === (cells[0]?.length || 0) ? object.columnWidths : (cells[0] || []).map(() => 1));
                            const rowTotal = rowHeights.reduce((sum: number, value: number) => sum + value, 0) || 1;
                            const colTotal = columnWidths.reduce((sum: number, value: number) => sum + value, 0) || 1;
                            return <div className="grid h-full w-full" style={{ gridTemplateRows: rowHeights.map((value) => `${(value / rowTotal) * 100}%`).join(' '), gridTemplateColumns: columnWidths.map((value) => `${(value / colTotal) * 100}%`).join(' ') }}>
                                {cells.flatMap((row: string[], rowIndex: number) => row.map((cellText: string, colIndex: number) => {
                                    const isEditing = editingNativeCell?.objectId === object.id && editingNativeCell.row === rowIndex && editingNativeCell.col === colIndex;
                                    return isEditing ? <textarea
                                        key={`${rowIndex}-${colIndex}`}
                                        autoFocus
                                        aria-label="표 셀 직접 편집"
                                        value={cellText}
                                        onPointerDown={(event) => event.stopPropagation()}
                                        onChange={(event) => {
                                            const next = cells.map((source: string[]) => [...source]);
                                            next[rowIndex][colIndex] = event.target.value;
                                            updateNativeObject(object.id, { cells: next });
                                        }}
                                        onBlur={() => setEditingNativeCell(null)}
                                        onKeyDown={(event) => { if (event.key === 'Escape') { setEditingNativeCell(null); (event.currentTarget as HTMLTextAreaElement).blur(); } }}
                                        className="resize-none border border-purple-600 bg-white/95 p-1 text-xs leading-tight outline-none"
                                    /> : <div
                                        key={`${rowIndex}-${colIndex}`}
                                        data-native-table-cell
                                        className="overflow-hidden border border-transparent p-1 text-xs leading-tight hover:border-purple-400/70"
                                        onPointerDown={(event) => { onSelectNativeObject(object.id); startNativeTransform(event, object, false); }}
                                        onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); onSelectNativeObject(object.id); setEditingNativeCell({ objectId: object.id, row: rowIndex, col: colIndex }); }}
                                    >{cellText}</div>;
                                }))}
                            </div>;
                        })()}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/web
node --test test/taeslide-object-editing.test.js
```

Expected: PASS on all new assertions (the one pre-existing unrelated failure may remain).

- [ ] **Step 5: Run the full web test suite plus a TypeScript check to confirm zero regressions**

```bash
node --test ./test/*.test.js
docker cp "apps/web/src/app/editor/[id]/page.tsx" jaslide-web:"/app/apps/web/src/app/editor/[id]/page.tsx"
docker cp apps/web/src/lib/slide-save-scheduler.js jaslide-web:/app/apps/web/src/lib/slide-save-scheduler.js
docker exec -w /app/apps/web jaslide-web ./node_modules/.bin/tsc --noEmit -p tsconfig.json
```

Expected: `node --test` shows the same pass/fail counts as the repo baseline plus the new assertions passing; `tsc --noEmit` exits 0 with no output.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/editor/[id]/page.tsx" apps/web/test/taeslide-object-editing.test.js
git commit -m "feat: edit native table cells directly on the slide canvas"
```

---

### Task 7: Rebuild, verify end-to-end with the real sample file, and push

**Files:** none (build/verify/push only)

**Interfaces:** none — this task only verifies the previous six tasks together.

- [ ] **Step 1: Rebuild the renderer and web Docker images**

```bash
docker compose --env-file .env build renderer web
```

Expected: both images build successfully (this can take a few minutes — if the command's own timeout is hit, rerun with `run_in_background: true` and poll the output file rather than assuming failure).

- [ ] **Step 2: Restart the containers**

```bash
docker compose --env-file .env up -d renderer web
sleep 5
curl -sf http://localhost:8000/api/health -o /dev/null -w "renderer:%{http_code}\n" || true
curl -sf http://localhost:3100/ -o /dev/null -w "web:%{http_code}\n"
```

Expected: `web:200`. The renderer has no `/api/health` route (confirmed earlier in this session it 404s on `/`), so don't treat that as a failure signal — just confirm the container is `Up` via `docker ps`.

- [ ] **Step 3: Re-run the direct extract/style check against the real sample PPTX to confirm rowHeights/columnWidths/align are present**

```bash
curl -sS -X POST http://localhost:8000/api/extract/style -F "file=@/mnt/c/Users/USER/Downloads/박태지_0723_업무보고_AI엔지니어링.pptx" | python3 -c "
import json, sys
d = json.load(sys.stdin)
objects = d['config']['source']['slides'][0]['objects']
table = next(o for o in objects if o['kind'] == 'table')
text = next(o for o in objects if o['kind'] == 'text')
assert 'rowHeights' in table and 'columnWidths' in table, table
assert 'align' in text, text
print('rowHeights', table['rowHeights'])
print('columnWidths', table['columnWidths'])
print('text align', text['align'])
"
```

Expected: prints real (non-empty, non-uniform for this specific table) `rowHeights`/`columnWidths` lists and a valid `align` value, no `AssertionError`.

- [ ] **Step 4: Ask the user to manually verify the editor UX**

Report to the user (in Korean) that the renderer changes are verified via the real file, and ask them to open a presentation built from this PPTX template in the browser (`http://localhost:3100`), double-click a native text box and a table cell, and confirm text can be typed directly on the canvas and that the table's row/column boundaries visually line up with the rendered preview. This step requires human eyes on a live browser session — there is no browser-automation tool available in this environment to do it directly.

- [ ] **Step 5: Push**

Only after the user confirms Step 4 looks right:

```bash
git log --oneline origin/main..HEAD
git push
```

Expected: pushes exactly the commits made in Tasks 1-6 (plus the two design-doc commits already made earlier in this session) to `origin/main`.
