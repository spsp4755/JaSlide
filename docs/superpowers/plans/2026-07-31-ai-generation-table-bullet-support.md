# AI Generation Table and Multi-Level Bullet Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the AI generation pipeline produce real `TABLE` slides and multi-level (0-4) bullet indentation, instead of silently dropping table structure and flattening every bullet to level 0/1.

**Architecture:** Extend the existing Go generation schema (`apps/core-api/internal/generation`) with a `TABLE` slide type that mirrors the already-shipped `CHART` type end to end (outline type guidance → content JSON schema → validation with an example fallback), remove an artificial bullet-indent clamp in the same validator, then add a matching `_add_table` renderer function in `apps/renderer/src/generators/pptx_generator.py` that reuses the existing `_add_table_row` helper the same way `_add_chart` reuses `add_chart`.

**Tech Stack:** Go 1.24 (core-api), Python 3.11 / python-pptx (renderer), Docker for running both test suites without a local toolchain.

## Global Constraints

- Do not change the `html-template-contract.md` slot contract (`title`/`subtitle`/`body`/`bullets`). `TABLE` reuses the same dynamic content-slot placement `CHART` already uses; it does not add a new slot type.
- Do not change the PPTX/HTML ZIP import → scene edit → re-export path. That path already preserves tables and multi-level bullets and is out of scope.
- Existing `CONTENT`/`BULLET_LIST`/`CHART` generation output must remain byte-for-byte schema-compatible — every new behavior is additive (a new optional `table` field, a widened but still-defaulting `level` range).
- Table bounds: 1-8 headers, 1-12 rows, every row's cell count must equal the header count (mirrors the existing chart bounds of 2-6 labels/values in `validChart`).
- Bullet indent bounds: integer `level` 0-4 (PPTX indentation beyond ~4 levels has no practical meaning); anything outside that range or non-integer falls back to 0.
- All commands below assume the current working directory is the repository root (`JaSlide/`).

---

### Task 1: Add the `TABLE` slide type and teach the outline step to choose it

**Files:**
- Modify: `apps/core-api/internal/generation/service.go:848-852` (`slideTypes` map)
- Modify: `apps/core-api/internal/generation/llm.go:408-425` (`outlinePrompt`)
- Modify: `apps/core-api/internal/generation/llm_test.go` (add tests, add `strings` import)

**Interfaces:**
- Consumes: nothing new.
- Produces: `slideTypes["TABLE"] = true` (read by `parseOutline` in `llm.go:304`, already-existing code — no signature change). `outlinePrompt(OutlineRequest) string` keeps its exact signature but its returned string now also explains when to pick each slide type.

- [ ] **Step 1: Write the failing tests**

Add to the end of `apps/core-api/internal/generation/llm_test.go` (and add `"strings"` to the import block at the top, alongside the existing `"context"`, `"encoding/json"`, etc.):

```go
func TestParseOutlinePreservesTableSlideType(t *testing.T) {
	raw := json.RawMessage(`{"title":"Deck","slides":[{"order":1,"title":"실적","type":"TABLE","keyPoints":["7/20-7/24 실적"]}]}`)
	outline, err := parseOutline(raw, 1, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(outline.Slides) != 1 || outline.Slides[0].Type != "TABLE" {
		t.Fatalf("expected a TABLE slide, got %+v", outline.Slides)
	}
}

func TestOutlinePromptExplainsWhenToUseEachSlideType(t *testing.T) {
	prompt := outlinePrompt(OutlineRequest{Content: "source", Language: "ko", SlideCount: 3})
	for _, want := range []string{"TABLE", "CHART", "BULLET_LIST"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("expected outline prompt to mention %s, got: %s", want, prompt)
		}
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm go test ./internal/generation/... -run 'TestParseOutlinePreservesTableSlideType|TestOutlinePromptExplainsWhenToUseEachSlideType' -v`

Expected: `TestParseOutlinePreservesTableSlideType` FAILs (`slide.Type` comes back `"CONTENT"` because `slideTypes["TABLE"]` doesn't exist yet, so `parseOutline` overwrites it). `TestOutlinePromptExplainsWhenToUseEachSlideType` FAILs (prompt doesn't mention `TABLE`/`CHART`/`BULLET_LIST` yet).

