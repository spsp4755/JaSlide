# Renderer Layout Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four new PPTX slide layouts (timeline/roadmap, process/step flow, comparison (VS), KPI cards) so generated decks stop collapsing this content into a flat bullet list, and wire the existing font auto-fit primitive into each new layout's text.

**Architecture:** Same two-layer split as the merged TABLE/CHART/COLUMNS work. Go (`apps/core-api/internal/generation`) adds one "valid-or-nil" schema validator per layout to `parseSlideContent`, plus prompt guidance so the model knows the shapes exist. Python (`apps/renderer/src/generators/pptx_generator.py`) adds one `_add_*_slide` draw function per layout and dispatches on **content shape**, not the declared type label — the principle that fixed the TWO_COLUMN mislabeling bug — using distinct top-level content keys (`timeline`, `process`, `comparison`, `metrics`) so none of the four new shapes can collide with `table`/`chart`/`columns` or each other.

**Tech Stack:** Go 1.24 (`core-api`), Python 3.11 + python-pptx (`renderer`), Docker for test execution (no local toolchain).

## Global Constraints

- Every new Go validator returns nil (no error) on schema mismatch — the caller falls through to the next check, never crashes. (Matches `validTable`/`validChart`/`validColumns`.)
- Every new Python draw function is only reached via a content-shape check performed *before* slide creation in `_add_slide`, exactly mirroring the existing `has_columns` check — never gated on the (unreliable) `slide_type` label alone.
- A slide whose content already carries a valid `table` or `chart` never dispatches into any of the four new layouts (same guard that fixed the table/chart-vs-columns collision bug).
- Reuse existing helpers — `_add_layout_textbox`, `_style_paragraph`, `_apply_alignment`, `_add_column_bullets`, `_shrink_text_to_fit`, `parseBullets` — rather than writing new ones. No new shared "auto-fit" helper: `_shrink_text_to_fit`/`fit_font_scale` already exist (`apps/renderer/src/generators/pptx_generator.py:40,137`) and are simply not yet called from any generation draw function; this plan wires them in.
- Go tests run via: `docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm go test ./internal/generation/... -v`
- Python tests run via: `docker run --rm -v "$(pwd)/apps/renderer:/app/apps/renderer" -w /app jaslide/renderer:v0.6.1 sh -c "pip install --disable-pip-version-check --no-cache-dir pytest==8.4.2 httpx==0.28.1 >/dev/null 2>&1 && python -m pytest apps/renderer/tests/test_pptx_generator.py -v"`

---

### Task 1: Go — timeline & process schemas

**Files:**
- Modify: `apps/core-api/internal/generation/service.go` (slideTypes map, ~line 848)
- Modify: `apps/core-api/internal/generation/llm.go` (parseSlideContent, outlinePrompt, slidePrompt)
- Test: `apps/core-api/internal/generation/llm_test.go`

**Interfaces:**
- Consumes: `parseBullets(raw any, limit int) []map[string]any` (`llm.go:384`, unchanged).
- Produces: `validTimeline(raw any) map[string]any`, `validProcess(raw any) map[string]any` — both "valid-or-nil" validators, consumed by `parseSlideContent` in this task and by no other task.

- [ ] **Step 1: Write the failing Go tests**

Append to `apps/core-api/internal/generation/llm_test.go`:

```go
func TestValidTimelineAcceptsThreeToEightWellFormedItems(t *testing.T) {
	raw, err := parseSlideContent(json.RawMessage(`{
		"heading":"로드맵",
		"timeline":{"items":[
			{"date":"2026 Q1","label":"기획","description":"요구사항 정의"},
			{"date":"2026 Q2","label":"개발","description":"핵심 기능 구현"},
			{"date":"2026 Q3","label":"출시","description":"정식 런칭"}
		]}
	}`), "TIMELINE")
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	timeline, ok := value["timeline"].(map[string]any)
	if !ok {
		t.Fatalf("expected a timeline field, got %v", value["timeline"])
	}
	items, ok := timeline["items"].([]any)
	if !ok || len(items) != 3 {
		t.Fatalf("expected 3 timeline items, got %v", timeline["items"])
	}
	first := items[0].(map[string]any)
	if first["label"] != "기획" {
		t.Fatalf("unexpected first label: %v", first["label"])
	}
}

func TestValidTimelineRejectsFewerThanThreeOrMoreThanEightItems(t *testing.T) {
	raw, err := parseSlideContent(json.RawMessage(`{
		"heading":"h",
		"timeline":{"items":[{"date":"d","label":"only one","description":"x"}]}
	}`), "TIMELINE")
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	if _, ok := value["timeline"]; ok {
		t.Fatalf("expected timeline with only 1 item to be rejected, got %v", value["timeline"])
	}
}

func TestValidTimelineRejectsItemsMissingALabel(t *testing.T) {
	raw, err := parseSlideContent(json.RawMessage(`{
		"heading":"h",
		"timeline":{"items":[
			{"date":"d1","label":"a"},
			{"date":"d2","label":"b"},
			{"date":"d3"}
		]}
	}`), "TIMELINE")
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	if _, ok := value["timeline"]; ok {
		t.Fatalf("expected timeline with a missing label to be rejected, got %v", value["timeline"])
	}
}

func TestValidProcessAcceptsTwoToSixWellFormedSteps(t *testing.T) {
	raw, err := parseSlideContent(json.RawMessage(`{
		"heading":"절차",
		"process":{"steps":[
			{"label":"접수","description":"요청 접수"},
			{"label":"검토","description":"내용 검토"},
			{"label":"승인","description":"최종 승인"}
		]}
	}`), "PROCESS")
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	process, ok := value["process"].(map[string]any)
	if !ok {
		t.Fatalf("expected a process field, got %v", value["process"])
	}
	steps, ok := process["steps"].([]any)
	if !ok || len(steps) != 3 {
		t.Fatalf("expected 3 process steps, got %v", process["steps"])
	}
}

func TestValidProcessRejectsFewerThanTwoOrMoreThanSixSteps(t *testing.T) {
	raw, err := parseSlideContent(json.RawMessage(`{
		"heading":"h",
		"process":{"steps":[
			{"label":"1"},{"label":"2"},{"label":"3"},
			{"label":"4"},{"label":"5"},{"label":"6"},{"label":"7"}
		]}
	}`), "PROCESS")
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	if _, ok := value["process"]; ok {
		t.Fatalf("expected process with 7 steps to be rejected, got %v", value["process"])
	}
}

func TestOutlinePromptAndSlidePromptMentionTimelineAndProcess(t *testing.T) {
	outline := outlinePrompt(OutlineRequest{Content: "source", Language: "ko", SlideCount: 1})
	if !strings.Contains(outline, "TIMELINE") || !strings.Contains(outline, "PROCESS") {
		t.Fatalf("expected outline prompt to mention TIMELINE and PROCESS, got: %s", outline)
	}
	slide := slidePrompt(SlideRequest{Title: "t", Type: "TIMELINE", Language: "ko"})
	if !strings.Contains(slide, "timeline") || !strings.Contains(slide, "process") {
		t.Fatalf("expected slide prompt to mention timeline and process shapes, got: %s", slide)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm go test ./internal/generation/... -run 'TestValidTimeline|TestValidProcess|TestOutlinePromptAndSlidePromptMentionTimelineAndProcess' -v`
