# New-Layout Template Position Overrides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an uploaded HTML template reposition the five newer PPTX layout bodies (timeline, process, comparison, KPI, two-column columns) the same way it already can for the six older layouts.

**Architecture:** Extend the HTML template layout parser's recognized slot names, then in each of the five affected functions replace a block of hardcoded coordinate literals with one `self._layout(slot, defaults)` call whose defaults reproduce today's hardcoded bounding box exactly, deriving every internal element's position as a fraction of the returned rect.

**Tech Stack:** Python 3.11 + python-pptx (`apps/renderer`). Docker for test execution (no local toolchain).

## Global Constraints

- With no template override, every affected function's output must be pixel-identical to today — verified by the existing (unmodified) test suite, which renders these layouts with no template attached.
- Decorative fixed-size elements (timeline markers, process arrows, comparison's VS badge) keep their absolute size — only their position moves with the rect.
- Python tests run via: `docker run --rm -v "$(pwd)/apps/renderer:/app/apps/renderer" -w /app jaslide/renderer:v0.6.1 sh -c "pip install --disable-pip-version-check --no-cache-dir pytest==8.4.2 httpx==0.28.1 >/dev/null 2>&1 && python -m pytest apps/renderer/tests/test_pptx_generator.py apps/renderer/tests/test_html_template.py -v"`

---

### Task 1: New SLOTS + timeline/process overrides

**Files:**
- Modify: `apps/renderer/src/services/html_template.py` (`SLOTS`)
- Modify: `apps/renderer/src/generators/pptx_generator.py` (`_add_timeline_slide`, `_add_process_slide`)
- Test: `apps/renderer/tests/test_pptx_generator.py`

**Interfaces:**
- Consumes: `self._layout(slot: str, defaults: dict) -> dict` (existing, `pptx_generator.py:122`, unchanged).
- Produces: `SLOTS` gains `"timeline"`, `"process"`, `"comparison"`, `"kpi"`, `"columns"` — Tasks 2-3 rely on the latter three already being present after this task, so they don't need to touch `html_template.py` again.

- [ ] **Step 1: Write the failing tests**

Add to `apps/renderer/tests/test_pptx_generator.py`:

```python
def test_timeline_slide_repositions_from_an_uploaded_templates_slot():
    template = SimpleNamespace(config=SimpleNamespace(htmlTemplate=(
        '<div data-jaslide-slot="timeline" data-x="2" data-y="4" data-w="9" data-h="2"></div>'
    )))
    output = PPTXGenerator(template).generate(_presentation(_slide(
        "TIMELINE", "로드맵",
        {"heading": "로드맵", "timeline": {"items": [
            {"date": "Q1", "label": "a"}, {"date": "Q2", "label": "b"}, {"date": "Q3", "label": "c"},
        ]}},
    )))
    slide = Presentation(BytesIO(output)).slides[0]
    line = next(shape for shape in slide.shapes if getattr(shape, "auto_shape_type", None) == MSO_SHAPE.RECTANGLE)
    assert line.left == Inches(2)
    assert line.width == Inches(9)


def test_process_slide_repositions_from_an_uploaded_templates_slot():
    template = SimpleNamespace(config=SimpleNamespace(htmlTemplate=(
        '<div data-jaslide-slot="process" data-x="1" data-y="3" data-w="10" data-h="2"></div>'
    )))
    output = PPTXGenerator(template).generate(_presentation(_slide(
        "PROCESS", "절차",
        {"heading": "절차", "process": {"steps": [{"label": "a"}, {"label": "b"}]}},
    )))
    slide = Presentation(BytesIO(output)).slides[0]
    boxes = [shape for shape in slide.shapes if getattr(shape, "auto_shape_type", None) == MSO_SHAPE.ROUNDED_RECTANGLE]
    assert boxes[0].left == Inches(1)
    assert boxes[0].top == Inches(3)
    assert boxes[0].height == Inches(2)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker run --rm -v "$(pwd)/apps/renderer:/app/apps/renderer" -w /app jaslide/renderer:v0.6.1 sh -c "pip install --disable-pip-version-check --no-cache-dir pytest==8.4.2 httpx==0.28.1 >/dev/null 2>&1 && python -m pytest apps/renderer/tests/test_pptx_generator.py -k 'test_timeline_slide_repositions or test_process_slide_repositions' -v"`
Expected: FAIL — the template's `data-jaslide-slot="timeline"`/`"process"` elements are silently dropped by the parser (unrecognized slot names), so shapes still render at the hardcoded default positions instead of `data-x`/`data-y`/`data-w`.

- [ ] **Step 3: Extend `SLOTS`**

In `apps/renderer/src/services/html_template.py`, change:

```python
SLOTS = {"title", "subtitle", "body", "bullets"}
```

to:

```python
SLOTS = {"title", "subtitle", "body", "bullets", "timeline", "process", "comparison", "kpi", "columns"}
```

- [ ] **Step 4: Wire `_add_timeline_slide`**

In `apps/renderer/src/generators/pptx_generator.py`, change:

```python
        items = content["timeline"]["items"]
        count = len(items)
        left, right, line_y = 1.0, 12.333, 3.6
        line = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(left), Inches(line_y), Inches(right - left), Inches(0.04))
        line.fill.solid()
        line.fill.fore_color.rgb = self.tokens["text"]
        line.line.fill.background()

        slot_w = (right - left) / count
        for index, item in enumerate(items):
            cx = left + slot_w * index + slot_w / 2
            marker = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(cx - 0.09), Inches(line_y - 0.07), Inches(0.18), Inches(0.18))
            marker.fill.solid()
            marker.fill.fore_color.rgb = self.tokens["text"]
            marker.line.fill.background()

            date = str(item.get("date", "")).strip()
            if date:
                date_box = self._add_layout_textbox(slide, {"x": cx - slot_w / 2 + 0.05, "y": line_y - 0.55, "w": slot_w - 0.1, "h": 0.4})
                date_box.text_frame.word_wrap = True
                date_paragraph = date_box.text_frame.paragraphs[0]
                date_paragraph.text = date
                self._style_paragraph(date_paragraph, 11, self.tokens["body_font"], bold=True)
                date_paragraph.alignment = PP_ALIGN.CENTER
                self._shrink_text_to_fit(date_box)

            label = str(item.get("label", "")).strip()
            description = str(item.get("description", "")).strip()
            text_box = self._add_layout_textbox(slide, {"x": cx - slot_w / 2 + 0.05, "y": line_y + 0.3, "w": slot_w - 0.1, "h": 1.8})
```

to:

```python
        items = content["timeline"]["items"]
        count = len(items)
        rect = self._layout("timeline", {"x": 1.0, "y": 3.05, "w": 11.333, "h": 2.65})
        left, right = rect["x"], rect["x"] + rect["w"]
        line_y = rect["y"] + rect["h"] * 0.2075
        date_top, date_h = rect["y"], rect["h"] * 0.150943
        text_top, text_h = rect["y"] + rect["h"] * 0.320755, rect["h"] * 0.679245
        line = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(left), Inches(line_y), Inches(right - left), Inches(0.04))
        line.fill.solid()
        line.fill.fore_color.rgb = self.tokens["text"]
        line.line.fill.background()

        slot_w = (right - left) / count
        for index, item in enumerate(items):
            cx = left + slot_w * index + slot_w / 2
            marker = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(cx - 0.09), Inches(line_y - 0.07), Inches(0.18), Inches(0.18))
            marker.fill.solid()
            marker.fill.fore_color.rgb = self.tokens["text"]
            marker.line.fill.background()

            date = str(item.get("date", "")).strip()
            if date:
                date_box = self._add_layout_textbox(slide, {"x": cx - slot_w / 2 + 0.05, "y": date_top, "w": slot_w - 0.1, "h": date_h})
                date_box.text_frame.word_wrap = True
                date_paragraph = date_box.text_frame.paragraphs[0]
                date_paragraph.text = date
                self._style_paragraph(date_paragraph, 11, self.tokens["body_font"], bold=True)
                date_paragraph.alignment = PP_ALIGN.CENTER
                self._shrink_text_to_fit(date_box)

            label = str(item.get("label", "")).strip()
            description = str(item.get("description", "")).strip()
            text_box = self._add_layout_textbox(slide, {"x": cx - slot_w / 2 + 0.05, "y": text_top, "w": slot_w - 0.1, "h": text_h})
```

(The rest of the function — the label/description paragraphs and `_shrink_text_to_fit(text_box)` call — is unchanged; `text_box`'s `{"x":..., "y": text_top, ...}` dict is the only line in that block that changes.)

- [ ] **Step 5: Wire `_add_process_slide`**

Change:

```python
        steps = content["process"]["steps"]
        count = len(steps)
        left, right, y, h, gap = 0.7, 12.633, 2.8, 1.8, 0.4
        box_w = (right - left - gap * (count - 1)) / count
```

to:

```python
        steps = content["process"]["steps"]
        count = len(steps)
        rect = self._layout("process", {"x": 0.7, "y": 2.8, "w": 11.933, "h": 1.8})
        left, right, y, h, gap = rect["x"], rect["x"] + rect["w"], rect["y"], rect["h"], 0.4
        box_w = (right - left - gap * (count - 1)) / count
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `docker run --rm -v "$(pwd)/apps/renderer:/app/apps/renderer" -w /app jaslide/renderer:v0.6.1 sh -c "pip install --disable-pip-version-check --no-cache-dir pytest==8.4.2 httpx==0.28.1 >/dev/null 2>&1 && python -m pytest apps/renderer/tests/test_pptx_generator.py apps/renderer/tests/test_html_template.py -v"`
Expected: PASS (all tests, including the new ones — the `test_html_template.py` suite confirms the `SLOTS` change didn't break unknown-slot rejection)

- [ ] **Step 7: Commit**

```bash
git add apps/renderer/src/services/html_template.py apps/renderer/src/generators/pptx_generator.py apps/renderer/tests/test_pptx_generator.py
git commit -m "feat(renderer): let templates reposition timeline/process layouts"
```

---

### Task 2: Comparison and two-column-columns overrides

**Files:**
- Modify: `apps/renderer/src/generators/pptx_generator.py` (`_add_comparison_slide`, `_add_two_column_slide`)
- Test: `apps/renderer/tests/test_pptx_generator.py`

**Interfaces:**
- Consumes: `self._layout(slot, defaults)`; `SLOTS` already includes `"comparison"`/`"columns"` (Task 1, Step 3).

- [ ] **Step 1: Write the failing tests**

Add to `apps/renderer/tests/test_pptx_generator.py`:

```python
def test_comparison_slide_repositions_from_an_uploaded_templates_slot():
    template = SimpleNamespace(config=SimpleNamespace(htmlTemplate=(
        '<div data-jaslide-slot="comparison" data-x="1" data-y="2" data-w="10" data-h="4"></div>'
    )))
    output = PPTXGenerator(template).generate(_presentation(_slide(
        "COMPARISON", "비교",
        {"heading": "비교", "comparison": {
            "left": {"title": "A", "bullets": [{"text": "x", "level": 0}]},
            "right": {"title": "B", "bullets": [{"text": "y", "level": 0}]},
        }},
    )))
    slide = Presentation(BytesIO(output)).slides[0]
    header = next(shape for shape in slide.shapes if shape.has_text_frame and shape.text_frame.text == "A")
    assert header.left == Inches(1)
    assert header.top == Inches(2)


def test_two_column_slide_repositions_from_an_uploaded_templates_slot():
    template = SimpleNamespace(config=SimpleNamespace(htmlTemplate=(
        '<div data-jaslide-slot="columns" data-x="1" data-y="2" data-w="10" data-h="4"></div>'
    )))
    output = PPTXGenerator(template).generate(_presentation(_slide(
        "TWO_COLUMN", "비교",
        {"heading": "비교", "columns": [
            {"header": "왼쪽", "bullets": [{"text": "항목", "level": 0}]},
            {"header": "오른쪽", "bullets": [{"text": "항목", "level": 0}]},
        ]},
    )))
    slide = Presentation(BytesIO(output)).slides[0]
    header = next(shape for shape in slide.shapes if shape.has_text_frame and shape.text_frame.text == "왼쪽")
    assert header.left == Inches(1)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker run --rm -v "$(pwd)/apps/renderer:/app/apps/renderer" -w /app jaslide/renderer:v0.6.1 sh -c "pip install --disable-pip-version-check --no-cache-dir pytest==8.4.2 httpx==0.28.1 >/dev/null 2>&1 && python -m pytest apps/renderer/tests/test_pptx_generator.py -k 'test_comparison_slide_repositions or test_two_column_slide_repositions' -v"`
Expected: FAIL — headers still render at the hardcoded default x (0.5 for comparison's left side, 0.5 for two-column's left column), not the template's `data-x="1"`.

- [ ] **Step 3: Wire `_add_comparison_slide`**

Change:

```python
        comparison = content["comparison"]
        for side_key, x in (("left", 0.5), ("right", 6.9)):
            side = comparison[side_key]
            header_box = self._add_layout_textbox(slide, {"x": x, "y": 1.3, "w": 5.9, "h": 0.5})
            header_paragraph = header_box.text_frame.paragraphs[0]
            header_paragraph.text = str(side.get("title", ""))
            self._style_paragraph(header_paragraph, 20, self.tokens["body_font"], bold=True)
            header_paragraph.alignment = PP_ALIGN.CENTER
            self._add_column_bullets(slide, side.get("bullets", []), x, 1.9, 5.1)

        badge = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(6.267), Inches(1.35), Inches(0.8), Inches(0.8))
```

to:

```python
        rect = self._layout("comparison", {"x": 0.5, "y": 1.3, "w": 12.3, "h": 5.7})
        gutter = 0.5
        column_w = (rect["w"] - gutter) / 2
        comparison = content["comparison"]
        for side_key, x in (("left", rect["x"]), ("right", rect["x"] + column_w + gutter)):
            side = comparison[side_key]
            header_box = self._add_layout_textbox(slide, {"x": x, "y": rect["y"], "w": column_w, "h": 0.5})
            header_paragraph = header_box.text_frame.paragraphs[0]
            header_paragraph.text = str(side.get("title", ""))
            self._style_paragraph(header_paragraph, 20, self.tokens["body_font"], bold=True)
            header_paragraph.alignment = PP_ALIGN.CENTER
            bullets_top = rect["y"] + 0.6
            self._add_column_bullets(slide, side.get("bullets", []), x, bullets_top, rect["y"] + rect["h"] - bullets_top)

        badge_x = rect["x"] + column_w + gutter / 2 - 0.4
        badge_y = rect["y"] + 0.05
        badge = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(badge_x), Inches(badge_y), Inches(0.8), Inches(0.8))