- [ ] **Step 3: Add `TABLE` to `slideTypes`**

In `apps/core-api/internal/generation/service.go`, change:

```go
var slideTypes = map[string]bool{
	"TITLE": true, "CONTENT": true, "BULLET_LIST": true, "TWO_COLUMN": true,
	"IMAGE": true, "CHART": true, "QUOTE": true, "COMPARISON": true,
	"SECTION_HEADER": true, "BLANK": true,
}
```

to:

```go
var slideTypes = map[string]bool{
	"TITLE": true, "CONTENT": true, "BULLET_LIST": true, "TWO_COLUMN": true,
	"IMAGE": true, "CHART": true, "TABLE": true, "QUOTE": true, "COMPARISON": true,
	"SECTION_HEADER": true, "BLANK": true,
}
```

- [ ] **Step 4: Add slide-type guidance to `outlinePrompt`**

In `apps/core-api/internal/generation/llm.go`, change:

```go
func outlinePrompt(input OutlineRequest) string {
	catalog := ""
	if len(input.TemplateSlides) > 0 {
		var rows []string
		for index, slide := range input.TemplateSlides {
			rows = append(rows, fmt.Sprintf("%d: %s", index, slide))
		}
		catalog = "\nTemplate slides (choose the best templateIndex):\n" + strings.Join(rows, "\n")
	}
	continuation := ""
	if len(input.PriorTitles) > 0 {
		continuation = "\nContinue after these titles without repetition: " + strings.Join(input.PriorTitles, "; ")
	}
	return fmt.Sprintf(
		"Create exactly %d presentation slides in %s from this source:\n%s%s%s\nReturn JSON only: {\"title\":\"Deck\",\"slides\":[{\"order\":1,\"title\":\"Title\",\"type\":\"CONTENT\",\"keyPoints\":[\"specific point\"],\"templateIndex\":0}]}",
		input.SlideCount, input.Language, truncate(input.Content, 10000), catalog, continuation,
	)
}
```

to:

```go
func outlinePrompt(input OutlineRequest) string {
	catalog := ""
	if len(input.TemplateSlides) > 0 {
		var rows []string
		for index, slide := range input.TemplateSlides {
			rows = append(rows, fmt.Sprintf("%d: %s", index, slide))
		}
		catalog = "\nTemplate slides (choose the best templateIndex):\n" + strings.Join(rows, "\n")
	}
	continuation := ""
	if len(input.PriorTitles) > 0 {
		continuation = "\nContinue after these titles without repetition: " + strings.Join(input.PriorTitles, "; ")
	}
	guidance := "\nChoose each slide's type by its content: TABLE for row/column data such as comparisons, schedules, or structured records; CHART for numeric trends or comparisons; BULLET_LIST for simple lists; TITLE for section covers; CONTENT for narrative slides."
	return fmt.Sprintf(
		"Create exactly %d presentation slides in %s from this source:\n%s%s%s%s\nReturn JSON only: {\"title\":\"Deck\",\"slides\":[{\"order\":1,\"title\":\"Title\",\"type\":\"CONTENT\",\"keyPoints\":[\"specific point\"],\"templateIndex\":0}]}",
		input.SlideCount, input.Language, truncate(input.Content, 10000), catalog, continuation, guidance,
	)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm go test ./internal/generation/... -v`

Expected: PASS (all tests in the package, including the two new ones and the pre-existing ones from earlier work).

- [ ] **Step 6: Commit**

```bash
git add apps/core-api/internal/generation/service.go apps/core-api/internal/generation/llm.go apps/core-api/internal/generation/llm_test.go
git commit -m "feat(go-api): add TABLE slide type and outline type guidance"
```

---

### Task 2: Add the `TABLE` content schema (`validTable`, `parseSlideContent`, `slidePrompt`)

**Files:**
- Modify: `apps/core-api/internal/generation/llm.go` (`parseSlideContent`, new `validTable`, `slidePrompt`)
- Modify: `apps/core-api/internal/generation/llm_test.go` (add tests)