Expected: FAIL — `validTimeline`/`validProcess` undefined, and/or prompts don't mention TIMELINE/PROCESS/timeline/process.

- [ ] **Step 3: Add `TIMELINE`/`PROCESS` to the slideTypes map**

In `apps/core-api/internal/generation/service.go`, change:

```go
var slideTypes = map[string]bool{
	"TITLE": true, "CONTENT": true, "BULLET_LIST": true, "TWO_COLUMN": true,
	"IMAGE": true, "CHART": true, "TABLE": true, "QUOTE": true, "COMPARISON": true,
	"SECTION_HEADER": true, "BLANK": true,
```

to:

```go
var slideTypes = map[string]bool{
	"TITLE": true, "CONTENT": true, "BULLET_LIST": true, "TWO_COLUMN": true,
	"IMAGE": true, "CHART": true, "TABLE": true, "QUOTE": true, "COMPARISON": true,
	"SECTION_HEADER": true, "BLANK": true, "TIMELINE": true, "PROCESS": true, "KPI": true,
```

(`KPI` is added here for Task 2, which lands right after this one; adding it now avoids a second edit to this line.)

- [ ] **Step 4: Add the two validators to `llm.go`**

Add after `validColumns` (`llm.go:518`):

```go
// validTimeline requires 3-8 items, each with a non-empty label. date and
// description are optional strings, kept as-is when present.
func validTimeline(raw any) map[string]any {
	timeline, ok := raw.(map[string]any)
	if !ok {
		return nil
	}
	rawItems, ok := timeline["items"].([]any)
	if !ok || len(rawItems) < 3 || len(rawItems) > 8 {
		return nil
	}
	items := make([]map[string]any, len(rawItems))
	for index, rawItem := range rawItems {
		item, ok := rawItem.(map[string]any)
		if !ok {
			return nil
		}
		label, ok := item["label"].(string)
		if !ok || strings.TrimSpace(label) == "" {
			return nil
		}
		entry := map[string]any{"label": label}
		if date, ok := item["date"].(string); ok && strings.TrimSpace(date) != "" {
			entry["date"] = date
		}
		if description, ok := item["description"].(string); ok && strings.TrimSpace(description) != "" {
			entry["description"] = description
		}
		items[index] = entry
	}
	return map[string]any{"items": items}
}

// validProcess requires 2-6 steps, each with a non-empty label.
func validProcess(raw any) map[string]any {
	process, ok := raw.(map[string]any)
	if !ok {
		return nil
	}
	rawSteps, ok := process["steps"].([]any)
	if !ok || len(rawSteps) < 2 || len(rawSteps) > 6 {
		return nil
	}
	steps := make([]map[string]any, len(rawSteps))
	for index, rawStep := range rawSteps {
		step, ok := rawStep.(map[string]any)
		if !ok {
			return nil
		}
		label, ok := step["label"].(string)
		if !ok || strings.TrimSpace(label) == "" {
			return nil
		}
		entry := map[string]any{"label": label}
		if description, ok := step["description"].(string); ok && strings.TrimSpace(description) != "" {
			entry["description"] = description
		}
		steps[index] = entry
	}
	return map[string]any{"steps": steps}
}
```

- [ ] **Step 5: Wire the validators into `parseSlideContent`**

In `llm.go`, change:

```go
	if columns := validColumns(value["columns"]); columns != nil {
		result["columns"] = columns
	}
	return json.Marshal(result)
}
```

to:

```go
	if columns := validColumns(value["columns"]); columns != nil {
		result["columns"] = columns
	}
	if timeline := validTimeline(value["timeline"]); timeline != nil {
		result["timeline"] = timeline
	}
	if process := validProcess(value["process"]); process != nil {
		result["process"] = process
	}
	return json.Marshal(result)
}
```

- [ ] **Step 6: Update `outlinePrompt` and `slidePrompt` guidance**

In `llm.go`, change the `guidance` line inside `outlinePrompt`:

```go
	guidance := "\nChoose each slide's type by its content: TABLE for row/column data such as comparisons, schedules, or structured records; CHART for numeric trends or comparisons; BULLET_LIST for simple lists; TITLE for section covers; CONTENT for narrative slides."
```

to:

```go
	guidance := "\nChoose each slide's type by its content: TABLE for row/column data such as comparisons, schedules, or structured records; CHART for numeric trends or comparisons; BULLET_LIST for simple lists; TITLE for section covers; CONTENT for narrative slides; TIMELINE for chronological roadmaps or schedules; PROCESS for sequential step-by-step flows; COMPARISON for two-sided comparisons; KPI for a dashboard of key metrics."
```

And change the `slidePrompt` format string:

