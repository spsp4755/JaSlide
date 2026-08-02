# Legacy Layout Text Auto-Fit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing `_shrink_text_to_fit` auto-fit helper into every textbox drawn by the six pre-existing PPTX layout functions, which currently never call it.

**Architecture:** Pure addition — one `self._shrink_text_to_fit(box)` call immediately after each textbox's paragraphs are fully populated and styled. No existing layout logic, geometry, or styling changes.

**Tech Stack:** Python 3.11 + python-pptx (`apps/renderer`). Docker for test execution (no local toolchain).

## Global Constraints

- `_shrink_text_to_fit(shape, default_pt=18.0)` (`apps/renderer/src/generators/pptx_generator.py:137`) already reads each run's actual set font size — no call site needs its own `default_pt`.
- Every call site adds the shrink call after the box's text/paragraphs/style are fully set — never before.
- No change to `_shrink_text_to_fit`/`fit_font_scale` themselves, or to any layout's geometry/styling.
- Python tests run via: `docker run --rm -v "$(pwd)/apps/renderer:/app/apps/renderer" -w /app jaslide/renderer:v0.6.1 sh -c "pip install --disable-pip-version-check --no-cache-dir pytest==8.4.2 httpx==0.28.1 >/dev/null 2>&1 && python -m pytest apps/renderer/tests/test_pptx_generator.py -v"`

---

### Task 1: Auto-fit for title, content, and bullet-list slides

**Files:**
- Modify: `apps/renderer/src/generators/pptx_generator.py` (`_add_title_slide`, `_add_content_slide`, `_add_bullet_slide`, `_add_bullets`)
- Test: `apps/renderer/tests/test_pptx_generator.py`

**Interfaces:**
- Consumes: `self._shrink_text_to_fit(shape: Any, default_pt: float = 18.0) -> None` (existing, `pptx_generator.py:137`, unchanged).
- Produces: nothing new consumed by later tasks — Task 2 touches entirely separate functions.

- [ ] **Step 1: Write the failing tests**

Add to `apps/renderer/tests/test_pptx_generator.py`:

```python
def test_title_slide_shrinks_a_very_long_title_to_fit():
    long_title = "가" * 400
    output = PPTXGenerator().generate(_presentation(_slide("TITLE", long_title, {"heading": long_title})))
    slide = Presentation(BytesIO(output)).slides[0]
    title_shape = next(shape for shape in slide.shapes if shape.has_text_frame and shape.text_frame.text == long_title)
    auto_fit = title_shape.text_frame._txBody.bodyPr.find(qn("a:normAutofit"))
    assert auto_fit is not None and auto_fit.get("fontScale") is not None


def test_title_slide_leaves_a_short_title_at_full_size():
    output = PPTXGenerator().generate(_presentation(_slide("TITLE", "짧은 제목", {"heading": "짧은 제목"})))
    slide = Presentation(BytesIO(output)).slides[0]
    title_shape = next(shape for shape in slide.shapes if shape.has_text_frame and shape.text_frame.text == "짧은 제목")
    auto_fit = title_shape.text_frame._txBody.bodyPr.find(qn("a:normAutofit"))
    assert auto_fit is not None and auto_fit.get("fontScale") is None


def test_content_slide_shrinks_a_very_long_body_to_fit():
    long_body = "본문 " * 400
    output = PPTXGenerator().generate(_presentation(_slide("CONTENT", "제목", {"heading": "제목", "body": long_body})))
    slide = Presentation(BytesIO(output)).slides[0]
    body_shape = next(shape for shape in slide.shapes if shape.has_text_frame and shape.text_frame.text == long_body)
    auto_fit = body_shape.text_frame._txBody.bodyPr.find(qn("a:normAutofit"))
    assert auto_fit is not None and auto_fit.get("fontScale") is not None


def test_bullet_slide_shrinks_its_own_title_and_bullets_when_they_overflow():
    long_title = "가" * 400
    long_bullets = [{"text": "불렛 " * 60, "level": 0} for _ in range(5)]
    output = PPTXGenerator().generate(_presentation(_slide("BULLET_LIST", long_title, {"heading": long_title, "bullets": long_bullets})))
    slide = Presentation(BytesIO(output)).slides[0]
    title_shape = next(shape for shape in slide.shapes if shape.has_text_frame and shape.text_frame.text == long_title)
    title_auto_fit = title_shape.text_frame._txBody.bodyPr.find(qn("a:normAutofit"))
    assert title_auto_fit is not None and title_auto_fit.get("fontScale") is not None
    bullet_shape = next(shape for shape in slide.shapes if shape.has_text_frame and shape.text_frame.text.startswith("• 불렛"))
    bullet_auto_fit = bullet_shape.text_frame._txBody.bodyPr.find(qn("a:normAutofit"))
    assert bullet_auto_fit is not None and bullet_auto_fit.get("fontScale") is not None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker run --rm -v "$(pwd)/apps/renderer:/app/apps/renderer" -w /app jaslide/renderer:v0.6.1 sh -c "pip install --disable-pip-version-check --no-cache-dir pytest==8.4.2 httpx==0.28.1 >/dev/null 2>&1 && python -m pytest apps/renderer/tests/test_pptx_generator.py -k 'test_title_slide_shrinks or test_title_slide_leaves or test_content_slide_shrinks_a_very_long_body or test_bullet_slide_shrinks' -v"`