```

(`column_w` replaces the hardcoded `5.9` textbox width in the `header_box` dict — note the `"w"` key changes from `5.9` to `column_w`. Everything after the `badge = ...` line is unchanged.)

- [ ] **Step 4: Wire `_add_two_column_slide`**

Change:

```python
        columns = content.get("columns")
        if isinstance(columns, list) and len(columns) == 2 and all(isinstance(item, dict) for item in columns):
            for index, column in enumerate(columns):
                x = 0.5 + index * 6.4
                header = str(column.get("header", "")).strip()
                bullets_top = 1.3
                if header:
                    header_box = self._add_layout_textbox(slide, {"x": x, "y": 1.15, "w": 5.9, "h": 0.45})
                    header_paragraph = header_box.text_frame.paragraphs[0]
                    header_paragraph.text = header
                    self._style_paragraph(header_paragraph, 16, self.tokens["body_font"], bold=True)
                    bullets_top = 1.7
                    self._shrink_text_to_fit(header_box)
                bullets = column.get("bullets") if isinstance(column.get("bullets"), list) else []
                self._add_column_bullets(slide, bullets, x, bullets_top, 1.3 + 5.7 - bullets_top)
            return

        # No columns: fall back to splitting a flat bullets array in half.
        bullets = content.get("bullets", [])
        mid = len(bullets) // 2
        left_bullets = bullets[:mid] if mid > 0 else bullets
        right_bullets = bullets[mid:] if mid > 0 else []
        self._add_column_bullets(slide, left_bullets, 0.5, 1.3, 5.7)
        self._add_column_bullets(slide, right_bullets, 6.9, 1.3, 5.7)