```go
func slidePrompt(input SlideRequest) string {
	return fmt.Sprintf(
		"Create concise slide content in %s. Title: %s. Type: %s. Key points: %s. "+
			"Return JSON only with heading, optional subheading/body, 3-5 bullets "+
			"(each an object with text and level 0-2 for indentation), "+
			"chart for CHART as {\"labels\":[\"...\"],\"values\":[0]}, "+
			"table for TABLE as {\"headers\":[\"...\"],\"rows\":[[\"...\"]]}, "+
			"and columns for TWO_COLUMN as exactly two {\"header\":\"...\",\"bullets\":[{\"text\":\"...\",\"level\":0}]} objects.%s",
		input.Language, input.Title, input.Type, strings.Join(input.KeyPoints, "; "), dateGuidance(),
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
			"table for TABLE as {\"headers\":[\"...\"],\"rows\":[[\"...\"]]}, "+
			"columns for TWO_COLUMN as exactly two {\"header\":\"...\",\"bullets\":[{\"text\":\"...\",\"level\":0}]} objects, "+
			"timeline for TIMELINE as {\"items\":[{\"date\":\"...\",\"label\":\"...\",\"description\":\"...\"}]} with 3-8 items, "+
			"process for PROCESS as {\"steps\":[{\"label\":\"...\",\"description\":\"...\"}]} with 2-6 steps, "+
			"comparison for COMPARISON as {\"left\":{\"title\":\"...\",\"bullets\":[\"...\"]},\"right\":{\"title\":\"...\",\"bullets\":[\"...\"]}}, "+
			"and metrics for KPI as {\"metrics\":[{\"value\":\"...\",\"label\":\"...\"}]} with 2-6 cards.%s",
		input.Language, input.Title, input.Type, strings.Join(input.KeyPoints, "; "), dateGuidance(),
	)
}
```