Expected: FAIL — `auto_fit` is `None` for the long-text cases (no `<a:normAutofit>` element is written at all, since nothing calls `_shrink_text_to_fit` yet).

- [ ] **Step 3: Wire `_add_title_slide`**

In `apps/renderer/src/generators/pptx_generator.py`, change:

```python
    def _add_title_slide(self, slide_data: Any):
        """Add title slide"""
        blank_layout = self.prs.slide_layouts[6]  # Blank layout
        slide = self.prs.slides.add_slide(blank_layout)
        self._apply_background(slide)

        content = slide_data.content
        title = content.get("heading", slide_data.title or "")
        subtitle = content.get("subheading", "")

        # Title
        title_layout = self._layout("title", {"x": 0.5, "y": 2.5, "w": 12.333, "h": 1.5, "fontSize": 54})
        title_box = self._add_layout_textbox(slide, title_layout)
        tf = title_box.text_frame
        tf.paragraphs[0].text = title
        self._style_paragraph(tf.paragraphs[0], title_layout["fontSize"], self.tokens["title_font"], bold=True)
        self._apply_alignment(tf.paragraphs[0], title_layout.get("align"))
        if "align" not in title_layout:
            tf.paragraphs[0].alignment = PP_ALIGN.CENTER

        # Subtitle
        if subtitle:
            subtitle_layout = self._layout("subtitle", {"x": 1, "y": 4.2, "w": 11.333, "h": 0.8, "fontSize": 24})
            sub_box = self._add_layout_textbox(slide, subtitle_layout)
            tf = sub_box.text_frame
            tf.paragraphs[0].text = subtitle
            self._style_paragraph(tf.paragraphs[0], subtitle_layout["fontSize"], self.tokens["body_font"])
            self._apply_alignment(tf.paragraphs[0], subtitle_layout.get("align"))
            if "align" not in subtitle_layout:
                tf.paragraphs[0].alignment = PP_ALIGN.CENTER
```

to:

```python
    def _add_title_slide(self, slide_data: Any):
        """Add title slide"""
        blank_layout = self.prs.slide_layouts[6]  # Blank layout
        slide = self.prs.slides.add_slide(blank_layout)
        self._apply_background(slide)

        content = slide_data.content
        title = content.get("heading", slide_data.title or "")
        subtitle = content.get("subheading", "")

        # Title
        title_layout = self._layout("title", {"x": 0.5, "y": 2.5, "w": 12.333, "h": 1.5, "fontSize": 54})
        title_box = self._add_layout_textbox(slide, title_layout)
        tf = title_box.text_frame
        tf.paragraphs[0].text = title
        self._style_paragraph(tf.paragraphs[0], title_layout["fontSize"], self.tokens["title_font"], bold=True)
        self._apply_alignment(tf.paragraphs[0], title_layout.get("align"))
        if "align" not in title_layout:
            tf.paragraphs[0].alignment = PP_ALIGN.CENTER
        self._shrink_text_to_fit(title_box)

        # Subtitle
        if subtitle:
            subtitle_layout = self._layout("subtitle", {"x": 1, "y": 4.2, "w": 11.333, "h": 0.8, "fontSize": 24})
            sub_box = self._add_layout_textbox(slide, subtitle_layout)
            tf = sub_box.text_frame
            tf.paragraphs[0].text = subtitle
            self._style_paragraph(tf.paragraphs[0], subtitle_layout["fontSize"], self.tokens["body_font"])
            self._apply_alignment(tf.paragraphs[0], subtitle_layout.get("align"))
            if "align" not in subtitle_layout:
                tf.paragraphs[0].alignment = PP_ALIGN.CENTER
            self._shrink_text_to_fit(sub_box)
```

