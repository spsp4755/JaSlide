# HTML Template Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an administrator supply a restricted HTML slide layout whose named slots position generated content in exported PPTX files.

**Architecture:** HTML is parsed as layout metadata, never rendered or executed. A parser accepts named slots with bounded coordinates, then `PPTXGenerator` applies them to editable PowerPoint text boxes and otherwise retains its current built-in layout.

**Tech Stack:** Python 3.10+, `html.parser`, python-pptx, pytest.

## Global Constraints

- Never execute JavaScript, fetch URLs, or embed arbitrary HTML.
- Only `title`, `subtitle`, `body`, and `bullets` slots are accepted.
- Rectangles are positive finite inches within the 13.333 x 7.5 slide.
- Imported PPTX color and Korean font tokens stay unchanged.
- Invalid or absent HTML retains the current standard layout.

---

### Task 1: Parse restricted layout tags

**Files:** Create `apps/renderer/src/services/html_template.py`; create `apps/renderer/tests/test_html_template.py`.

- [ ] Write a failing test that `parse_html_layout('<h1 data-jaslide-slot="title" data-x="1" data-y="2" data-w="10" data-h="1" data-font-size="42" data-align="center"></h1>')` returns exactly `{'title': {'x': 1.0, 'y': 2.0, 'w': 10.0, 'h': 1.0, 'fontSize': 42, 'align': 'center'}}`, and invalid slots or rectangles return `{}`.
- [ ] Run `py -3.13 -m pytest apps/renderer/tests/test_html_template.py -q`; expect import failure.
- [ ] Implement `parse_html_layout(template: str) -> dict[str, dict]` using `HTMLParser`; use only `data-jaslide-slot`, `data-x`, `data-y`, `data-w`, `data-h`, `data-font-size`, and `data-align`; cap font size to 8..72.
- [ ] Run the same pytest command; expect PASS.
- [ ] Commit with `feat(renderer): parse safe HTML template layouts`.

### Task 2: Apply slots to PPTX

**Files:** Modify `apps/renderer/src/generators/pptx_generator.py`; modify `apps/renderer/tests/test_pptx_generator.py`.

- [ ] Write a failing test using `config.htmlTemplate` with title at x=1, y=1, w=9, h=1 and centered alignment, and body at y=2 with `data-font-size=22`; assert the exported shapes have those EMU coordinates, alignment, and point size.
- [ ] Run `py -3.13 -m pytest apps/renderer/tests/test_pptx_generator.py::test_html_template_layout_positions_content_textboxes -q`; expect FAIL because the field is ignored.
- [ ] In `PPTXGenerator.__init__`, parse `config['htmlTemplate']`; add one `_layout(slot, defaults)` helper; apply it only to title, subtitle, and body text boxes. Keep defaults unchanged if a slot is absent.
- [ ] Run `py -3.13 -m pytest apps/renderer/tests/test_pptx_generator.py -q` and `py -3.13 -m pytest apps/renderer/tests -q`; expect PASS.
- [ ] Commit with `feat(renderer): apply HTML template layouts to PPTX`.

### Task 3: Publish administrator contract

**Files:** Create `docs/html-template-contract.md`.

- [ ] Document `config.htmlTemplate`, allowed slots and attributes, ranges, invalid-layout fallback, and this exact safe example: `<h1 data-jaslide-slot="title" data-x="0.7" data-y="0.5" data-w="11.9" data-h="0.8" data-font-size="38" data-align="left"></h1>`.
- [ ] Run `py -3.13 -m pytest apps/renderer/tests -q`; expect PASS.
- [ ] Commit with `docs: describe HTML template layout contract`.