```

to:

```python
        rect = self._layout("columns", {"x": 0.5, "y": 1.15, "w": 12.3, "h": 5.85})
        gutter = 0.5
        column_w = (rect["w"] - gutter) / 2
        no_header_top = rect["y"] + 0.15
        bottom = rect["y"] + rect["h"]

        columns = content.get("columns")
        if isinstance(columns, list) and len(columns) == 2 and all(isinstance(item, dict) for item in columns):
            for index, column in enumerate(columns):
                x = rect["x"] + index * (column_w + gutter)
                header = str(column.get("header", "")).strip()
                bullets_top = no_header_top
                if header:
                    header_box = self._add_layout_textbox(slide, {"x": x, "y": rect["y"], "w": column_w, "h": 0.45})
                    header_paragraph = header_box.text_frame.paragraphs[0]
                    header_paragraph.text = header
                    self._style_paragraph(header_paragraph, 16, self.tokens["body_font"], bold=True)
                    bullets_top = rect["y"] + 0.55
                    self._shrink_text_to_fit(header_box)
                bullets = column.get("bullets") if isinstance(column.get("bullets"), list) else []
                self._add_column_bullets(slide, bullets, x, bullets_top, bottom - bullets_top)
            return

        # No columns: fall back to splitting a flat bullets array in half.
        bullets = content.get("bullets", [])
        mid = len(bullets) // 2
        left_bullets = bullets[:mid] if mid > 0 else bullets
        right_bullets = bullets[mid:] if mid > 0 else []
        self._add_column_bullets(slide, left_bullets, rect["x"], no_header_top, bottom - no_header_top)
        self._add_column_bullets(slide, right_bullets, rect["x"] + column_w + gutter, no_header_top, bottom - no_header_top)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `docker run --rm -v "$(pwd)/apps/renderer:/app/apps/renderer" -w /app jaslide/renderer:v0.6.1 sh -c "pip install --disable-pip-version-check --no-cache-dir pytest==8.4.2 httpx==0.28.1 >/dev/null 2>&1 && python -m pytest apps/renderer/tests/test_pptx_generator.py -v"`