**Interfaces:**
- Consumes: `slideTypes["TABLE"]` from Task 1.
- Produces: `validTable(raw any) map[string]any` (new function, same shape as the existing `validChart`). `parseSlideContent` output gains an optional `table` field: `{"headers": []string, "rows": [][]string, "isExample"?: bool}`. This exact JSON shape is what Task 4 (renderer) reads from `content["table"]`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/core-api/internal/generation/llm_test.go`:

```go
func TestValidTableAcceptsWellFormedHeadersAndRows(t *testing.T) {
	raw, err := parseSlideContent(json.RawMessage(
		`{"heading":"실적","table":{"headers":["기간","실적"],"rows":[["7/20-7/24","완료"]]}}`,
	), "TABLE")
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	table, ok := value["table"].(map[string]any)
	if !ok {
		t.Fatalf("expected a table field, got %v", value["table"])
	}
	if table["isExample"] != nil {
		t.Fatal("expected a well-formed table to not be marked as an example")
	}
}

func TestParseSlideContentFillsExampleTableWhenModelOmitsIt(t *testing.T) {
	raw, err := parseSlideContent(json.RawMessage(`{"heading":"실적"}`), "TABLE")
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	table, ok := value["table"].(map[string]any)
	if !ok || table["isExample"] != true {
		t.Fatalf("expected an example table fallback, got %v", value["table"])
	}
}