(This mentions `comparison`/`metrics`/KPI ahead of Task 2's validators existing — harmless, since `parseSlideContent` simply won't have a matching field to validate until Task 2 lands. Both tasks touch this one function body, so it is written once here.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm go test ./internal/generation/... -v`
Expected: PASS (all tests, including the new ones)

- [ ] **Step 8: Commit**

```bash
git add apps/core-api/internal/generation/service.go apps/core-api/internal/generation/llm.go apps/core-api/internal/generation/llm_test.go
git commit -m "feat(go-api): add TIMELINE and PROCESS content schemas"
```

---

### Task 2: Go — comparison & KPI schemas

**Files:**
- Modify: `apps/core-api/internal/generation/llm.go`
- Test: `apps/core-api/internal/generation/llm_test.go`

**Interfaces:**
- Consumes: `parseBullets(raw any, limit int) []map[string]any` (`llm.go:384`, unchanged); `slideTypes["KPI"]` (added in Task 1, Step 3).
- Produces: `validComparison(raw any) map[string]any`, `validKPI(raw any) map[string]any` — consumed by `parseSlideContent` in this task only.

- [ ] **Step 1: Write the failing Go tests**

Append to `apps/core-api/internal/generation/llm_test.go`:

```go
func TestValidComparisonAcceptsTwoWellFormedSides(t *testing.T) {
	raw, err := parseSlideContent(json.RawMessage(`{
		"heading":"플랜 비교",
		"comparison":{
			"left":{"title":"기본형","bullets":["가격 저렴","기능 제한"]},
			"right":{"title":"프리미엄","bullets":["가격 높음","전체 기능"]}
		}
	}`), "COMPARISON")
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	comparison, ok := value["comparison"].(map[string]any)
	if !ok {
		t.Fatalf("expected a comparison field, got %v", value["comparison"])
	}
	left, ok := comparison["left"].(map[string]any)
	if !ok || left["title"] != "기본형" {
		t.Fatalf("unexpected left side: %v", comparison["left"])
	}
	bullets, ok := left["bullets"].([]any)
	if !ok || len(bullets) != 2 {
		t.Fatalf("expected 2 left bullets, got %v", left["bullets"])
	}
}

func TestValidComparisonRejectsASideMissingATitle(t *testing.T) {
	raw, err := parseSlideContent(json.RawMessage(`{
		"heading":"h",
		"comparison":{
			"left":{"bullets":["x"]},
			"right":{"title":"프리미엄","bullets":["y"]}
		}
	}`), "COMPARISON")
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	if _, ok := value["comparison"]; ok {
		t.Fatalf("expected comparison missing a title to be rejected, got %v", value["comparison"])
	}
}

func TestValidComparisonRejectsASideWithNoBullets(t *testing.T) {
	raw, err := parseSlideContent(json.RawMessage(`{
		"heading":"h",
		"comparison":{
			"left":{"title":"기본형","bullets":[]},
			"right":{"title":"프리미엄","bullets":["y"]}
		}
	}`), "COMPARISON")
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	if _, ok := value["comparison"]; ok {
		t.Fatalf("expected comparison with an empty side to be rejected, got %v", value["comparison"])
	}
}

func TestValidKPIAcceptsTwoToSixWellFormedMetrics(t *testing.T) {
	raw, err := parseSlideContent(json.RawMessage(`{
		"heading":"핵심 지표",
		"metrics":{"metrics":[
			{"value":"120%","label":"목표 달성률"},
			{"value":"3.2억","label":"매출"},
			{"value":"15","label":"신규 계약"}
		]}
	}`), "KPI")
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	metrics, ok := value["metrics"].(map[string]any)
	if !ok {
		t.Fatalf("expected a metrics field, got %v", value["metrics"])
	}
	list, ok := metrics["metrics"].([]any)
	if !ok || len(list) != 3 {
		t.Fatalf("expected 3 metric cards, got %v", metrics["metrics"])
	}
}

func TestValidKPIRejectsFewerThanTwoOrMoreThanSixMetrics(t *testing.T) {
	raw, err := parseSlideContent(json.RawMessage(`{
		"heading":"h",
		"metrics":{"metrics":[{"value":"1","label":"only one"}]}
	}`), "KPI")
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	if _, ok := value["metrics"]; ok {
		t.Fatalf("expected metrics with only 1 card to be rejected, got %v", value["metrics"])
	}
}

func TestValidKPIRejectsAMetricMissingAValue(t *testing.T) {
	raw, err := parseSlideContent(json.RawMessage(`{
		"heading":"h",
		"metrics":{"metrics":[
			{"value":"1","label":"a"},
			{"label":"missing value"}
		]}
	}`), "KPI")
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	if _, ok := value["metrics"]; ok {
		t.Fatalf("expected metrics with a missing value to be rejected, got %v", value["metrics"])
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm go test ./internal/generation/... -run 'TestValidComparison|TestValidKPI' -v`
Expected: FAIL — `validComparison`/`validKPI` undefined.

- [ ] **Step 3: Add the two validators to `llm.go`**

Add after `validProcess` (added in Task 1):

```go
// validComparison requires both "left" and "right" sides, each with a
// non-empty title and at least one bullet (reusing parseBullets so a side's
// bullets follow the exact same string-or-object rules as everywhere else).
func validComparison(raw any) map[string]any {
	comparison, ok := raw.(map[string]any)
	if !ok {
		return nil
	}
	sides := make(map[string]map[string]any, 2)
	for _, key := range []string{"left", "right"} {
		rawSide, ok := comparison[key].(map[string]any)
		if !ok {
			return nil
		}
		title, ok := rawSide["title"].(string)
		if !ok || strings.TrimSpace(title) == "" {
			return nil
		}
		bullets := parseBullets(rawSide["bullets"], 6)
		if len(bullets) == 0 {
			return nil
		}
		sides[key] = map[string]any{"title": title, "bullets": bullets}
	}
	return map[string]any{"left": sides["left"], "right": sides["right"]}
}

// validKPI requires 2-6 metric cards, each with a non-empty value and label.
func validKPI(raw any) map[string]any {
	kpi, ok := raw.(map[string]any)
	if !ok {
		return nil
	}
	rawMetrics, ok := kpi["metrics"].([]any)
	if !ok || len(rawMetrics) < 2 || len(rawMetrics) > 6 {
		return nil
	}
	metrics := make([]map[string]any, len(rawMetrics))
	for index, rawMetric := range rawMetrics {
		metric, ok := rawMetric.(map[string]any)
		if !ok {
			return nil
		}
		value, ok := metric["value"].(string)
		if !ok || strings.TrimSpace(value) == "" {
			return nil
		}
		label, ok := metric["label"].(string)
		if !ok || strings.TrimSpace(label) == "" {
			return nil
		}
		metrics[index] = map[string]any{"value": value, "label": label}
	}
	return map[string]any{"metrics": metrics}
}
```

- [ ] **Step 4: Wire the validators into `parseSlideContent`**

In `llm.go`, change:

```go
	if process := validProcess(value["process"]); process != nil {
		result["process"] = process
	}
	return json.Marshal(result)
}
```

to:

```go
	if process := validProcess(value["process"]); process != nil {
		result["process"] = process
	}
	if comparison := validComparison(value["comparison"]); comparison != nil {
		result["comparison"] = comparison
	}
	if kpi := validKPI(value["metrics"]); kpi != nil {
		result["metrics"] = kpi
	}
	return json.Marshal(result)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm go test ./internal/generation/... -v`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add apps/core-api/internal/generation/llm.go apps/core-api/internal/generation/llm_test.go
git commit -m "feat(go-api): add COMPARISON and KPI content schemas"
```

---

### Task 3: Python — timeline slide

**Files:**
- Modify: `apps/renderer/src/generators/pptx_generator.py`
- Test: `apps/renderer/tests/test_pptx_generator.py`

**Interfaces:**
- Consumes: `content["timeline"] = {"items": [{"label": str, "date"?: str, "description"?: str}]}` (3-8 items) from Task 1; `self._add_layout_textbox`, `self._style_paragraph`, `self._shrink_text_to_fit`, `self.tokens`, `self._layout` (all existing, unchanged).
- Produces: `self._add_timeline_slide(slide_data) -> None`, plus a `has_timeline` local in `_add_slide`'s dispatch. No other task depends on these names.

- [ ] **Step 1: Write the failing test**

Add to `apps/renderer/tests/test_pptx_generator.py`:

```python
def test_timeline_slide_renders_markers_dates_and_labels_in_order():
    output = PPTXGenerator().generate(_presentation(_slide(
        "TIMELINE", "로드맵",
        {"heading": "로드맵", "timeline": {"items": [
            {"date": "2026 Q1", "label": "기획", "description": "요구사항 정의"},
            {"date": "2026 Q2", "label": "개발", "description": "핵심 기능 구현"},
            {"date": "2026 Q3", "label": "출시", "description": "정식 런칭"},
        ]}},
    )))

    slide = Presentation(BytesIO(output)).slides[0]
    texts = [run.text for run in _runs(slide)]
    assert texts.index("기획") < texts.index("개발") < texts.index("출시")
    assert "2026 Q1" in texts and "요구사항 정의" in texts
    markers = [shape for shape in slide.shapes if getattr(shape, "auto_shape_type", None) == MSO_SHAPE.OVAL]
    assert len(markers) == 3


def test_timeline_slide_is_reachable_with_no_type_label_via_content_shape():
    # Mirrors the TWO_COLUMN mislabeling fix: trust the content shape even if
    # the outline mislabeled this CONTENT.
    output = PPTXGenerator().generate(_presentation(_slide(
        "CONTENT", "로드맵",
        {"heading": "로드맵", "timeline": {"items": [
            {"label": "기획"}, {"label": "개발"}, {"label": "출시"},
        ]}},
    )))

    slide = Presentation(BytesIO(output)).slides[0]
    texts = [run.text for run in _runs(slide)]
    assert "기획" in texts and "개발" in texts and "출시" in texts


def test_timeline_slide_keeps_its_table_even_if_it_also_carries_a_timeline():
    # Regression guard for the exact collision class fixed for columns: a
    # table/chart shape must always win over the new layout keys too.
    output = PPTXGenerator().generate(_presentation(_slide(
        "TABLE", "실적",
        {
            "heading": "실적",
            "table": {"headers": ["부서", "실적"], "rows": [["개발팀", "90%"]]},
            "timeline": {"items": [{"label": "a"}, {"label": "b"}, {"label": "c"}]},
        },
    )))

    slide = Presentation(BytesIO(output)).slides[0]
    texts = [run.text for run in _runs(slide)]
    assert "개발팀" in texts and "90%" in texts
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker run --rm -v "$(pwd)/apps/renderer:/app/apps/renderer" -w /app jaslide/renderer:v0.6.1 sh -c "pip install --disable-pip-version-check --no-cache-dir pytest==8.4.2 httpx==0.28.1 >/dev/null 2>&1 && python -m pytest apps/renderer/tests/test_pptx_generator.py -k timeline -v"`
Expected: FAIL — no slide is produced for a "TIMELINE"/content-shaped slide (falls through to `_add_content_slide`, which ignores `content["timeline"]`), so none of the expected texts/shapes appear.

- [ ] **Step 3: Add dispatch flag and branch in `_add_slide`**

In `apps/renderer/src/generators/pptx_generator.py`, change:

```python
        has_columns = (
            isinstance(columns, list) and len(columns) == 2
            and all(isinstance(item, dict) for item in columns)
            and not content.get("table") and not content.get("chart")
        )

        if slide_type == "TITLE":
            self._add_title_slide(slide_data)
        elif has_columns or slide_type == "TWO_COLUMN":
            self._add_two_column_slide(slide_data)
        elif slide_type == "CONTENT":
```

to:

```python
        has_columns = (
            isinstance(columns, list) and len(columns) == 2
            and all(isinstance(item, dict) for item in columns)
            and not content.get("table") and not content.get("chart")
        )
        timeline = content.get("timeline") if isinstance(content, dict) else None
        has_timeline = (
            isinstance(timeline, dict) and isinstance(timeline.get("items"), list)
            and 3 <= len(timeline["items"]) <= 8
            and not content.get("table") and not content.get("chart")
        )

        if slide_type == "TITLE":
            self._add_title_slide(slide_data)
        elif has_columns or slide_type == "TWO_COLUMN":
            self._add_two_column_slide(slide_data)
        elif has_timeline:
            self._add_timeline_slide(slide_data)
        elif slide_type == "CONTENT":
```

- [ ] **Step 4: Add `_add_timeline_slide`**

Add after `_add_two_column_slide`/`_add_column_bullets` (after line 1070, before `_add_quote_slide`):

```python
    def _add_timeline_slide(self, slide_data: Any):
        """Add a horizontal timeline/roadmap slide."""
        blank_layout = self.prs.slide_layouts[6]
        slide = self.prs.slides.add_slide(blank_layout)
        self._apply_background(slide)

        content = slide_data.content
        title = content.get("heading", slide_data.title or "")
        title_layout = self._layout("title", {"x": 0.5, "y": 0.3, "w": 12.333, "h": 0.8, "fontSize": 36})
        title_box = self._add_layout_textbox(slide, title_layout)
        tf = title_box.text_frame
        tf.paragraphs[0].text = title
        self._style_paragraph(tf.paragraphs[0], title_layout["fontSize"], self.tokens["title_font"], bold=True)
        self._apply_alignment(tf.paragraphs[0], title_layout.get("align"))

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
            text_box.text_frame.word_wrap = True
            label_paragraph = text_box.text_frame.paragraphs[0]
            label_paragraph.text = label
            self._style_paragraph(label_paragraph, 13, self.tokens["body_font"], bold=True)
            label_paragraph.alignment = PP_ALIGN.CENTER
            if description:
                description_paragraph = text_box.text_frame.add_paragraph()
                description_paragraph.text = description
                self._style_paragraph(description_paragraph, 11, self.tokens["body_font"])
                description_paragraph.alignment = PP_ALIGN.CENTER
            self._shrink_text_to_fit(text_box)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `docker run --rm -v "$(pwd)/apps/renderer:/app/apps/renderer" -w /app jaslide/renderer:v0.6.1 sh -c "pip install --disable-pip-version-check --no-cache-dir pytest==8.4.2 httpx==0.28.1 >/dev/null 2>&1 && python -m pytest apps/renderer/tests/test_pptx_generator.py -v"`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add apps/renderer/src/generators/pptx_generator.py apps/renderer/tests/test_pptx_generator.py
git commit -m "feat(renderer): render TIMELINE slides with auto-fit text"
```

---

### Task 4: Python — process slide

**Files:**
- Modify: `apps/renderer/src/generators/pptx_generator.py`
- Test: `apps/renderer/tests/test_pptx_generator.py`

**Interfaces:**
- Consumes: `content["process"] = {"steps": [{"label": str, "description"?: str}]}` (2-6 steps) from Task 1.
- Produces: `self._add_process_slide(slide_data) -> None`, `has_process` dispatch flag.

- [ ] **Step 1: Write the failing test**

Add to `apps/renderer/tests/test_pptx_generator.py`:

```python
def test_process_slide_renders_numbered_steps_with_connecting_arrows():
    output = PPTXGenerator().generate(_presentation(_slide(
        "PROCESS", "승인 절차",
        {"heading": "승인 절차", "process": {"steps": [
            {"label": "접수", "description": "요청 접수"},
            {"label": "검토", "description": "내용 검토"},
            {"label": "승인", "description": "최종 승인"},
        ]}},
    )))

    slide = Presentation(BytesIO(output)).slides[0]
    texts = " ".join(run.text for run in _runs(slide))
    assert "접수" in texts and "검토" in texts and "승인" in texts
    arrows = [shape for shape in slide.shapes if getattr(shape, "auto_shape_type", None) == MSO_SHAPE.RIGHT_ARROW]
    assert len(arrows) == 2  # one fewer than the number of steps


def test_process_slide_keeps_its_chart_even_if_it_also_carries_a_process():
    output = PPTXGenerator().generate(_presentation(_slide(
        "CHART", "실적 추이",
        {
            "heading": "실적 추이",
            "chart": {"labels": ["Before", "After"], "values": [48, 11]},
            "process": {"steps": [{"label": "a"}, {"label": "b"}]},
        },
    )))

    slide = Presentation(BytesIO(output)).slides[0]
    assert any(shape.has_chart for shape in slide.shapes)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker run --rm -v "$(pwd)/apps/renderer:/app/apps/renderer" -w /app jaslide/renderer:v0.6.1 sh -c "pip install --disable-pip-version-check --no-cache-dir pytest==8.4.2 httpx==0.28.1 >/dev/null 2>&1 && python -m pytest apps/renderer/tests/test_pptx_generator.py -k process -v"`
Expected: FAIL — no arrows/step boxes are produced yet.

- [ ] **Step 3: Add dispatch flag and branch**

In `_add_slide`, change:

```python
        if slide_type == "TITLE":
            self._add_title_slide(slide_data)
        elif has_columns or slide_type == "TWO_COLUMN":
            self._add_two_column_slide(slide_data)
        elif has_timeline:
            self._add_timeline_slide(slide_data)
        elif slide_type == "CONTENT":
```

to:

```python
        process = content.get("process") if isinstance(content, dict) else None
        has_process = (
            isinstance(process, dict) and isinstance(process.get("steps"), list)
            and 2 <= len(process["steps"]) <= 6
            and not content.get("table") and not content.get("chart")
        )

        if slide_type == "TITLE":
            self._add_title_slide(slide_data)
        elif has_columns or slide_type == "TWO_COLUMN":
            self._add_two_column_slide(slide_data)
        elif has_timeline:
            self._add_timeline_slide(slide_data)
        elif has_process:
            self._add_process_slide(slide_data)
        elif slide_type == "CONTENT":
```

(The `process` local is added directly above the `if slide_type == "TITLE":` line, alongside the existing `columns`/`timeline` locals.)

- [ ] **Step 4: Add `_add_process_slide`**

Add after `_add_timeline_slide`:

```python
    def _add_process_slide(self, slide_data: Any):
        """Add a left-to-right numbered process/step-flow slide."""
        blank_layout = self.prs.slide_layouts[6]
        slide = self.prs.slides.add_slide(blank_layout)
        self._apply_background(slide)

        content = slide_data.content
        title = content.get("heading", slide_data.title or "")
        title_layout = self._layout("title", {"x": 0.5, "y": 0.3, "w": 12.333, "h": 0.8, "fontSize": 36})
        title_box = self._add_layout_textbox(slide, title_layout)
        tf = title_box.text_frame
        tf.paragraphs[0].text = title
        self._style_paragraph(tf.paragraphs[0], title_layout["fontSize"], self.tokens["title_font"], bold=True)
        self._apply_alignment(tf.paragraphs[0], title_layout.get("align"))

        steps = content["process"]["steps"]
        count = len(steps)
        left, right, y, h, gap = 0.7, 12.633, 2.8, 1.8, 0.4
        box_w = (right - left - gap * (count - 1)) / count
        for index, step in enumerate(steps):
            x = left + index * (box_w + gap)
            box = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(box_w), Inches(h))
            box.fill.solid()
            box.fill.fore_color.rgb = self.tokens["background"]
            box.line.color.rgb = self.tokens["text"]
            box_tf = box.text_frame
            box_tf.word_wrap = True
            number_paragraph = box_tf.paragraphs[0]
            number_paragraph.text = f"{index + 1}. {step.get('label', '')}"
            self._style_paragraph(number_paragraph, 14, self.tokens["body_font"], bold=True)
            number_paragraph.alignment = PP_ALIGN.CENTER
            description = str(step.get("description", "")).strip()
            if description:
                description_paragraph = box_tf.add_paragraph()
                description_paragraph.text = description
                self._style_paragraph(description_paragraph, 11, self.tokens["body_font"])
                description_paragraph.alignment = PP_ALIGN.CENTER
            self._shrink_text_to_fit(box)
            if index < count - 1:
                arrow = slide.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, Inches(x + box_w), Inches(y + h / 2 - 0.15), Inches(gap), Inches(0.3))
                arrow.fill.solid()
                arrow.fill.fore_color.rgb = self.tokens["text"]
                arrow.line.fill.background()
```

- [ ] **Step 5: Run test to verify it passes**

Run: `docker run --rm -v "$(pwd)/apps/renderer:/app/apps/renderer" -w /app jaslide/renderer:v0.6.1 sh -c "pip install --disable-pip-version-check --no-cache-dir pytest==8.4.2 httpx==0.28.1 >/dev/null 2>&1 && python -m pytest apps/renderer/tests/test_pptx_generator.py -v"`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add apps/renderer/src/generators/pptx_generator.py apps/renderer/tests/test_pptx_generator.py
git commit -m "feat(renderer): render PROCESS slides with auto-fit text"
```

---

### Task 5: Python — comparison slide

**Files:**
- Modify: `apps/renderer/src/generators/pptx_generator.py`
- Test: `apps/renderer/tests/test_pptx_generator.py`

**Interfaces:**
- Consumes: `content["comparison"] = {"left": {"title": str, "bullets": [{"text": str, "level": int}]}, "right": {...}}` from Task 2; `self._add_column_bullets(slide, bullets, x, top, height)` (existing, `pptx_generator.py:1053`, unchanged).
- Produces: `self._add_comparison_slide(slide_data) -> None`, `has_comparison` dispatch flag.

- [ ] **Step 1: Write the failing test**

Add to `apps/renderer/tests/test_pptx_generator.py`:

```python
def test_comparison_slide_renders_both_sides_with_a_vs_badge():
    output = PPTXGenerator().generate(_presentation(_slide(
        "COMPARISON", "플랜 비교",
        {"heading": "플랜 비교", "comparison": {
            "left": {"title": "기본형", "bullets": [{"text": "가격 저렴", "level": 0}]},
            "right": {"title": "프리미엄", "bullets": [{"text": "전체 기능", "level": 0}]},
        }},
    )))

    slide = Presentation(BytesIO(output)).slides[0]
    texts = [run.text for run in _runs(slide)]
    assert "기본형" in texts and "프리미엄" in texts
    assert any("가격 저렴" in text for text in texts) and any("전체 기능" in text for text in texts)
    assert "VS" in texts


def test_comparison_slide_keeps_its_table_even_if_it_also_carries_a_comparison():
    output = PPTXGenerator().generate(_presentation(_slide(
        "TABLE", "실적",
        {
            "heading": "실적",
            "table": {"headers": ["부서", "실적"], "rows": [["개발팀", "90%"]]},
            "comparison": {
                "left": {"title": "a", "bullets": [{"text": "x", "level": 0}]},
                "right": {"title": "b", "bullets": [{"text": "y", "level": 0}]},
            },
        },
    )))

    slide = Presentation(BytesIO(output)).slides[0]
    texts = [run.text for run in _runs(slide)]
    assert "개발팀" in texts and "90%" in texts
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker run --rm -v "$(pwd)/apps/renderer:/app/apps/renderer" -w /app jaslide/renderer:v0.6.1 sh -c "pip install --disable-pip-version-check --no-cache-dir pytest==8.4.2 httpx==0.28.1 >/dev/null 2>&1 && python -m pytest apps/renderer/tests/test_pptx_generator.py -k comparison -v"`
Expected: FAIL — no comparison content is rendered yet.

- [ ] **Step 3: Add dispatch flag and branch**

In `_add_slide`, add the `comparison` local alongside `process`, and add the branch:

```python
        comparison = content.get("comparison") if isinstance(content, dict) else None
        has_comparison = (
            isinstance(comparison, dict) and isinstance(comparison.get("left"), dict) and isinstance(comparison.get("right"), dict)
            and not content.get("table") and not content.get("chart")
        )

        if slide_type == "TITLE":
            self._add_title_slide(slide_data)
        elif has_columns or slide_type == "TWO_COLUMN":
            self._add_two_column_slide(slide_data)
        elif has_timeline:
            self._add_timeline_slide(slide_data)
        elif has_process:
            self._add_process_slide(slide_data)
        elif has_comparison:
            self._add_comparison_slide(slide_data)
        elif slide_type == "CONTENT":
```

- [ ] **Step 4: Add `_add_comparison_slide`**

Add after `_add_process_slide`:

```python
    def _add_comparison_slide(self, slide_data: Any):
        """Add a two-sided VS comparison slide."""
        blank_layout = self.prs.slide_layouts[6]
        slide = self.prs.slides.add_slide(blank_layout)
        self._apply_background(slide)

        content = slide_data.content
        title = content.get("heading", slide_data.title or "")
        title_layout = self._layout("title", {"x": 0.5, "y": 0.3, "w": 12.333, "h": 0.8, "fontSize": 36})
        title_box = self._add_layout_textbox(slide, title_layout)
        tf = title_box.text_frame
        tf.paragraphs[0].text = title
        self._style_paragraph(tf.paragraphs[0], title_layout["fontSize"], self.tokens["title_font"], bold=True)
        self._apply_alignment(tf.paragraphs[0], title_layout.get("align"))

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
        badge.fill.solid()
        badge.fill.fore_color.rgb = self.tokens["text"]
        badge.line.fill.background()
        badge_paragraph = badge.text_frame.paragraphs[0]
        badge_paragraph.text = "VS"
        self._style_paragraph(badge_paragraph, 16, self.tokens["body_font"], bold=True)
        badge_paragraph.alignment = PP_ALIGN.CENTER
        for run in badge_paragraph.runs:
            run.font.color.rgb = self._rgb("#FFFFFF", self.DEFAULT_COLORS["text"])
```

- [ ] **Step 5: Run test to verify it passes**

Run: `docker run --rm -v "$(pwd)/apps/renderer:/app/apps/renderer" -w /app jaslide/renderer:v0.6.1 sh -c "pip install --disable-pip-version-check --no-cache-dir pytest==8.4.2 httpx==0.28.1 >/dev/null 2>&1 && python -m pytest apps/renderer/tests/test_pptx_generator.py -v"`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add apps/renderer/src/generators/pptx_generator.py apps/renderer/tests/test_pptx_generator.py
git commit -m "feat(renderer): render COMPARISON slides with a VS badge"
```

---

### Task 6: Python — KPI slide

**Files:**
- Modify: `apps/renderer/src/generators/pptx_generator.py`
- Test: `apps/renderer/tests/test_pptx_generator.py`

**Interfaces:**
- Consumes: `content["metrics"] = {"metrics": [{"value": str, "label": str}]}` (2-6 cards) from Task 2. Uses `math` (already imported at `pptx_generator.py:22`).
- Produces: `self._add_kpi_slide(slide_data) -> None`, `has_kpi` dispatch flag.

- [ ] **Step 1: Write the failing test**

Add to `apps/renderer/tests/test_pptx_generator.py`:

```python
def test_kpi_slide_renders_a_card_per_metric_in_a_grid():
    output = PPTXGenerator().generate(_presentation(_slide(
        "KPI", "핵심 지표",
        {"heading": "핵심 지표", "metrics": {"metrics": [
            {"value": "120%", "label": "목표 달성률"},
            {"value": "3.2억", "label": "매출"},
            {"value": "15", "label": "신규 계약"},
        ]}},
    )))

    slide = Presentation(BytesIO(output)).slides[0]
    texts = [run.text for run in _runs(slide)]
    assert "120%" in texts and "목표 달성률" in texts
    assert "3.2억" in texts and "매출" in texts
    assert "15" in texts and "신규 계약" in texts
    cards = [shape for shape in slide.shapes if getattr(shape, "auto_shape_type", None) == MSO_SHAPE.ROUNDED_RECTANGLE]
    assert len(cards) == 3


def test_kpi_slide_keeps_its_chart_even_if_it_also_carries_metrics():
    output = PPTXGenerator().generate(_presentation(_slide(
        "CHART", "실적 추이",
        {
            "heading": "실적 추이",
            "chart": {"labels": ["Before", "After"], "values": [48, 11]},
            "metrics": {"metrics": [{"value": "1", "label": "a"}, {"value": "2", "label": "b"}]},
        },
    )))

    slide = Presentation(BytesIO(output)).slides[0]
    assert any(shape.has_chart for shape in slide.shapes)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker run --rm -v "$(pwd)/apps/renderer:/app/apps/renderer" -w /app jaslide/renderer:v0.6.1 sh -c "pip install --disable-pip-version-check --no-cache-dir pytest==8.4.2 httpx==0.28.1 >/dev/null 2>&1 && python -m pytest apps/renderer/tests/test_pptx_generator.py -k kpi -v"`
Expected: FAIL — no KPI cards are rendered yet.

- [ ] **Step 3: Add dispatch flag and branch**

In `_add_slide`, add the `metrics`/`has_kpi` local alongside `comparison`, and add the branch:

```python
        metrics = content.get("metrics") if isinstance(content, dict) else None
        has_kpi = (
            isinstance(metrics, dict) and isinstance(metrics.get("metrics"), list)
            and 2 <= len(metrics["metrics"]) <= 6
            and not content.get("table") and not content.get("chart")
        )

        if slide_type == "TITLE":
            self._add_title_slide(slide_data)
        elif has_columns or slide_type == "TWO_COLUMN":
            self._add_two_column_slide(slide_data)
        elif has_timeline:
            self._add_timeline_slide(slide_data)
        elif has_process:
            self._add_process_slide(slide_data)
        elif has_comparison:
            self._add_comparison_slide(slide_data)
        elif has_kpi:
            self._add_kpi_slide(slide_data)
        elif slide_type == "CONTENT":
```

- [ ] **Step 4: Add `_add_kpi_slide`**

Add after `_add_comparison_slide`:

```python
    def _add_kpi_slide(self, slide_data: Any):
        """Add a grid of KPI metric cards."""
        blank_layout = self.prs.slide_layouts[6]
        slide = self.prs.slides.add_slide(blank_layout)
        self._apply_background(slide)

        content = slide_data.content
        title = content.get("heading", slide_data.title or "")
        title_layout = self._layout("title", {"x": 0.5, "y": 0.3, "w": 12.333, "h": 0.8, "fontSize": 36})
        title_box = self._add_layout_textbox(slide, title_layout)
        tf = title_box.text_frame
        tf.paragraphs[0].text = title
        self._style_paragraph(tf.paragraphs[0], title_layout["fontSize"], self.tokens["title_font"], bold=True)
        self._apply_alignment(tf.paragraphs[0], title_layout.get("align"))

        metrics = content["metrics"]["metrics"]
        count = len(metrics)
        columns = 3 if count > 4 else 2
        rows = math.ceil(count / columns)
        left, top, right, bottom, gap = 0.7, 1.6, 12.633, 6.9, 0.3
        card_w = (right - left - gap * (columns - 1)) / columns
        card_h = (bottom - top - gap * (rows - 1)) / rows
        for index, metric in enumerate(metrics):
            col, row = index % columns, index // columns
            x = left + col * (card_w + gap)
            y = top + row * (card_h + gap)
            card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(card_w), Inches(card_h))
            card.fill.solid()
            card.fill.fore_color.rgb = self.tokens["background"]
            card.line.color.rgb = self.tokens["text"]
            card_tf = card.text_frame
            card_tf.word_wrap = True
            value_paragraph = card_tf.paragraphs[0]
            value_paragraph.text = str(metric.get("value", ""))
            self._style_paragraph(value_paragraph, 32, self.tokens["body_font"], bold=True)
            value_paragraph.alignment = PP_ALIGN.CENTER
            label_paragraph = card_tf.add_paragraph()
            label_paragraph.text = str(metric.get("label", ""))
            self._style_paragraph(label_paragraph, 13, self.tokens["body_font"])
            label_paragraph.alignment = PP_ALIGN.CENTER
            self._shrink_text_to_fit(card)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `docker run --rm -v "$(pwd)/apps/renderer:/app/apps/renderer" -w /app jaslide/renderer:v0.6.1 sh -c "pip install --disable-pip-version-check --no-cache-dir pytest==8.4.2 httpx==0.28.1 >/dev/null 2>&1 && python -m pytest apps/renderer/tests/test_pptx_generator.py -v"`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add apps/renderer/src/generators/pptx_generator.py apps/renderer/tests/test_pptx_generator.py
git commit -m "feat(renderer): render KPI slides with auto-fit metric cards"
```

---

### Task 7: Live verification

**Files:** none (verification only — rebuilds and exercises the images built from Tasks 1-6)

**Interfaces:**
- Consumes: the full running Docker Compose stack (postgres, redis, renderer, migrate, api, web) and the local Ollama model already registered from prior sessions.

- [ ] **Step 1: Rebuild the `api` and `renderer` images**

```bash
docker compose build api renderer
docker compose up -d
```

- [ ] **Step 2: Run both full test suites one more time against the rebuilt images**

Run: `docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm go test ./internal/generation/... -v`
Run: `docker run --rm -v "$(pwd)/apps/renderer:/app/apps/renderer" -w /app jaslide/renderer:v0.6.1 sh -c "pip install --disable-pip-version-check --no-cache-dir pytest==8.4.2 httpx==0.28.1 >/dev/null 2>&1 && python -m pytest apps/renderer/tests/test_pptx_generator.py -v"`
Expected: PASS (both suites, in full)

- [ ] **Step 3: Generate a real presentation through the browser exercising all four new layouts**

Open `http://localhost:3000/dashboard`, start a new generation whose source content clearly calls for a roadmap, a step-by-step process, a two-option comparison, and a set of KPIs (e.g. a project status update with "1분기 로드맵", "승인 절차", "플랜 A vs B", "이번 분기 핵심 지표" sections). Let it generate with the local model.

- [ ] **Step 4: Export the generated deck and inspect it**

Download the `.pptx` export and open it (or inspect via `python-pptx` in a scratch script) to confirm each of the four new layouts rendered with real content (not collapsed into a flat CONTENT bullet list), and that no text visibly overflows its box.

- [ ] **Step 5: Fix forward if live verification finds a problem**

If any layout mis-renders (wrong dispatch, overflow, missing shape), fix it in the relevant task's files, re-run that task's test file, and commit as a small fix-forward commit referencing which task it corrects — do not amend prior commits.

---

## Future Work

(Unchanged from the design spec — captured here for continuity, not part of this plan's scope.)

1. Retrofit `_shrink_text_to_fit` onto the existing layout types (CONTENT, BULLET_LIST, TWO_COLUMN, SECTION_HEADER).
2. Automatic image placement.
3. Template-wide design consistency (colors/fonts/margins across every slide type).
4. Generation pipeline self-review loop (`apps/core-api`) — separate sub-project, independent of this one and of the underlying model.