Expected: PASS (all tests, including the new ones)

- [ ] **Step 6: Commit**

```bash
git add apps/renderer/src/generators/pptx_generator.py apps/renderer/tests/test_pptx_generator.py
git commit -m "feat(renderer): let templates reposition comparison/two-column layouts"
```

---

### Task 3: KPI overrides

**Files:**
- Modify: `apps/renderer/src/generators/pptx_generator.py` (`_add_kpi_slide`)
- Test: `apps/renderer/tests/test_pptx_generator.py`

**Interfaces:**
- Consumes: `self._layout(slot, defaults)`; `SLOTS` already includes `"kpi"` (Task 1, Step 3).

- [ ] **Step 1: Write the failing test**

Add to `apps/renderer/tests/test_pptx_generator.py`:

```python
def test_kpi_slide_repositions_from_an_uploaded_templates_slot():
    template = SimpleNamespace(config=SimpleNamespace(htmlTemplate=(
        '<div data-jaslide-slot="kpi" data-x="1" data-y="2" data-w="10" data-h="4"></div>'
    )))
    output = PPTXGenerator(template).generate(_presentation(_slide(
        "KPI", "핵심 지표",
        {"heading": "핵심 지표", "metrics": {"metrics": [
            {"value": "1", "label": "a"}, {"value": "2", "label": "b"},
        ]}},
    )))
    slide = Presentation(BytesIO(output)).slides[0]
    cards = [shape for shape in slide.shapes if getattr(shape, "auto_shape_type", None) == MSO_SHAPE.ROUNDED_RECTANGLE]
    assert min(card.left for card in cards) == Inches(1)
    assert min(card.top for card in cards) == Inches(2)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker run --rm -v "$(pwd)/apps/renderer:/app/apps/renderer" -w /app jaslide/renderer:v0.6.1 sh -c "pip install --disable-pip-version-check --no-cache-dir pytest==8.4.2 httpx==0.28.1 >/dev/null 2>&1 && python -m pytest apps/renderer/tests/test_pptx_generator.py -k test_kpi_slide_repositions -v"`