func TestValidTableRejectsRowsWithWrongColumnCount(t *testing.T) {
	raw, err := parseSlideContent(json.RawMessage(
		`{"heading":"실적","table":{"headers":["기간","실적"],"rows":[["7/20-7/24"]]}}`,
	), "TABLE")
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	table, ok := value["table"].(map[string]any)
	if !ok || table["isExample"] != true {
		t.Fatalf("expected mismatched row/column counts to fall back to the example table, got %v", value["table"])
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm go test ./internal/generation/... -run TestValidTable -v` and `-run TestParseSlideContentFillsExampleTableWhenModelOmitsIt -v`

Expected: FAIL — `value["table"]` is always absent because nothing reads `value["table"]` from the parsed content yet.

- [ ] **Step 3: Add `validTable` next to `validChart`**

In `apps/core-api/internal/generation/llm.go`, immediately after the closing brace of `validChart` (after `return chart` / `}`), add:

```go
func validTable(raw any) map[string]any {
	table, ok := raw.(map[string]any)
	if !ok {
		return nil
	}
	rawHeaders, headersOK := table["headers"].([]any)
	rawRows, rowsOK := table["rows"].([]any)
	if !headersOK || !rowsOK || len(rawHeaders) < 1 || len(rawHeaders) > 8 || len(rawRows) < 1 || len(rawRows) > 12 {
		return nil
	}
	headers := make([]string, len(rawHeaders))
	for index, value := range rawHeaders {
		text, ok := value.(string)
		if !ok || strings.TrimSpace(text) == "" {
			return nil
		}
		headers[index] = text
	}
	rows := make([][]string, len(rawRows))
	for rowIndex, rawRow := range rawRows {
		cells, ok := rawRow.([]any)
		if !ok || len(cells) != len(headers) {
			return nil
		}
		row := make([]string, len(cells))
		for cellIndex, value := range cells {
			text, ok := value.(string)
			if !ok {
				return nil
			}
			row[cellIndex] = text
		}
		rows[rowIndex] = row
	}
	return map[string]any{"headers": headers, "rows": rows}
}
```

- [ ] **Step 4: Wire `table` into `parseSlideContent`**

In `apps/core-api/internal/generation/llm.go`, change:

```go
	if chart := validChart(value["chart"]); chart != nil {
		result["chart"] = chart
	} else if slideType == "CHART" {
		result["chart"] = map[string]any{
			"labels": []string{"Current", "Target"}, "values": []float64{60, 35},
			"series": "Example", "isExample": true,
		}
	}
	return json.Marshal(result)
}
```

to:

```go
	if chart := validChart(value["chart"]); chart != nil {
		result["chart"] = chart
	} else if slideType == "CHART" {
		result["chart"] = map[string]any{
			"labels": []string{"Current", "Target"}, "values": []float64{60, 35},
			"series": "Example", "isExample": true,
		}
	}
	if table := validTable(value["table"]); table != nil {
		result["table"] = table
	} else if slideType == "TABLE" {
		result["table"] = map[string]any{
			"headers": []string{"항목", "값"}, "rows": [][]string{{"예시", "-"}}, "isExample": true,
		}
	}
	return json.Marshal(result)
}
```

- [ ] **Step 5: Tell the model about the table schema in `slidePrompt`**

In `apps/core-api/internal/generation/llm.go`, change:

```go
func slidePrompt(input SlideRequest) string {
	return fmt.Sprintf(
		"Create concise slide content in %s. Title: %s. Type: %s. Key points: %s. Return JSON only with heading, optional subheading/body, 3-5 bullets and chart for CHART.",
		input.Language, input.Title, input.Type, strings.Join(input.KeyPoints, "; "),
	)
}
```

to:

```go
func slidePrompt(input SlideRequest) string {
	return fmt.Sprintf(
		"Create concise slide content in %s. Title: %s. Type: %s. Key points: %s. "+
			"Return JSON only with heading, optional subheading/body, 3-5 bullets "+
			"(each an object with text and level 0-2 for indentation), "+
			"chart for CHART as {\"labels\":[\"...\"],\"values\":[0]}, "+
			"and table for TABLE as {\"headers\":[\"...\"],\"rows\":[[\"...\"]]}.",
		input.Language, input.Title, input.Type, strings.Join(input.KeyPoints, "; "),
	)
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm go test ./internal/generation/... -v`

Expected: PASS (all tests, including the three new ones).

- [ ] **Step 7: Commit**

```bash
git add apps/core-api/internal/generation/llm.go apps/core-api/internal/generation/llm_test.go
git commit -m "feat(go-api): add TABLE content schema with example fallback"
```

---

### Task 3: Remove the artificial bullet-indent clamp

**Files:**
- Modify: `apps/core-api/internal/generation/llm.go` (`parseSlideContent` bullets loop)
- Modify: `apps/core-api/internal/generation/llm_test.go` (add tests)

**Interfaces:**
- Consumes: nothing new.
- Produces: `parseSlideContent`'s `bullets[].level` now ranges 0-4 instead of always 0/1. This is what Task 4's renderer already passes straight through as `paragraph.level`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/core-api/internal/generation/llm_test.go`:

```go
func TestParseSlideContentPreservesBulletIndentLevelsUpToFour(t *testing.T) {
	raw, err := parseSlideContent(json.RawMessage(
		`{"heading":"실적","bullets":[{"text":"상위","level":0},{"text":"하위","level":3}]}`,
	), "CONTENT")
	if err != nil {
		t.Fatal(err)
	}
	var value struct {
		Bullets []struct {
			Text  string `json:"text"`
			Level int    `json:"level"`
		} `json:"bullets"`
	}
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	if len(value.Bullets) != 2 || value.Bullets[1].Level != 3 {
		t.Fatalf("expected second bullet at level 3, got %+v", value.Bullets)
	}
}

func TestParseSlideContentClampsOutOfRangeBulletLevelToZero(t *testing.T) {
	raw, err := parseSlideContent(json.RawMessage(
		`{"heading":"실적","bullets":[{"text":"과도한 들여쓰기","level":9}]}`,
	), "CONTENT")
	if err != nil {
		t.Fatal(err)
	}
	var value struct {
		Bullets []struct {
			Level int `json:"level"`
		} `json:"bullets"`
	}
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	if len(value.Bullets) != 1 || value.Bullets[0].Level != 0 {
		t.Fatalf("expected out-of-range level to clamp to 0, got %+v", value.Bullets)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm go test ./internal/generation/... -run 'TestParseSlideContentPreservesBulletIndentLevelsUpToFour' -v`

Expected: FAIL — `value.Bullets[1].Level` comes back `0`, not `3`, because the current code only ever assigns 0 or 1.

- [ ] **Step 3: Widen the level range**

In `apps/core-api/internal/generation/llm.go`, inside the bullets loop, change:

```go
			case map[string]any:
				if text, ok := bullet["text"].(string); ok && strings.TrimSpace(text) != "" {
					level := 0
					if bullet["level"] == float64(1) {
						level = 1
					}
					bullets = append(bullets, map[string]any{"text": text, "level": level})
				}
```

to:

```go
			case map[string]any:
				if text, ok := bullet["text"].(string); ok && strings.TrimSpace(text) != "" {
					level := 0
					if raw, ok := bullet["level"].(float64); ok && raw == float64(int(raw)) && raw >= 0 && raw <= 4 {
						level = int(raw)
					}
					bullets = append(bullets, map[string]any{"text": text, "level": level})
				}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm go test ./internal/generation/... -v`

Expected: PASS (all tests in the package).

- [ ] **Step 5: Commit**

```bash
git add apps/core-api/internal/generation/llm.go apps/core-api/internal/generation/llm_test.go
git commit -m "fix(go-api): allow bullet indentation levels 0-4 instead of 0-1"
```

---

### Task 4: Render `TABLE` slides in the Python PPTX generator

**Files:**
- Modify: `apps/renderer/src/generators/pptx_generator.py:687-688` (slide-type dispatch inside `_add_html_template_slide`)
- Modify: `apps/renderer/src/generators/pptx_generator.py` (new `_add_table` method, placed directly after `_add_chart`)
- Modify: `apps/renderer/tests/test_pptx_generator.py` (add test)

**Interfaces:**
- Consumes: `content["table"]` shaped `{"headers": [str, ...], "rows": [[str, ...], ...], "isExample"?: bool}`, produced by Task 2's Go code. `slots` (a `list[dict]` of content-slot rectangles), same shape `_add_chart` already consumes.
- Produces: `_add_table(self, slide: Any, content: dict, slots: list[dict] | None = None) -> bool`, same signature shape as the existing `_add_chart`.

- [ ] **Step 1: Write the failing test**

Add to `apps/renderer/tests/test_pptx_generator.py`, directly after `test_html_template_renders_chart_data_for_chart_slides`:

```python
def test_html_template_renders_table_data_for_table_slides():
    output = PPTXGenerator(SimpleNamespace(config=SimpleNamespace(htmlSlides=[
        '<div data-object="true" data-object-type="shape" style="position:absolute;left:0;top:0;width:1920px;height:1080px;background:#FFFFFF"></div>'
    ]))).generate(_presentation(_slide(
        "TABLE", "실적", {"heading": "실적", "table": {"headers": ["기간", "실적"], "rows": [["7/20-7/24", "완료"]]}},
    )))

    slide = Presentation(BytesIO(output)).slides[0]
    texts = [run.text for run in _runs(slide)]
    assert "기간" in texts and "실적" in texts and "완료" in texts
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker run --rm -v "$(pwd)/apps/renderer:/app/apps/renderer" -w /app/apps/renderer jaslide/renderer:v0.6.1 sh -c "pip install --disable-pip-version-check --no-cache-dir pytest==8.4.2 httpx==0.28.1 >/dev/null && python -m pytest tests/test_pptx_generator.py -k test_html_template_renders_table_data_for_table_slides -v"`

Expected: FAIL — the slide has no table shapes because `_add_table` doesn't exist and the `TABLE` type isn't dispatched, so no text runs contain "기간"/"실적"/"완료".

- [ ] **Step 3: Wire the `TABLE` dispatch**

In `apps/renderer/src/generators/pptx_generator.py`, inside `_add_html_template_slide`, change:

```python
        if str(getattr(slide_data, "type", "")).upper() == "CHART" and self._add_chart(slide, content, content_slots):
            return
```

to:

```python
        if str(getattr(slide_data, "type", "")).upper() == "CHART" and self._add_chart(slide, content, content_slots):
            return

        if str(getattr(slide_data, "type", "")).upper() == "TABLE" and self._add_table(slide, content, content_slots):
            return
```

- [ ] **Step 4: Add `_add_table`, directly after `_add_chart`'s closing brace and before the `_is_dark` static method**

```python
    def _add_table(self, slide: Any, content: dict, slots: list[dict] | None = None) -> bool:
        table = content.get("table") if isinstance(content.get("table"), dict) else {}
        headers, rows = table.get("headers"), table.get("rows")
        if not (isinstance(headers, list) and 1 <= len(headers) <= 8 and all(isinstance(header, str) and header.strip() for header in headers)):
            return False
        if not (isinstance(rows, list) and 1 <= len(rows) <= 12):
            return False
        for row in rows:
            if not (isinstance(row, list) and len(row) == len(headers) and all(isinstance(cell, str) for cell in row)):
                return False
        light_slots = [slot for slot in slots or [] if not self._is_dark(slot.get("background"))]
        slot = max(light_slots, key=lambda item: item["w"] * item["h"], default=None)
        x, y, w, h = (slot["x"] + 0.25, slot["y"] + 0.35, max(slot["w"] - 0.5, 2), max(slot["h"] - 0.7, 1.5)) if slot else (1.0, 2.0, 11.3, 4.6)
        row_height = max(h / (len(rows) + 1), 0.3)
        widths = [w / len(headers)] * len(headers)
        self._add_table_row(slide, headers, x, y, widths, row_height, header=True)
        for index, row in enumerate(rows):
            self._add_table_row(slide, row, x, y + row_height * (index + 1), widths, row_height, shaded=index % 2 == 1)
        return True
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `docker run --rm -v "$(pwd)/apps/renderer:/app/apps/renderer" -w /app/apps/renderer jaslide/renderer:v0.6.1 sh -c "pip install --disable-pip-version-check --no-cache-dir pytest==8.4.2 httpx==0.28.1 >/dev/null && python -m pytest tests/test_pptx_generator.py -v"`

Expected: PASS (the full `test_pptx_generator.py` suite, including the new test — running the whole file, not just the new test, confirms nothing else regressed).

- [ ] **Step 6: Commit**

```bash
git add apps/renderer/src/generators/pptx_generator.py apps/renderer/tests/test_pptx_generator.py
git commit -m "feat(renderer): render TABLE slides via _add_table"
```

---

### Task 5: Rebuild, redeploy, and verify end to end against the running local stack

**Files:** none (build/deploy/manual verification only).

**Interfaces:** none.

- [ ] **Step 1: Rebuild the `core-api` and `renderer` images**

Run: `docker compose --file docker-compose.yml --env-file .env build api renderer`

Expected: both builds finish with `Built` (or a cache-hit `up to date`) for `jaslide/core-api:v0.6.1` and `jaslide/renderer:v0.6.1`.

- [ ] **Step 2: Recreate the containers with the new images**

Run: `docker compose --file docker-compose.yml --env-file .env up -d api renderer`

Expected: `docker compose ps` shows `api` and `renderer` both `Up ... (healthy)`.

- [ ] **Step 3: Generate a deck whose source content is naturally tabular**

In the browser (already open at `http://localhost:3000`), start a new AI generation with a prompt whose content is row/column data, e.g. "이번 분기 부서별 실적을 표로 정리해줘: 개발팀 90%, 기획팀 85%, 영업팀 78%" (or reuse the previously-registered `박태지_0723` skill/template with the same kind of prompt). Approve the outline and let generation complete.

- [ ] **Step 4: Confirm the job completed and check the outline's chosen type**

Run: `docker exec jaslide-postgres-1 psql -U jaslide -d jaslide -c "SELECT id, status, input->'outline' FROM \"GenerationJob\" ORDER BY \"createdAt\" DESC LIMIT 1;" -x`

Expected: `status` is `COMPLETED`, and the stored outline's slide `type` is `TABLE` for the tabular slide (confirms Task 1's outline guidance actually steered the model, not just that the schema exists).

- [ ] **Step 5: Confirm the exported PPTX contains a real table**

In the editor for the generated presentation, use the export menu to export PPTX, then inspect it:

```bash
unzip -p <downloaded-file>.pptx ppt/slides/slide1.xml | grep -o '<a:t>[^<]*</a:t>' | head -20
```

Expected: the header and row cell text from the source data (e.g. "개발팀", "90%") appear as separate `<a:t>` text runs, not merged into one paragraph of prose.

- [ ] **Step 6: Confirm multi-level bullets survive on a non-table slide**

Generate (or re-use) a `CONTENT`/`BULLET_LIST` slide whose source content has an obvious nested structure (e.g. "IT 운영: 서버 점검, 장애 대응 / AI 연구: 모델 튜닝, 데이터 수집" — two top-level items each with two sub-items) and confirm in the exported PPTX (or the editor's "수동 편집" view) that the sub-items render indented one level deeper than their parent, rather than all bullets sitting at the same indent.

No commit for this task — it is verification only, using artifacts already committed in Tasks 1-4.