- [ ] **Step 4: Wire `_add_content_slide`**

Change:

```python
        # Title
        title_layout = self._layout("title", {"x": 0.5, "y": 0.3, "w": 12.333, "h": 0.8, "fontSize": 36})
        title_box = self._add_layout_textbox(slide, title_layout)
        tf = title_box.text_frame
        tf.paragraphs[0].text = title
        self._style_paragraph(tf.paragraphs[0], title_layout["fontSize"], self.tokens["title_font"], bold=True)
        self._apply_alignment(tf.paragraphs[0], title_layout.get("align"))

        # ponytail: _add_table/_add_chart were only wired into the HTML-template
```

to:

```python
        # Title
        title_layout = self._layout("title", {"x": 0.5, "y": 0.3, "w": 12.333, "h": 0.8, "fontSize": 36})
        title_box = self._add_layout_textbox(slide, title_layout)
        tf = title_box.text_frame
        tf.paragraphs[0].text = title
        self._style_paragraph(tf.paragraphs[0], title_layout["fontSize"], self.tokens["title_font"], bold=True)
        self._apply_alignment(tf.paragraphs[0], title_layout.get("align"))
        self._shrink_text_to_fit(title_box)

        # ponytail: _add_table/_add_chart were only wired into the HTML-template
```

And change:

```python
        if body:
            body_layout = self._layout("body", {"x": 0.5, "y": 1.3, "w": 12.333, "h": 5.7, "fontSize": 20})
            body_box = self._add_layout_textbox(slide, body_layout)
            tf = body_box.text_frame
            tf.word_wrap = True
            tf.paragraphs[0].text = body
            self._style_paragraph(tf.paragraphs[0], body_layout["fontSize"], self.tokens["body_font"])
            self._apply_alignment(tf.paragraphs[0], body_layout.get("align"))

        if bullets:
            self._add_bullets(slide, bullets, content_top, content_height)
```

to:

```python
        if body:
            body_layout = self._layout("body", {"x": 0.5, "y": 1.3, "w": 12.333, "h": 5.7, "fontSize": 20})
            body_box = self._add_layout_textbox(slide, body_layout)
            tf = body_box.text_frame
            tf.word_wrap = True
            tf.paragraphs[0].text = body
            self._style_paragraph(tf.paragraphs[0], body_layout["fontSize"], self.tokens["body_font"])
            self._apply_alignment(tf.paragraphs[0], body_layout.get("align"))
            self._shrink_text_to_fit(body_box)

        if bullets:
            self._add_bullets(slide, bullets, content_top, content_height)
```

- [ ] **Step 5: Wire `_add_bullet_slide`**

Change:

```python
        # Title
        title_layout = self._layout("title", {"x": 0.5, "y": 0.3, "w": 12.333, "h": 0.8, "fontSize": 36})
        title_box = self._add_layout_textbox(slide, title_layout)
        tf = title_box.text_frame
        tf.paragraphs[0].text = title
        self._style_paragraph(tf.paragraphs[0], title_layout["fontSize"], self.tokens["title_font"], bold=True)
        self._apply_alignment(tf.paragraphs[0], title_layout.get("align"))

        # Bullets
        self._add_bullets(slide, bullets, Inches(1.3), Inches(5.7))
```

to:

```python
        # Title
        title_layout = self._layout("title", {"x": 0.5, "y": 0.3, "w": 12.333, "h": 0.8, "fontSize": 36})
        title_box = self._add_layout_textbox(slide, title_layout)
        tf = title_box.text_frame
        tf.paragraphs[0].text = title
        self._style_paragraph(tf.paragraphs[0], title_layout["fontSize"], self.tokens["title_font"], bold=True)
        self._apply_alignment(tf.paragraphs[0], title_layout.get("align"))
        self._shrink_text_to_fit(title_box)

        # Bullets
        self._add_bullets(slide, bullets, Inches(1.3), Inches(5.7))
```

