# PPTX 불릿/들여쓰기 충실도 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PPTX-template-based generation actually honor the template's own bullet/indentation formatting at each level, instead of setting a bare `paragraph.level` number that most hand-designed templates render identically to level 0.

**Architecture:** The renderer (`apps/renderer/src/generators/pptx_generator.py`) stops constructing brand-new paragraphs with an assigned level number, and instead clones an actual paragraph that already exists at that level in the template — copying its real `a:pPr`/`a:rPr` formatting byte-for-byte and only swapping the text. The Go generation service computes, per slide, which levels the destination template slide's objects actually support, and grounds the LLM prompt in that real set instead of a blanket "0-4".

**Tech Stack:** Python (python-pptx, lxml via python-pptx's oxml layer), Go.

## Global Constraints

- No new dependency in either language.
- The existing "user manually formats part of a sentence via chat edit" path (multiple runs per paragraph, or a run with explicit bold/italic/color/etc.) must keep building paragraphs from scratch exactly as today — the prototype-cloning path only applies to the plain `{text, level}` shape the AI-generation path produces. This is a hard regression constraint: `test_native_edit_writes_mixed_run_formatting_within_one_paragraph` and `test_native_table_cell_writes_mixed_run_formatting` (both already in `apps/renderer/tests/test_pptx_generator.py`) must keep passing unmodified.
- `frame.clear()` (python-pptx `TextFrame.clear()`) does **not** remove the frame's first paragraph — it keeps that paragraph's `<a:pPr>` untouched and only strips its runs. Do not rely on `.clear()` in the rewritten code; remove every existing `<a:p>` element directly via `frame._txBody` so no leftover paragraph survives.
- `apps/core-api/internal/generation` does not import `apps/core-api/internal/skills` today (verified: no cross-package import exists). Do not introduce one — write a small local equivalent of `hierarchyLinesFrom` inside the `generation` package rather than importing `skills`. The two packages already have parallel, independently-defined level-carrying line types (`skills.hierarchyLine` and `generation.contentLine`) — this plan follows that existing precedent instead of coupling the packages.
- `Process()` in `service.go` currently calls `SlideContent` (which builds the prompt) **before** `chooseTemplateIndex` picks which template slide this content is destined for. Grounding the prompt in the destination slide's real levels requires computing `templateIndex` earlier, before the `SlideContent` call — this plan includes that reordering. `chooseTemplateIndex(item.TemplateIndex, index, capable)` only depends on the outline (already available) and `capable` (already computed earlier in `Process()`), not on anything `SlideContent` produces, so moving it earlier is safe.

---

### Task 1: Renderer — prototype-paragraph-by-level cloning

**Files:**
- Modify: `apps/renderer/src/generators/pptx_generator.py:318-340` (`_write_paragraphs`), `apps/renderer/src/generators/pptx_generator.py:396-431` (inline duplicate block inside `_apply_native_edit`)
- Test: `apps/renderer/tests/test_pptx_generator.py`

**Interfaces:**
- Produces: `_write_paragraphs(self, frame, paragraphs: list) -> None` — same signature as today, now used by both the direct text-shape path and (via the `_apply_native_edit` cleanup below) the inline block that used to duplicate it.
- Produces: `_run_has_explicit_style(run_item: dict | None) -> bool` and `_strip_leading_bullet_marker(text: str) -> str` — small private helpers, only called from `_write_paragraphs`.

- [ ] **Step 1: Write the failing test for level-aware prototype cloning**

Add `from pptx.oxml.xmlchemy import OxmlElement` to `apps/renderer/tests/test_pptx_generator.py`'s import block (after the existing `from pptx.oxml.ns import qn` line at line 12) — the new test below needs it and it isn't imported yet. `base64`, `BytesIO`, `SimpleNamespace`, `Presentation`, `qn`, `Inches`, `Pt` are already imported, no other changes needed there.

Then add to `apps/renderer/tests/test_pptx_generator.py` (place near the other `test_pptx_template_preserves_paragraph_indent_*` tests, after line 849):

```python
def test_native_edit_clones_the_templates_own_paragraph_at_the_requested_level():
    # The template has two real paragraphs: level 0 with a custom font size,
    # and level 1 with an explicit bullet character set on its pPr (buChar).
    # A python-pptx `paragraph.level = 1` on a *freshly built* paragraph would
    # carry neither of these — this test proves the rewritten path copies the
    # actual level-1 paragraph's formatting instead of inventing a bare level.
    source = Presentation()
    slide = source.slides.add_slide(source.slide_layouts[6])
    text = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(4), Inches(2))
    text.text_frame.paragraphs[0].text = "Top"
    text.text_frame.paragraphs[0].runs[0].font.size = Pt(30)
    nested = text.text_frame.add_paragraph()
    nested.text = "Nested example"
    nested.level = 1
    nested_pPr = nested._p.get_or_add_pPr()
    buChar = OxmlElement("a:buChar")
    buChar.set("char", "◆")
    nested_pPr.append(buChar)
    buffer = BytesIO(); source.save(buffer)
    template = SimpleNamespace(config=SimpleNamespace(sourcePptx=base64.b64encode(buffer.getvalue()).decode("ascii")))

    edit = {
        "slide": 0, "objectId": str(text.shape_id),
        "paragraphs": [
            {"text": "New top", "level": 0},
            {"text": "New nested", "level": 1},
        ],
    }
    output = PPTXGenerator(template).generate(_presentation(_slide("CONTENT", "", {"objectEdits": [edit]})))

    paragraphs = Presentation(BytesIO(output)).slides[0].shapes[0].text_frame.paragraphs
    assert [p.text for p in paragraphs] == ["New top", "New nested"]
    assert paragraphs[0].runs[0].font.size == Pt(30)
    assert paragraphs[1].level == 1
    copied_buChar = paragraphs[1]._p.find(qn("a:pPr")).find(qn("a:buChar"))
    assert copied_buChar is not None and copied_buChar.get("char") == "◆"


def test_native_edit_falls_back_to_nearest_level_when_the_template_lacks_that_depth():
    # The template only has level 0. Asking for level 3 must not invent a new
    # formatting style — it should fall back to the level-0 prototype's own
    # formatting rather than a bare, unstyled paragraph.
    source = Presentation()
    slide = source.slides.add_slide(source.slide_layouts[6])
    text = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(4), Inches(1))
    text.text_frame.paragraphs[0].text = "Only level"
    text.text_frame.paragraphs[0].runs[0].font.size = Pt(22)
    buffer = BytesIO(); source.save(buffer)
    template = SimpleNamespace(config=SimpleNamespace(sourcePptx=base64.b64encode(buffer.getvalue()).decode("ascii")))

    edit = {"slide": 0, "objectId": str(text.shape_id), "paragraphs": [{"text": "Deep line", "level": 3}]}
    output = PPTXGenerator(template).generate(_presentation(_slide("CONTENT", "", {"objectEdits": [edit]})))

    paragraph = Presentation(BytesIO(output)).slides[0].shapes[0].text_frame.paragraphs[0]
    assert paragraph.text == "Deep line"
    assert paragraph.runs[0].font.size == Pt(22)


def test_native_edit_strips_a_literal_bullet_character_the_model_wrote_by_mistake():
    source = Presentation()
    slide = source.slides.add_slide(source.slide_layouts[6])
    text = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(4), Inches(1))
    text.text_frame.paragraphs[0].text = "Original"
    buffer = BytesIO(); source.save(buffer)
    template = SimpleNamespace(config=SimpleNamespace(sourcePptx=base64.b64encode(buffer.getvalue()).decode("ascii")))

    edit = {"slide": 0, "objectId": str(text.shape_id), "paragraphs": [{"text": "• Written with a bullet", "level": 0}]}
    output = PPTXGenerator(template).generate(_presentation(_slide("CONTENT", "", {"objectEdits": [edit]})))

    assert Presentation(BytesIO(output)).slides[0].shapes[0].text_frame.paragraphs[0].text == "Written with a bullet"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/renderer && python -m pytest tests/test_pptx_generator.py -k "clones_the_templates_own_paragraph or falls_back_to_nearest_level or strips_a_literal_bullet" -v`
Expected: FAIL — `test_native_edit_clones_the_templates_own_paragraph_at_the_requested_level` fails on `assert paragraphs[0].runs[0].font.size == Pt(30)` (current code builds a fresh paragraph and never copies the original's run size); `test_native_edit_falls_back_to_nearest_level_when_the_template_lacks_that_depth` fails the same way; `test_native_edit_strips_a_literal_bullet_character_the_model_wrote_by_mistake` fails because the bullet character is still in the text.

- [ ] **Step 3: Rewrite `_write_paragraphs`**

Replace `apps/renderer/src/generators/pptx_generator.py:318-340` with:

```python
    _BULLET_MARKER_CHARS = "-–—•·∙‣▪▫◦*"

    @classmethod
    def _strip_leading_bullet_marker(cls, text: str) -> str:
        """Drop a literal bullet character the model wrote at the start of a
        line — the template's own a:buChar already draws one; writing both
        doubles it up."""
        stripped = text.lstrip(" \t")
        indent = text[: len(text) - len(stripped)]
        marker_end = 0
        while marker_end < len(stripped) and stripped[marker_end] in cls._BULLET_MARKER_CHARS:
            marker_end += 1
        if marker_end == 0:
            return text
        rest = stripped[marker_end:]
        if rest and not rest[0] in " \t":
            return text  # not actually a marker followed by a space — e.g. "1-2" or a real hyphenated word
        return indent + rest.lstrip(" \t")

    @staticmethod
    def _run_has_explicit_style(run_item: Optional[dict]) -> bool:
        if not run_item:
            return False
        return any(run_item.get(key) not in (None, "") for key in ("bold", "italic", "underline", "color", "fontSize", "fontFamily"))

    @staticmethod
    def _set_first_run_text(paragraph_element, text: str) -> None:
        runs = paragraph_element.findall(qn("a:r"))
        for extra in runs[1:]:
            paragraph_element.remove(extra)
        if not runs:
            return
        text_element = runs[0].find(qn("a:t"))
        if text_element is None:
            return
        text_element.text = text

    def _write_paragraphs(self, frame: Any, paragraphs: list) -> None:
        prototypes_by_level: dict[int, list] = {}
        for paragraph in frame.paragraphs:
            prototypes_by_level.setdefault(paragraph.level or 0, []).append(copy.deepcopy(paragraph._p))

        # frame.clear() special-cases the first paragraph (keeps its <a:pPr>,
        # only strips runs) instead of removing it — remove every existing
        # paragraph ourselves so nothing is left over before we start writing.
        for existing in list(frame._txBody.p_lst):
            frame._txBody.remove(existing)

        used_by_level: dict[int, int] = {}

        def pick_prototype(level: int):
            if not prototypes_by_level:
                return None
            candidates = prototypes_by_level.get(level)
            if not candidates:
                nearest = min(prototypes_by_level, key=lambda existing_level: abs(existing_level - level))
                candidates = prototypes_by_level[nearest]
            index = used_by_level.get(level, 0)
            used_by_level[level] = index + 1
            return candidates[min(index, len(candidates) - 1)]

        for item in paragraphs:
            if not isinstance(item, dict):
                continue
            runs = item.get("runs")
            level = max(0, item["level"]) if isinstance(item.get("level"), int) else 0
            single_run = runs[0] if isinstance(runs, list) and len(runs) == 1 else None
            is_simple = (not isinstance(runs, list) or len(runs) <= 1) and not self._run_has_explicit_style(single_run)

            if is_simple:
                prototype = pick_prototype(level)
                if prototype is not None:
                    text = str(single_run.get("text", "")) if single_run else str(item.get("text", ""))
                    text = self._strip_leading_bullet_marker(text)
                    clone = copy.deepcopy(prototype)
                    self._set_first_run_text(clone, text)
                    frame._txBody.append(clone)
                    continue

            # Explicit per-run styling (chat-edit character formatting) or a
            # template with no paragraphs at all to clone from — build fresh,
            # exactly as before.
            paragraph = frame.add_paragraph()
            if isinstance(item.get("level"), int):
                paragraph.level = level
            if isinstance(item.get("align"), str):
                alignment = _PARAGRAPH_ALIGNMENTS.get(item["align"])
                if alignment is not None:
                    paragraph.alignment = alignment
            if isinstance(runs, list) and runs:
                for run_item in runs:
                    if not isinstance(run_item, dict):
                        continue
                    run = paragraph.add_run()
                    run.text = str(run_item.get("text", ""))
                    if isinstance(run_item.get("bold"), bool):
                        run.font.bold = run_item["bold"]
                    if isinstance(run_item.get("italic"), bool):
                        run.font.italic = run_item["italic"]
                    if isinstance(run_item.get("underline"), bool):
                        run.font.underline = run_item["underline"]
                    if isinstance(run_item.get("color"), str) and len(run_item["color"].lstrip("#")) == 6:
                        run.font.color.rgb = RGBColor.from_string(run_item["color"].lstrip("#").upper())
                    if isinstance(run_item.get("fontSize"), (int, float)):
                        run.font.size = Pt(run_item["fontSize"])
                    if isinstance(run_item.get("fontFamily"), str):
                        run.font.name = run_item["fontFamily"]
            else:
                paragraph.text = str(item.get("text", ""))
```

Add `Optional` to the existing `from typing import Optional, Any` import at line 23 — it's already imported, no change needed there.

- [ ] **Step 4: Collapse `_apply_native_edit`'s duplicate block to call `_write_paragraphs`**

In `apps/renderer/src/generators/pptx_generator.py`, replace lines 396-431 (the `if getattr(shape, "has_text_frame", False) and isinstance(edit.get("paragraphs"), list):` block) with:

```python
        if getattr(shape, "has_text_frame", False) and isinstance(edit.get("paragraphs"), list):
            self._write_paragraphs(shape.text_frame, edit["paragraphs"])
```

Also replace the table-cell dict-paragraphs branch, `apps/renderer/src/generators/pptx_generator.py:513-514` (`self._write_paragraphs(shape.table.cell(row_index, column_index).text_frame, value["paragraphs"])`) — this one already calls `_write_paragraphs`, so it needs no change; leave it as-is.

- [ ] **Step 5: Run the new tests and the full regression suite**

Run: `cd apps/renderer && python -m pytest tests/test_pptx_generator.py -v`
Expected: All tests PASS, including the 3 new ones and the pre-existing `test_native_edit_writes_mixed_run_formatting_within_one_paragraph`, `test_native_table_cell_writes_mixed_run_formatting`, `test_pptx_template_preserves_paragraph_indent_when_text_changes`, `test_pptx_text_replace_preserves_paragraph_alignment`, `test_pptx_table_cell_replace_preserves_paragraph_alignment`.

- [ ] **Step 6: Commit**

```bash
git add apps/renderer/src/generators/pptx_generator.py apps/renderer/tests/test_pptx_generator.py
git commit -m "fix(renderer): clone the template's own same-level paragraph instead of a bare level number"
```

---

### Task 2: Go — ground the prompt in the destination slide's real levels, plus prompt framing

**Files:**
- Modify: `apps/core-api/internal/generation/service.go` (add `availableLevels`, reorder `Process()`, extend `SlideRequest`)
- Modify: `apps/core-api/internal/generation/llm.go` (`slidePrompt`)
- Modify: `apps/core-api/internal/skills/hierarchy_guidance.go` (`formatHierarchyExample` wording)
- Test: `apps/core-api/internal/generation/service_test.go` or `apps/core-api/internal/generation/hierarchy_guidance_test.go` (new file in `generation` package — do not confuse with the existing `apps/core-api/internal/skills/hierarchy_guidance_test.go`, a different package), `apps/core-api/internal/generation/llm_test.go`, `apps/core-api/internal/skills/hierarchy_guidance_test.go`

**Interfaces:**
- Consumes: `templateData.objects(index int) []map[string]any` (already defined, `service.go:598`) — same object shape `pptxObjectEdits` already consumes (each object has `"kind"`: `"text"` with a `"paragraphs"` list, or `"table"` with a `"cellParagraphs"` list of rows of cells, each paragraph/cell-paragraph a `map[string]any` with a `"level"` float64 field).
- Produces: `availableLevels(objects []map[string]any) []int` in package `generation` — sorted ascending, empty slice semantics: returns `nil` when no object carries any level information.
- Produces: `SlideRequest.AvailableLevels []int` (new field) — read by `slidePrompt` in `llm.go`.

- [ ] **Step 1: Write the failing test for `availableLevels`**

Create `apps/core-api/internal/generation/hierarchy_test.go`:

```go
package generation

import (
	"reflect"
	"testing"
)

func TestAvailableLevelsReturnsTheSortedUnionAcrossTextAndTableObjects(t *testing.T) {
	objects := []map[string]any{
		{
			"kind": "text",
			"paragraphs": []any{
				map[string]any{"text": "Top", "level": float64(0)},
				map[string]any{"text": "Nested", "level": float64(2)},
			},
		},
		{
			"kind": "table",
			"cellParagraphs": []any{
				[]any{
					[]any{map[string]any{"text": "Cell", "level": float64(1)}},
				},
			},
		},
	}
	got := availableLevels(objects)
	want := []int{0, 1, 2}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("availableLevels() = %v, want %v", got, want)
	}
}

func TestAvailableLevelsReturnsNilWhenNoObjectCarriesLevelInformation(t *testing.T) {
	objects := []map[string]any{{"kind": "text", "paragraphs": []any{}}}
	if got := availableLevels(objects); got != nil {
		t.Fatalf("availableLevels() = %v, want nil", got)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./apps/core-api/internal/generation/... -run TestAvailableLevels -v`
Expected: FAIL with `undefined: availableLevels`

- [ ] **Step 3: Implement `availableLevels`**

Create `apps/core-api/internal/generation/hierarchy.go`:

```go
package generation

import "sort"

// availableLevels returns the sorted union of indentation levels actually
// present across a slide's text and table objects, so slidePrompt can tell
// the model exactly which levels this specific template slide supports
// instead of a blanket 0-4 range. Mirrors the skills package's
// hierarchyLinesFrom in spirit (same source shape: object["paragraphs"] for
// text, object["cellParagraphs"] rows-of-cells-of-paragraphs for tables) but
// is defined locally — generation does not import skills, matching the
// existing precedent of the two packages each having their own
// level-carrying line type (skills.hierarchyLine vs generation.contentLine).
func availableLevels(objects []map[string]any) []int {
	seen := map[int]bool{}
	for _, object := range objects {
		switch object["kind"] {
		case "text":
			collectLevels(object["paragraphs"], seen)
		case "table":
			rows, _ := object["cellParagraphs"].([]any)
			for _, rawRow := range rows {
				row, _ := rawRow.([]any)
				for _, rawCell := range row {
					collectLevels(rawCell, seen)
				}
			}
		}
	}
	if len(seen) == 0 {
		return nil
	}
	levels := make([]int, 0, len(seen))
	for level := range seen {
		levels = append(levels, level)
	}
	sort.Ints(levels)
	return levels
}

func collectLevels(raw any, seen map[int]bool) {
	items, _ := raw.([]any)
	for _, rawItem := range items {
		item, ok := rawItem.(map[string]any)
		if !ok {
			continue
		}
		if level, ok := item["level"].(float64); ok {
			seen[int(level)] = true
		}
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./apps/core-api/internal/generation/... -run TestAvailableLevels -v`
Expected: PASS

- [ ] **Step 5: Thread `AvailableLevels` through `SlideRequest` and reorder `Process()`**

In `apps/core-api/internal/generation/service.go`, add the field to `SlideRequest` (near line 147, right after `SkillGuidance string`):

```go
type SlideRequest struct {
	Title, Type, Language string
	KeyPoints             []string
	SkillGuidance         string
	// AvailableLevels is the sorted set of indentation levels this slide's
	// destination template objects actually support — empty for non-PPTX
	// slides, where slidePrompt falls back to a generic 0-4 range.
	AvailableLevels []int
}
```

Replace the loop body at `service.go:373-397` (`for index, item := range outline.Slides { ... }`) — move `templateIndex`'s computation before the `SlideContent` call and compute `AvailableLevels` from it:

```go
	for index, item := range outline.Slides {
		templateIndex := chooseTemplateIndex(item.TemplateIndex, index, capable)
		var levels []int
		if template.PPTX && templateIndex >= 0 {
			levels = availableLevels(template.objects(templateIndex))
		}
		rawContent, contentErr := service.llm.SlideContent(ctx, SlideRequest{
			Title: item.Title, Type: item.Type, Language: input.Language, KeyPoints: item.KeyPoints,
			SkillGuidance: input.SkillGuidance, AvailableLevels: levels,
		})
		if contentErr != nil {
			service.fail(ctx, jobID, contentErr)
			return
		}
		if feedback, critiqueErr := service.llm.Critique(ctx, CritiqueRequest{
			Content: rawContent, Title: item.Title, KeyPoints: item.KeyPoints,
		}); critiqueErr == nil && feedback != "" {
			if revised, editErr := service.llm.Edit(ctx, rawContent, feedback, item.Type); editErr == nil {
				rawContent = revised
			}
		}
		fields := rawObject(rawContent)
		if templateIndex >= 0 {
			fields["templateIndex"] = templateIndex
		}
		if template.PPTX && templateIndex >= 0 {
			fields["objectEdits"] = pptxObjectEdits(
				template.objects(templateIndex), templateIndex, item.Title, slideLines(fields, item.KeyPoints),
			)
		} else if templateIndex >= 0 && templateIndex < len(template.HTMLSlides) {
```

(The rest of the loop body — the `else if` branch through its closing brace — is unchanged; only the two lines that used to read `templateIndex := chooseTemplateIndex(...)` right after `fields := rawObject(rawContent)` are removed, since that computation now happens at the top of the loop instead.)

- [ ] **Step 6: Write the failing test for `slidePrompt` using `AvailableLevels`**

Add to `apps/core-api/internal/generation/llm_test.go`:

```go
func TestSlidePromptUsesAvailableLevelsWhenPresent(t *testing.T) {
	withLevels := slidePrompt(SlideRequest{Title: "T", Type: "CONTENT", AvailableLevels: []int{0, 2}})
	if strings.Contains(withLevels, "level 0-4 for indentation") {
		t.Fatal("slidePrompt() kept the generic 0-4 range when AvailableLevels was set")
	}
	if !strings.Contains(withLevels, "0, 2") {
		t.Fatalf("slidePrompt() = %q, want it to mention the available levels 0, 2", withLevels)
	}

	withoutLevels := slidePrompt(SlideRequest{Title: "T", Type: "CONTENT"})
	if !strings.Contains(withoutLevels, "level 0-4 for indentation") {
		t.Fatal("slidePrompt() dropped the generic 0-4 fallback when AvailableLevels was empty")
	}
}

func TestSlidePromptInstructsAgainstLiteralBulletCharacters(t *testing.T) {
	prompt := slidePrompt(SlideRequest{Title: "T", Type: "CONTENT"})
	if !strings.Contains(prompt, "bullet characters") {
		t.Fatal("slidePrompt() does not instruct the model to avoid literal bullet characters")
	}
}
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `go test ./apps/core-api/internal/generation/... -run TestSlidePromptUsesAvailableLevels -v`
Run: `go test ./apps/core-api/internal/generation/... -run TestSlidePromptInstructsAgainstLiteralBulletCharacters -v`
Expected: Both FAIL — `withLevels` still contains "level 0-4 for indentation" (nothing branches on `AvailableLevels` yet); the second test fails because no such instruction exists yet.

- [ ] **Step 8: Update `slidePrompt`**

In `apps/core-api/internal/generation/llm.go`, replace the `slidePrompt` function (lines 775-793) with:

```go
func slidePrompt(input SlideRequest) string {
	guidance := ""
	if strings.TrimSpace(input.SkillGuidance) != "" {
		guidance = "\n\n[Writing Skill Guide]\n" + input.SkillGuidance
	}
	levelGuidance := "level 0-4 for indentation"
	if len(input.AvailableLevels) > 0 {
		parts := make([]string, len(input.AvailableLevels))
		for i, level := range input.AvailableLevels {
			parts[i] = strconv.Itoa(level)
		}
		levelGuidance = fmt.Sprintf("level — only these values are usable in this template: %s", strings.Join(parts, ", "))
	}
	return fmt.Sprintf(
		"Create concise slide content in %s. Title: %s. Type: %s. Key points: %s. "+
			"Return JSON only with heading, optional subheading/body, 3-5 bullets "+
			"(each an object with text and %s), "+
			"Do not write bullet characters (-, •) as literal text in the bullet text — the template already draws them. "+
			"chart for CHART as {\"labels\":[\"...\"],\"values\":[0]}, "+
			"table for TABLE as {\"headers\":[\"...\"],\"rows\":[[\"...\"]]}, "+
			"columns for TWO_COLUMN as exactly two {\"header\":\"...\",\"bullets\":[{\"text\":\"...\",\"level\":0}]} objects, "+
			"timeline for TIMELINE as {\"items\":[{\"date\":\"...\",\"label\":\"...\",\"description\":\"...\"}]} with 3-8 items, "+
			"process for PROCESS as {\"steps\":[{\"label\":\"...\",\"description\":\"...\"}]} with 2-6 steps, "+
			"comparison for COMPARISON as {\"left\":{\"title\":\"...\",\"bullets\":[\"...\"]},\"right\":{\"title\":\"...\",\"bullets\":[\"...\"]}}, "+
			"and metrics for KPI as {\"metrics\":[{\"value\":\"...\",\"label\":\"...\"}]} with 2-6 cards.%s%s",
		input.Language, input.Title, input.Type, strings.Join(input.KeyPoints, "; "), levelGuidance, dateGuidance(), guidance,
	)
}
```

Add `"strconv"` to `llm.go`'s import block (it is not imported today — verified against the current file, which imports `"bytes"`, `"context"`, `"encoding/json"`, `"errors"`, `"fmt"`, `"io"`, `"net/http"`, `"net/url"`, `"strings"`, `"time"`, and the local `outboundpolicy` package, in that order):

```go
import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/spsp4755/JaSlide/apps/core-api/internal/outboundpolicy"
)
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `go test ./apps/core-api/internal/generation/... -v`
Expected: All tests PASS, including `TestSlidePromptUsesAvailableLevelsWhenPresent`, `TestSlidePromptInstructsAgainstLiteralBulletCharacters`, `TestAvailableLevelsReturnsTheSortedUnionAcrossTextAndTableObjects`, `TestAvailableLevelsReturnsNilWhenNoObjectCarriesLevelInformation`, and every pre-existing test in the package (in particular `TestSlidePromptIncludesSkillGuidanceWhenPresent` and `TestProcessPassesSkillGuidanceToSlideContentToo`, to confirm the `Process()` reordering in Step 5 didn't break `SkillGuidance` threading).

- [ ] **Step 10: Write the failing test for the reworded hierarchy example**

The literal example text `bulletHierarchyExample` embeds into `outlineGuidance` (`apps/core-api/internal/skills/hierarchy_guidance.go`) flows into `slidePrompt` verbatim via `SkillGuidance` — if the model reads `레벨 0 예: '실적 요약'` without being told it's a structure example, it risks copying that literal example text instead of writing new content. Add to `apps/core-api/internal/skills/hierarchy_guidance_test.go`:

```go
func TestBulletHierarchyExampleTellsTheModelNotToReuseTheExampleTextVerbatim(t *testing.T) {
	config := map[string]any{
		"source": map[string]any{
			"slides": []any{
				map[string]any{
					"objects": []any{
						map[string]any{
							"kind": "text",
							"paragraphs": []any{
								map[string]any{"text": "Top", "level": float64(0)},
								map[string]any{"text": "Nested", "level": float64(1)},
							},
						},
					},
				},
			},
		},
	}
	example := bulletHierarchyExample(config)
	if !strings.Contains(example, "그대로 재사용하지") {
		t.Fatalf("bulletHierarchyExample() = %q, want it to say the examples are not for verbatim reuse", example)
	}
}
```

- [ ] **Step 11: Run test to verify it fails**

Run: `go test ./apps/core-api/internal/skills/... -run TestBulletHierarchyExampleTellsTheModelNotToReuseTheExampleTextVerbatim -v`
Expected: FAIL — the current wording doesn't contain that phrase.

- [ ] **Step 12: Reword `formatHierarchyExample`**

In `apps/core-api/internal/skills/hierarchy_guidance.go`, replace the `formatHierarchyExample` function body's final `return` (lines 98-103):

```go
	return fmt.Sprintf(
		"이 템플릿의 표/목록은 최대 %d단계 들여쓰기 구조를 사용합니다 (%s — 이 예시 문구는 깊이 구조를 보여주기 위한 것으로, "+
			"내용을 생성할 때 그대로 재사용하지 말고 새 내용을 쓰세요). "+
			"내용을 생성할 때도 각 줄이 대분류인지 하위 항목인지 스스로 판단해 이런 깊이의 계층 구조로 작성하고, "+
			"bullets의 level(0~4)을 정확히 지정하세요.",
		maxHierarchyLevel(lines)+1, strings.Join(examples, ", "),
	)
```

- [ ] **Step 13: Run test to verify it passes**

Run: `go test ./apps/core-api/internal/skills/... -v`
Expected: All tests PASS, including the 3 pre-existing `TestBulletHierarchyExample*` tests and the new one.

- [ ] **Step 14: Run the full Go test suite**

Run: `cd apps/core-api && go build ./... && go test ./...`
Expected: builds clean; all tests pass (integration tests requiring `JASLIDE_TEST_DATABASE_URL`/`JASLIDE_TEST_REDIS_URL` skip if those env vars aren't set, per the existing convention — that's expected, not a failure).

- [ ] **Step 15: Commit**

```bash
git add apps/core-api/internal/generation/hierarchy.go apps/core-api/internal/generation/hierarchy_test.go apps/core-api/internal/generation/service.go apps/core-api/internal/generation/llm.go apps/core-api/internal/generation/llm_test.go apps/core-api/internal/skills/hierarchy_guidance.go apps/core-api/internal/skills/hierarchy_guidance_test.go
git commit -m "feat(generation): ground bullet-level prompt guidance in the template's real levels"
```

---

### Task 3: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run both full test suites**

Run: `cd apps/renderer && python -m pytest -v`
Run: `cd apps/core-api && go build ./... && go test ./...`
Expected: both green.

- [ ] **Step 2: Real-deck verification**

Using the 박태지_0723_업무보고_AI엔지니어링.pptx template already imported as a Skill in the local stack (or re-import it), generate a new presentation from it and open the resulting PPTX/PDF. Confirm:
1. Bullet lines that the model assigned a non-zero `level` show the template's actual indentation and bullet glyph at that level (not flush-left, not the level-0 style).
2. A line whose assigned level has no matching prototype in that specific text box/cell falls back visually to the nearest level's style rather than looking broken or unstyled.
3. No line in the output starts with a literal `-` or `•` character duplicating the template's own bullet.
4. The editor's live scene preview and the exported PPTX are not expected to match exactly in this specific area (the scene/export divergence for indentation is explicitly out of scope per the spec) — do not treat a difference here as a regression.

---

## Self-Review Notes

- **Spec coverage:** Renderer prototype-cloning + fallback + literal-bullet stripping (Task 1) ✓. Available-levels prompt grounding (Task 2, Steps 1-9) ✓. "Previous content is reference only" framing — re-scoped during planning from a generic `slidePrompt` addition (no such field exists there) to rewording `formatHierarchyExample`'s literal example text, which is the actual place the codebase shows the model prior real content (Task 2, Steps 10-13) — this is a deliberate, verified correction to the spec's original sketch, not a gap. Literal bullet-character prompt instruction (Task 2, Step 8) ✓.
- **Placeholder scan:** none found.
- **Type consistency:** `SlideRequest.AvailableLevels []int` (Task 2, Step 5) is exactly the type `availableLevels` (Step 3) returns and `slidePrompt` (Step 8) consumes — no drift. `_write_paragraphs(self, frame, paragraphs: list)` signature is unchanged from today's, so every existing call site (`_apply_native_edit`'s two remaining call sites, the table-cell dict branch) keeps working without modification beyond what Task 1 Step 4 specifies.
- **Deviation flagged for the human:** Task 2's Step 5 reorders `Process()`'s loop body (moving `chooseTemplateIndex` before the `SlideContent` call) — this was necessary once verified against the actual code (the destination slide's template index, and therefore its real available levels, wasn't known yet at the point `SlideContent` was called) and is a control-flow change beyond what the spec's original code sketch showed. It does not change `chooseTemplateIndex`'s inputs or `pptxObjectEdits`'s behavior, only *when* `templateIndex` is computed.