Expected: FAIL — cards still render at the hardcoded default position (`left=0.7`, `top=1.6`), not the template's `data-x="1"`/`data-y="2"`.

- [ ] **Step 3: Wire `_add_kpi_slide`**

Change:

```python
        metrics = content["metrics"]["metrics"]
        count = len(metrics)
        columns = 3 if count > 4 else 2
        rows = math.ceil(count / columns)
        left, top, right, bottom, gap = 0.7, 1.6, 12.633, 6.9, 0.3
```

to:

```python
        metrics = content["metrics"]["metrics"]
        count = len(metrics)
        columns = 3 if count > 4 else 2
        rows = math.ceil(count / columns)
        rect = self._layout("kpi", {"x": 0.7, "y": 1.6, "w": 11.933, "h": 5.3})
        left, top, right, bottom, gap = rect["x"], rect["y"], rect["x"] + rect["w"], rect["y"] + rect["h"], 0.3
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker run --rm -v "$(pwd)/apps/renderer:/app/apps/renderer" -w /app jaslide/renderer:v0.6.1 sh -c "pip install --disable-pip-version-check --no-cache-dir pytest==8.4.2 httpx==0.28.1 >/dev/null 2>&1 && python -m pytest apps/renderer/tests/test_pptx_generator.py -v"`
Expected: PASS (all tests, including the new one)

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/generators/pptx_generator.py apps/renderer/tests/test_pptx_generator.py
git commit -m "feat(renderer): let templates reposition KPI layout"
```