- [ ] **Step 6: Wire the shared `_add_bullets` helper**

Change:

```python
            p.text = f"• {text}"
            self._style_paragraph(p, bullet_layout["fontSize"], self.tokens["body_font"])
            self._apply_alignment(p, bullet_layout.get("align"))
            p.level = level
            p.space_before = Pt(12)

    def _add_two_column_slide(self, slide_data: Any):
```

to:

```python
            p.text = f"• {text}"
            self._style_paragraph(p, bullet_layout["fontSize"], self.tokens["body_font"])
            self._apply_alignment(p, bullet_layout.get("align"))
            p.level = level
            p.space_before = Pt(12)

        if bullets:
            self._shrink_text_to_fit(bullet_box)

    def _add_two_column_slide(self, slide_data: Any):
```

(The `if bullets:` guard matches `_shrink_text_to_fit`'s own early return for empty text — `bullet_box` always exists once this point is reached, but skipping the call when there's nothing in it avoids a pointless no-op call.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `docker run --rm -v "$(pwd)/apps/renderer:/app/apps/renderer" -w /app jaslide/renderer:v0.6.1 sh -c "pip install --disable-pip-version-check --no-cache-dir pytest==8.4.2 httpx==0.28.1 >/dev/null 2>&1 && python -m pytest apps/renderer/tests/test_pptx_generator.py -v"`
Expected: PASS (all tests, including the new ones)

- [ ] **Step 8: Commit**

```bash
git add apps/renderer/src/generators/pptx_generator.py apps/renderer/tests/test_pptx_generator.py
git commit -m "feat(renderer): auto-fit text on title/content/bullet-list slides"
```

---

### Task 2: Auto-fit for two-column, quote, and section-header slides

**Files:**
- Modify: `apps/renderer/src/generators/pptx_generator.py` (`_add_two_column_slide`, `_add_column_bullets`, `_add_quote_slide`, `_add_section_header_slide`)
- Test: `apps/renderer/tests/test_pptx_generator.py`

**Interfaces:**
- Consumes: `self._shrink_text_to_fit(shape: Any, default_pt: float = 18.0) -> None` (existing, unchanged). Independent of Task 1 — touches entirely separate functions in the same file.

- [ ] **Step 1: Write the failing tests**

Add to `apps/renderer/tests/test_pptx_generator.py`:

```python
def test_two_column_slide_shrinks_a_very_long_column_header_to_fit():
    long_header = "가" * 200
    output = PPTXGenerator().generate(_presentation(_slide(
        "TWO_COLUMN", "비교",
        {"heading": "비교", "columns": [
            {"header": long_header, "bullets": [{"text": "항목", "level": 0}]},
            {"header": "짧은 헤더", "bullets": [{"text": "항목", "level": 0}]},
        ]},
    )))
    slide = Presentation(BytesIO(output)).slides[0]
    header_shape = next(shape for shape in slide.shapes if shape.has_text_frame and shape.text_frame.text == long_header)
    auto_fit = header_shape.text_frame._txBody.bodyPr.find(qn("a:normAutofit"))
    assert auto_fit is not None and auto_fit.get("fontScale") is not None


def test_two_column_slide_shrinks_a_very_long_column_bullet_list_to_fit():
    long_bullets = [{"text": "불렛 " * 60, "level": 0} for _ in range(6)]
    output = PPTXGenerator().generate(_presentation(_slide(
        "TWO_COLUMN", "비교",
        {"heading": "비교", "columns": [
            {"header": "왼쪽", "bullets": long_bullets},
            {"header": "오른쪽", "bullets": [{"text": "항목", "level": 0}]},
        ]},
    )))
    slide = Presentation(BytesIO(output)).slides[0]
    bullet_shape = next(shape for shape in slide.shapes if shape.has_text_frame and shape.text_frame.text.startswith("• 불렛"))
    auto_fit = bullet_shape.text_frame._txBody.bodyPr.find(qn("a:normAutofit"))
    assert auto_fit is not None and auto_fit.get("fontScale") is not None


def test_quote_slide_shrinks_a_very_long_quote_to_fit():
    long_quote = "인용 " * 200
    output = PPTXGenerator().generate(_presentation(_slide("QUOTE", "", {"body": long_quote})))
    slide = Presentation(BytesIO(output)).slides[0]
    quote_shape = next(shape for shape in slide.shapes if shape.has_text_frame and long_quote in shape.text_frame.text)
    auto_fit = quote_shape.text_frame._txBody.bodyPr.find(qn("a:normAutofit"))
    assert auto_fit is not None and auto_fit.get("fontScale") is not None


def test_section_header_slide_shrinks_a_very_long_title_to_fit():
    long_title = "가" * 300
    output = PPTXGenerator().generate(_presentation(_slide("SECTION_HEADER", long_title, {"heading": long_title})))
    slide = Presentation(BytesIO(output)).slides[0]
    title_shape = next(shape for shape in slide.shapes if shape.has_text_frame and shape.text_frame.text == long_title)
    auto_fit = title_shape.text_frame._txBody.bodyPr.find(qn("a:normAutofit"))
    assert auto_fit is not None and auto_fit.get("fontScale") is not None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker run --rm -v "$(pwd)/apps/renderer:/app/apps/renderer" -w /app jaslide/renderer:v0.6.1 sh -c "pip install --disable-pip-version-check --no-cache-dir pytest==8.4.2 httpx==0.28.1 >/dev/null 2>&1 && python -m pytest apps/renderer/tests/test_pptx_generator.py -k 'test_two_column_slide_shrinks or test_quote_slide_shrinks or test_section_header_slide_shrinks' -v"`
Expected: FAIL — no `<a:normAutofit>` element is written for any of these boxes yet.

- [ ] **Step 3: Wire `_add_two_column_slide`**

Change:

```python
        # Title
        title_layout = self._layout("title", {"x": 0.5, "y": 0.3, "w": 12.333, "h": 0.8, "fontSize": 36})
        title_box = self._add_layout_textbox(slide, title_layout)
        tf = title_box.text_frame
        tf.paragraphs[0].text = title
        self._style_paragraph(tf.paragraphs[0], title_layout["fontSize"], self.tokens["title_font"], bold=True)
        self._apply_alignment(tf.paragraphs[0], title_layout.get("align"))

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
                bullets = column.get("bullets") if isinstance(column.get("bullets"), list) else []
                self._add_column_bullets(slide, bullets, x, bullets_top, 1.3 + 5.7 - bullets_top)
            return
```

to:

```python
        # Title
        title_layout = self._layout("title", {"x": 0.5, "y": 0.3, "w": 12.333, "h": 0.8, "fontSize": 36})
        title_box = self._add_layout_textbox(slide, title_layout)
        tf = title_box.text_frame
        tf.paragraphs[0].text = title
        self._style_paragraph(tf.paragraphs[0], title_layout["fontSize"], self.tokens["title_font"], bold=True)
        self._apply_alignment(tf.paragraphs[0], title_layout.get("align"))
        self._shrink_text_to_fit(title_box)

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
```

- [ ] **Step 4: Wire the shared `_add_column_bullets` helper**

Change:

```python
    def _add_column_bullets(self, slide: Any, bullets: list, x: float, top: float, height: float) -> None:
        if not bullets:
            return
        box = slide.shapes.add_textbox(Inches(x), Inches(top), Inches(5.9), Inches(height))
        tf = box.text_frame
        tf.word_wrap = True
        for index, bullet in enumerate(bullets):
            if isinstance(bullet, dict):
                text = bullet.get("text", str(bullet))
                level = bullet.get("level", 0)
            else:
                text = str(bullet)
                level = 0
            paragraph = tf.paragraphs[0] if index == 0 else tf.add_paragraph()
            paragraph.text = f"• {text}"
            self._style_paragraph(paragraph, 18, self.tokens["body_font"])
            paragraph.level = level if isinstance(level, int) else 0
            paragraph.space_before = Pt(10)
```

to:

```python
    def _add_column_bullets(self, slide: Any, bullets: list, x: float, top: float, height: float) -> None:
        if not bullets:
            return
        box = slide.shapes.add_textbox(Inches(x), Inches(top), Inches(5.9), Inches(height))
        tf = box.text_frame
        tf.word_wrap = True
        for index, bullet in enumerate(bullets):
            if isinstance(bullet, dict):
                text = bullet.get("text", str(bullet))
                level = bullet.get("level", 0)
            else:
                text = str(bullet)
                level = 0
            paragraph = tf.paragraphs[0] if index == 0 else tf.add_paragraph()
            paragraph.text = f"• {text}"
            self._style_paragraph(paragraph, 18, self.tokens["body_font"])
            paragraph.level = level if isinstance(level, int) else 0
            paragraph.space_before = Pt(10)
        self._shrink_text_to_fit(box)
```

(This helper is also used by `_add_comparison_slide`, so this change applies auto-fit there too — a welcome side effect, not a regression, since that layout's bullets never had it either despite reusing this same helper.)

- [ ] **Step 5: Wire `_add_quote_slide`**

Change:

```python
        # Quote text
        body_layout = self._layout("body", {"x": 1.5, "y": 2.5, "w": 10.333, "h": 2, "fontSize": 32})
        quote_box = self._add_layout_textbox(slide, body_layout)
        tf = quote_box.text_frame
        tf.word_wrap = True
        tf.paragraphs[0].text = f'"{quote_text}"'
        self._style_paragraph(tf.paragraphs[0], body_layout["fontSize"], self.tokens["body_font"], italic=True)
        self._apply_alignment(tf.paragraphs[0], body_layout.get("align"))
        if "align" not in body_layout:
            tf.paragraphs[0].alignment = PP_ALIGN.CENTER
```

to:

```python
        # Quote text
        body_layout = self._layout("body", {"x": 1.5, "y": 2.5, "w": 10.333, "h": 2, "fontSize": 32})
        quote_box = self._add_layout_textbox(slide, body_layout)
        tf = quote_box.text_frame
        tf.word_wrap = True
        tf.paragraphs[0].text = f'"{quote_text}"'
        self._style_paragraph(tf.paragraphs[0], body_layout["fontSize"], self.tokens["body_font"], italic=True)
        self._apply_alignment(tf.paragraphs[0], body_layout.get("align"))
        if "align" not in body_layout:
            tf.paragraphs[0].alignment = PP_ALIGN.CENTER
        self._shrink_text_to_fit(quote_box)
```

- [ ] **Step 6: Wire `_add_section_header_slide`**

Change:

```python
        # Large centered title
        title_layout = self._layout("title", {"x": 0.5, "y": 3, "w": 12.333, "h": 1.5, "fontSize": 48})
        title_box = self._add_layout_textbox(slide, title_layout)
        tf = title_box.text_frame
        tf.paragraphs[0].text = title
        self._style_paragraph(tf.paragraphs[0], title_layout["fontSize"], self.tokens["title_font"], bold=True)
        self._apply_alignment(tf.paragraphs[0], title_layout.get("align"))
        if "align" not in title_layout:
            tf.paragraphs[0].alignment = PP_ALIGN.CENTER
```

to:

```python
        # Large centered title
        title_layout = self._layout("title", {"x": 0.5, "y": 3, "w": 12.333, "h": 1.5, "fontSize": 48})
        title_box = self._add_layout_textbox(slide, title_layout)
        tf = title_box.text_frame
        tf.paragraphs[0].text = title
        self._style_paragraph(tf.paragraphs[0], title_layout["fontSize"], self.tokens["title_font"], bold=True)
        self._apply_alignment(tf.paragraphs[0], title_layout.get("align"))
        if "align" not in title_layout:
            tf.paragraphs[0].alignment = PP_ALIGN.CENTER
        self._shrink_text_to_fit(title_box)
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `docker run --rm -v "$(pwd)/apps/renderer:/app/apps/renderer" -w /app jaslide/renderer:v0.6.1 sh -c "pip install --disable-pip-version-check --no-cache-dir pytest==8.4.2 httpx==0.28.1 >/dev/null 2>&1 && python -m pytest apps/renderer/tests/test_pptx_generator.py -v"`
Expected: PASS (all tests, including the new ones)

- [ ] **Step 8: Commit**

```bash
git add apps/renderer/src/generators/pptx_generator.py apps/renderer/tests/test_pptx_generator.py
git commit -m "feat(renderer): auto-fit text on two-column/quote/section-header slides"
```
