# Weekly Report Skill Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "박태지_0723_업무보고_AI엔지니어링" skill produce a two-column slide with server-computed this-week/next-week (Mon-Fri) date headers and level-aware nested bullets, instead of a flat bullet list that drops the dates and the structure.

**Architecture:** Compute date ranges deterministically in Go and always offer them as prompt context (the model copies, never calculates). Extend the `TWO_COLUMN` content schema with a `columns` field (header + leveled bullets per column, mirroring the existing `TABLE`/`CHART` "valid-or-omit" pattern) and share the existing bullet-parsing rules between the top-level `bullets` field and each column via one extracted helper. Update the renderer's `_add_two_column_slide` to render column headers and respect bullet levels it currently ignores. Finish by updating this one skill's `outlineGuidance` data (no code) and verifying end to end against the running local stack.

**Tech Stack:** Go 1.24 (core-api), Python 3.11 / python-pptx (renderer), Docker for running both test suites without a local toolchain, `docker exec ... psql` against the running `jaslide-postgres-1` container for the data-only step.

## Global Constraints

- The this-week/next-week calculation is Monday-Friday; a date that falls on Saturday/Sunday belongs to the week whose Monday precedes it (i.e. Sunday is the last day of the *preceding* Monday-Friday week).
- Date strings are formatted `"YYYY.MM.DD ~ YYYY.MM.DD"` (matching the original template's own date format).
- Existing `CONTENT`/`BULLET_LIST`/`CHART`/`TABLE`/flat-`TWO_COLUMN` generation output must remain byte-for-byte schema-compatible — every new behavior is additive (a new optional `columns` field; the flat `bullets`-split path is an explicit fallback, not removed).
- `columns` must be exactly 2 entries, each with a non-empty `header` string and at least 1 bullet; anything else is treated as absent (omit the field, fall back to flat `bullets`) — no error, no example placeholder (unlike `TABLE`/`CHART`, there's no meaningful "example two-column" to synthesize).
- All commands assume the working directory is the repository root (`JaSlide/`).
- Prompt-facing instruction text (the parts written in English elsewhere in `llm.go`, e.g. "Choose each slide's type by its content...") stays in English for consistency with the existing file; only literal output labels (e.g. `추진실적`) are Korean.

---

### Task 1: Compute this-week/next-week date ranges and offer them in every prompt

**Files:**
- Modify: `apps/core-api/internal/generation/llm.go` (new `weekRanges`, `dateGuidance`; wire into `outlinePrompt` and `slidePrompt`)
- Modify: `apps/core-api/internal/generation/llm_test.go` (add tests, add `"time"` import)

**Interfaces:**
- Consumes: nothing new.
- Produces: `weekRanges(now time.Time) (thisWeek, nextWeek string)` and `dateGuidance() string`, both usable by any future prompt in this package. `outlinePrompt`/`slidePrompt` keep their exact existing signatures.

- [ ] **Step 1: Write the failing tests**

Add `"time"` to the import block at the top of `apps/core-api/internal/generation/llm_test.go` (alongside the existing `"context"`, `"encoding/json"`, etc.), then append:

```go
func TestWeekRangesComputesMondayToFridayForThisAndNextWeek(t *testing.T) {
	// 2026-08-05 is a Wednesday.
	now := time.Date(2026, 8, 5, 15, 0, 0, 0, time.UTC)
	thisWeek, nextWeek := weekRanges(now)
	if thisWeek != "2026.08.03 ~ 2026.08.07" {
		t.Fatalf("thisWeek = %q, want 2026.08.03 ~ 2026.08.07", thisWeek)
	}
	if nextWeek != "2026.08.10 ~ 2026.08.14" {
		t.Fatalf("nextWeek = %q, want 2026.08.10 ~ 2026.08.14", nextWeek)
	}
}

func TestWeekRangesTreatsSundayAsPartOfThePrecedingWeek(t *testing.T) {
	// 2026-08-09 is a Sunday; its Monday-Friday week is 2026-08-03..2026-08-07.
	now := time.Date(2026, 8, 9, 9, 0, 0, 0, time.UTC)
	thisWeek, _ := weekRanges(now)
	if thisWeek != "2026.08.03 ~ 2026.08.07" {
		t.Fatalf("thisWeek = %q, want 2026.08.03 ~ 2026.08.07", thisWeek)
	}
}

func TestOutlinePromptAndSlidePromptIncludeDateGuidance(t *testing.T) {
	outline := outlinePrompt(OutlineRequest{Content: "source", Language: "ko", SlideCount: 1})
	if !strings.Contains(outline, "This week") || !strings.Contains(outline, "Next week") {
		t.Fatalf("expected outline prompt to include week guidance, got: %s", outline)
	}
	slide := slidePrompt(SlideRequest{Title: "t", Type: "CONTENT", Language: "ko"})
	if !strings.Contains(slide, "This week") || !strings.Contains(slide, "Next week") {
		t.Fatalf("expected slide prompt to include week guidance, got: %s", slide)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm go test ./internal/generation/... -run 'TestWeekRanges|TestOutlinePromptAndSlidePromptIncludeDateGuidance' -v`

Expected: build failure (`weekRanges` undefined) — `TestWeekRangesComputesMondayToFridayForThisAndNextWeek`, `TestWeekRangesTreatsSundayAsPartOfThePrecedingWeek`, and `TestOutlinePromptAndSlidePromptIncludeDateGuidance` all fail to compile.

- [ ] **Step 3: Add `"time"` to the import block in `llm.go`**

In `apps/core-api/internal/generation/llm.go`, change:

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
	"strings"

	"github.com/spsp4755/JaSlide/apps/core-api/internal/outboundpolicy"
)
```

to:

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
	"strings"
	"time"

	"github.com/spsp4755/JaSlide/apps/core-api/internal/outboundpolicy"
)
```

- [ ] **Step 4: Add `weekRanges` and `dateGuidance`**

In `apps/core-api/internal/generation/llm.go`, immediately before `func outlinePrompt(input OutlineRequest) string {`, add:

```go
// weekRanges returns "YYYY.MM.DD ~ YYYY.MM.DD" for the Monday-Friday of the
// week containing now, and for the following week — computed once here so
// the model never has to do date arithmetic itself. Sunday counts as the
// last day of the preceding Monday-Friday week.
func weekRanges(now time.Time) (thisWeek, nextWeek string) {
	offset := (int(now.Weekday()) + 6) % 7
	monday := now.AddDate(0, 0, -offset)
	format := func(monday time.Time) string {
		friday := monday.AddDate(0, 0, 4)
		return monday.Format("2006.01.02") + " ~ " + friday.Format("2006.01.02")
	}
	return format(monday), format(monday.AddDate(0, 0, 7))
}

// dateGuidance is appended to every outline/content prompt so a skill that
// needs "this week" / "next week" dates (e.g. a weekly report) can copy an
// already-computed value instead of asking the model to calculate one.
func dateGuidance() string {
	now := time.Now()
	thisWeek, nextWeek := weekRanges(now)
	return fmt.Sprintf(
		" Today is %s. This week (Mon-Fri): %s. Next week (Mon-Fri): %s. "+
			"Use these dates unless the user explicitly states a different period.",
		now.Format("2006.01.02"), thisWeek, nextWeek,
	)
}
```

- [ ] **Step 5: Wire `dateGuidance()` into `outlinePrompt` and `slidePrompt`**

In `apps/core-api/internal/generation/llm.go`, change:

```go
	guidance := "\nChoose each slide's type by its content: TABLE for row/column data such as comparisons, schedules, or structured records; CHART for numeric trends or comparisons; BULLET_LIST for simple lists; TITLE for section covers; CONTENT for narrative slides."
	return fmt.Sprintf(
		"Create exactly %d presentation slides in %s from this source:\n%s%s%s%s\nReturn JSON only: {\"title\":\"Deck\",\"slides\":[{\"order\":1,\"title\":\"Title\",\"type\":\"CONTENT\",\"keyPoints\":[\"specific point\"],\"templateIndex\":0}]}",
		input.SlideCount, input.Language, truncate(input.Content, 10000), catalog, continuation, guidance,
	)
}
```

to:

```go
	guidance := "\nChoose each slide's type by its content: TABLE for row/column data such as comparisons, schedules, or structured records; CHART for numeric trends or comparisons; BULLET_LIST for simple lists; TITLE for section covers; CONTENT for narrative slides."
	return fmt.Sprintf(
		"Create exactly %d presentation slides in %s from this source:\n%s%s%s%s%s\nReturn JSON only: {\"title\":\"Deck\",\"slides\":[{\"order\":1,\"title\":\"Title\",\"type\":\"CONTENT\",\"keyPoints\":[\"specific point\"],\"templateIndex\":0}]}",
		input.SlideCount, input.Language, truncate(input.Content, 10000), catalog, continuation, guidance, dateGuidance(),
	)
}
```

and change:

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

to:

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

- [ ] **Step 6: Run the tests to verify they pass**

Run: `docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm go test ./internal/generation/... -v`

Expected: PASS (all tests in the package, including the three new ones).

- [ ] **Step 7: Commit**

```bash
git add apps/core-api/internal/generation/llm.go apps/core-api/internal/generation/llm_test.go
git commit -m "feat(go-api): compute this-week/next-week dates and offer them in every prompt"
```

---

### Task 2: Add the `TWO_COLUMN` `columns` content schema

**Files:**
- Modify: `apps/core-api/internal/generation/llm.go` (extract `parseBullets`, add `validColumns`, wire into `parseSlideContent`)
- Modify: `apps/core-api/internal/generation/llm_test.go` (add tests)

**Interfaces:**
- Consumes: `dateGuidance()` from Task 1 (already wired into `slidePrompt`; no further change needed here).
- Produces: `parseBullets(raw any, limit int) []map[string]any` (new shared helper) and `validColumns(raw any) []map[string]any` (new function, same "valid-or-nil" shape as `validChart`/`validTable`). `parseSlideContent`'s output gains an optional `columns` field: `[{"header": string, "bullets": [{"text": string, "level": int}, ...]}, {...}]`, always exactly 2 entries or the field is absent. This exact JSON shape is what Task 3 (renderer) reads from `content["columns"]`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/core-api/internal/generation/llm_test.go`:

```go
func TestValidColumnsAcceptsExactlyTwoWellFormedColumns(t *testing.T) {
	raw, err := parseSlideContent(json.RawMessage(`{
		"heading":"주간업무 추진실적 및 계획",
		"columns":[
			{"header":"추진실적 (2026.08.03 ~ 2026.08.07)","bullets":[{"text":"IT 운영","level":0},{"text":"NL2SQL","level":1}]},
			{"header":"추진계획 (2026.08.10 ~ 2026.08.14)","bullets":[{"text":"IT 운영","level":0}]}
		]
	}`), "TWO_COLUMN")
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	columns, ok := value["columns"].([]any)
	if !ok || len(columns) != 2 {
		t.Fatalf("expected 2 columns, got %v", value["columns"])
	}
	first := columns[0].(map[string]any)
	if first["header"] != "추진실적 (2026.08.03 ~ 2026.08.07)" {
		t.Fatalf("unexpected first header: %v", first["header"])
	}
}

func TestValidColumnsRejectsAnythingOtherThanExactlyTwoColumns(t *testing.T) {
	raw, err := parseSlideContent(json.RawMessage(`{
		"heading":"h",
		"columns":[{"header":"only one","bullets":[{"text":"x","level":0}]}]
	}`), "TWO_COLUMN")
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	if _, ok := value["columns"]; ok {
		t.Fatalf("expected columns to be omitted for a single-column response, got %v", value["columns"])
	}
}

func TestParseSlideContentStillFallsBackToFlatBulletsWithoutColumns(t *testing.T) {
	raw, err := parseSlideContent(json.RawMessage(`{"heading":"h","bullets":["a","b"]}`), "TWO_COLUMN")
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	if _, ok := value["columns"]; ok {
		t.Fatal("expected no columns field when the model didn't provide any")
	}
	if _, ok := value["bullets"]; !ok {
		t.Fatal("expected the flat bullets field to still be present as a fallback")
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm go test ./internal/generation/... -run TestValidColumns -v`

Expected: FAIL — `value["columns"]` is always absent because nothing reads `value["columns"]` from the parsed content yet.

- [ ] **Step 3: Extract the shared `parseBullets` helper**

In `apps/core-api/internal/generation/llm.go`, change the bullets block inside `parseSlideContent`:

```go
	if rawBullets, ok := value["bullets"].([]any); ok {
		var bullets []map[string]any
		for _, item := range rawBullets {
			if len(bullets) == 5 {
				break
			}
			switch bullet := item.(type) {
			case string:
				if strings.TrimSpace(bullet) != "" {
					bullets = append(bullets, map[string]any{"text": bullet, "level": 0})
				}
			case map[string]any:
				if text, ok := bullet["text"].(string); ok && strings.TrimSpace(text) != "" {
					level := 0
					if raw, ok := bullet["level"].(float64); ok && raw == float64(int(raw)) && raw >= 0 && raw <= 4 {
						level = int(raw)
					}
					bullets = append(bullets, map[string]any{"text": text, "level": level})
				}
			}
		}
		if len(bullets) > 0 {
			result["bullets"] = bullets
		}
	}
```

to:

```go
	if bullets := parseBullets(value["bullets"], 5); len(bullets) > 0 {
		result["bullets"] = bullets
	}
```

Then add `parseBullets` right after the closing brace of `parseSlideContent` (before `func validChart(raw any) map[string]any {`):

```go
// parseBullets extracts up to `limit` well-formed bullets ({text, level})
// from raw. Shared by the top-level "bullets" field and each TWO_COLUMN
// column's own bullets so both follow the exact same rules.
func parseBullets(raw any, limit int) []map[string]any {
	rawBullets, ok := raw.([]any)
	if !ok {
		return nil
	}
	var bullets []map[string]any
	for _, item := range rawBullets {
		if len(bullets) == limit {
			break
		}
		switch bullet := item.(type) {
		case string:
			if strings.TrimSpace(bullet) != "" {
				bullets = append(bullets, map[string]any{"text": bullet, "level": 0})
			}
		case map[string]any:
			if text, ok := bullet["text"].(string); ok && strings.TrimSpace(text) != "" {
				level := 0
				if raw, ok := bullet["level"].(float64); ok && raw == float64(int(raw)) && raw >= 0 && raw <= 4 {
					level = int(raw)
				}
				bullets = append(bullets, map[string]any{"text": text, "level": level})
			}
		}
	}
	return bullets
}
```

- [ ] **Step 4: Add `validColumns` and wire it into `parseSlideContent`**

In `apps/core-api/internal/generation/llm.go`, immediately after the `validTable` function's closing brace, add:

```go
// maxColumnBullets caps how many bullets a single TWO_COLUMN column can
// carry — generous enough for a real weekly report's ~11-item list.
const maxColumnBullets = 20

// validColumns requires exactly two columns, each with a non-empty header
// and at least one bullet, for TWO_COLUMN slides like a weekly report's
// "this week" / "next week" layout. Returns nil (no error, no placeholder)
// for anything else — the caller falls back to the flat "bullets" field.
func validColumns(raw any) []map[string]any {
	rawColumns, ok := raw.([]any)
	if !ok || len(rawColumns) != 2 {
		return nil
	}
	columns := make([]map[string]any, 2)
	for index, rawColumn := range rawColumns {
		column, ok := rawColumn.(map[string]any)
		if !ok {
			return nil
		}
		header, ok := column["header"].(string)
		if !ok || strings.TrimSpace(header) == "" {
			return nil
		}
		bullets := parseBullets(column["bullets"], maxColumnBullets)
		if len(bullets) == 0 {
			return nil
		}
		columns[index] = map[string]any{"header": header, "bullets": bullets}
	}
	return columns
}
```

Then, in `parseSlideContent`, change:

```go
	if table := validTable(value["table"]); table != nil {
		result["table"] = table
	} else if slideType == "TABLE" {
		if chartTable := tableFromChart(value["chart"]); chartTable != nil {
			// Some models (esp. small local ones) put real tabular data under
			// "chart" instead of the requested "table" key; reuse it rather than
			// discarding it for a placeholder.
			result["table"] = chartTable
		} else {
			result["table"] = map[string]any{
				"headers": []string{"항목", "값"}, "rows": [][]string{{"예시", "-"}}, "isExample": true,
			}
		}
	}
	return json.Marshal(result)
}
```

to:

```go
	if table := validTable(value["table"]); table != nil {
		result["table"] = table
	} else if slideType == "TABLE" {
		if chartTable := tableFromChart(value["chart"]); chartTable != nil {
			// Some models (esp. small local ones) put real tabular data under
			// "chart" instead of the requested "table" key; reuse it rather than
			// discarding it for a placeholder.
			result["table"] = chartTable
		} else {
			result["table"] = map[string]any{
				"headers": []string{"항목", "값"}, "rows": [][]string{{"예시", "-"}}, "isExample": true,
			}
		}
	}
	if columns := validColumns(value["columns"]); columns != nil {
		result["columns"] = columns
	}
	return json.Marshal(result)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm go test ./internal/generation/... -v`

Expected: PASS (all tests in the package, including the three new ones — this also re-confirms the `parseBullets` extraction didn't change the top-level `bullets` field's existing behavior, since `TestParseSlideContentPreservesBulletIndentLevelsUpToFour` and `TestParseSlideContentClampsOutOfRangeBulletLevelToZero` from earlier work still pass unchanged).

- [ ] **Step 6: Commit**

```bash
git add apps/core-api/internal/generation/llm.go apps/core-api/internal/generation/llm_test.go
git commit -m "feat(go-api): add TWO_COLUMN columns schema with shared bullet parsing"
```

---

### Task 3: Render `TWO_COLUMN` column headers and level-aware bullets

**Files:**
- Modify: `apps/renderer/src/generators/pptx_generator.py:996-1052` (`_add_two_column_slide`; new `_add_column_bullets` helper)
- Modify: `apps/renderer/tests/test_pptx_generator.py` (add tests)

**Interfaces:**
- Consumes: `content["columns"]` shaped `[{"header": str, "bullets": [{"text": str, "level": int}, ...]}, {...}]` (exactly 2 entries), produced by Task 2's Go code. Falls back to the existing `content["bullets"]` flat-split behavior when `columns` is absent or malformed.
- Produces: `_add_column_bullets(self, slide: Any, bullets: list, x: float, top: float, height: float) -> None`, a private helper only this method calls.

- [ ] **Step 1: Write the failing tests**

Add to `apps/renderer/tests/test_pptx_generator.py` (anywhere after the existing imports/helpers, e.g. right after the `test_table_with_many_rows_in_small_slot_does_not_overflow` test):

```python
def test_two_column_slide_renders_headers_and_level_aware_bullets():
    output = PPTXGenerator().generate(_presentation(_slide(
        "TWO_COLUMN", "주간업무 추진실적 및 계획",
        {"heading": "주간업무 추진실적 및 계획", "columns": [
            {"header": "추진실적 (2026.08.03 ~ 2026.08.07)", "bullets": [
                {"text": "IT 운영 및 AI 연구", "level": 0},
                {"text": "프로젝트 관리 및 지원", "level": 1},
            ]},
            {"header": "추진계획 (2026.08.10 ~ 2026.08.14)", "bullets": [
                {"text": "IT 운영 및 AI 연구", "level": 0},
            ]},
        ]},
    )))

    slide = Presentation(BytesIO(output)).slides[0]
    texts = [run.text for run in _runs(slide)]
    assert "추진실적 (2026.08.03 ~ 2026.08.07)" in texts
    assert "추진계획 (2026.08.10 ~ 2026.08.14)" in texts
    assert any("프로젝트 관리 및 지원" in text for text in texts)

    paragraphs = [p for shape in slide.shapes if shape.has_text_frame for p in shape.text_frame.paragraphs]
    nested = next(p for p in paragraphs if "프로젝트 관리 및 지원" in p.text)
    assert nested.level == 1


def test_two_column_slide_without_columns_still_splits_flat_bullets():
    output = PPTXGenerator().generate(_presentation(_slide(
        "TWO_COLUMN", "제목", {"heading": "제목", "bullets": ["첫 항목", "둘째 항목"]},
    )))

    slide = Presentation(BytesIO(output)).slides[0]
    texts = [run.text for run in _runs(slide)]
    assert any("첫 항목" in text for text in texts)
    assert any("둘째 항목" in text for text in texts)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker run --rm -v "$(pwd)/apps/renderer:/app/apps/renderer" -w /app jaslide/renderer:v0.6.1 sh -c "pip install --disable-pip-version-check --no-cache-dir pytest==8.4.2 httpx==0.28.1 >/dev/null 2>&1 && python -m pytest apps/renderer/tests/test_pptx_generator.py -k test_two_column_slide_renders_headers_and_level_aware_bullets -v"`

Expected: FAIL — `"추진실적 (2026.08.03 ~ 2026.08.07)" in texts` is false because `_add_two_column_slide` never reads `content["columns"]` or draws a header.

- [ ] **Step 3: Replace `_add_two_column_slide` and add `_add_column_bullets`**

In `apps/renderer/src/generators/pptx_generator.py`, change:

```python
    def _add_two_column_slide(self, slide_data: Any):
        """Add two-column slide"""
        blank_layout = self.prs.slide_layouts[6]
        slide = self.prs.slides.add_slide(blank_layout)
        self._apply_background(slide)

        content = slide_data.content
        title = content.get("heading", slide_data.title or "")
        bullets = content.get("bullets", [])

        # Title
        title_layout = self._layout("title", {"x": 0.5, "y": 0.3, "w": 12.333, "h": 0.8, "fontSize": 36})
        title_box = self._add_layout_textbox(slide, title_layout)
        tf = title_box.text_frame
        tf.paragraphs[0].text = title
        self._style_paragraph(tf.paragraphs[0], title_layout["fontSize"], self.tokens["title_font"], bold=True)
        self._apply_alignment(tf.paragraphs[0], title_layout.get("align"))

        # Split bullets into two columns
        mid = len(bullets) // 2
        left_bullets = bullets[:mid] if mid > 0 else bullets
        right_bullets = bullets[mid:] if mid > 0 else []

        # Left column
        if left_bullets:
            left_box = slide.shapes.add_textbox(
                Inches(0.5), Inches(1.3), Inches(5.9), Inches(5.7)
            )
            tf = left_box.text_frame
            tf.word_wrap = True
            for i, bullet in enumerate(left_bullets):
                text = bullet.get("text", str(bullet)) if isinstance(bullet, dict) else str(bullet)
                if i == 0:
                    p = tf.paragraphs[0]
                else:
                    p = tf.add_paragraph()
                p.text = f"• {text}"
                self._style_paragraph(p, 18, self.tokens["body_font"])
                p.space_before = Pt(10)

        # Right column
        if right_bullets:
            right_box = slide.shapes.add_textbox(
                Inches(6.9), Inches(1.3), Inches(5.9), Inches(5.7)
            )
            tf = right_box.text_frame
            tf.word_wrap = True
            for i, bullet in enumerate(right_bullets):
                text = bullet.get("text", str(bullet)) if isinstance(bullet, dict) else str(bullet)
                if i == 0:
                    p = tf.paragraphs[0]
                else:
                    p = tf.add_paragraph()
                p.text = f"• {text}"
                self._style_paragraph(p, 18, self.tokens["body_font"])
```

to:

```python
    def _add_two_column_slide(self, slide_data: Any):
        """Add two-column slide"""
        blank_layout = self.prs.slide_layouts[6]
        slide = self.prs.slides.add_slide(blank_layout)
        self._apply_background(slide)

        content = slide_data.content
        title = content.get("heading", slide_data.title or "")

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

        # No columns: fall back to splitting a flat bullets array in half.
        bullets = content.get("bullets", [])
        mid = len(bullets) // 2
        left_bullets = bullets[:mid] if mid > 0 else bullets
        right_bullets = bullets[mid:] if mid > 0 else []
        self._add_column_bullets(slide, left_bullets, 0.5, 1.3, 5.7)
        self._add_column_bullets(slide, right_bullets, 6.9, 1.3, 5.7)

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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `docker run --rm -v "$(pwd)/apps/renderer:/app/apps/renderer" -w /app jaslide/renderer:v0.6.1 sh -c "pip install --disable-pip-version-check --no-cache-dir pytest==8.4.2 httpx==0.28.1 >/dev/null 2>&1 && python -m pytest apps/renderer/tests/test_pptx_generator.py -v"`

Expected: PASS (the full `test_pptx_generator.py` suite, including the two new tests — running the whole file confirms nothing else regressed, e.g. the `CONTENT`/`BULLET_LIST` paths that use the separate, untouched `_add_bullets` helper).

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/generators/pptx_generator.py apps/renderer/tests/test_pptx_generator.py
git commit -m "feat(renderer): render TWO_COLUMN headers and level-aware bullets"
```

---

### Task 4: Update the weekly-report skill's `outlineGuidance` (data only, no code)

**Files:** none (a database update against the running local stack).

**Interfaces:** none.

- [ ] **Step 1: Confirm the skill's current row**

Run: `docker exec jaslide-postgres-1 psql -U jaslide -d jaslide -c "SELECT id, name, \"outlineGuidance\" FROM \"PresentationSkill\" WHERE id='go-c82b9a5413d51aa9444b818e1a1eca03';" -x`

Expected: one row, `name` = `박태지_0723_업무보고_AI엔지니어링`, current `outlineGuidance` = `Preserve the original information hierarchy and visual rhythm.`

- [ ] **Step 2: Update the guidance**

Run:

```bash
docker exec jaslide-postgres-1 psql -U jaslide -d jaslide -c "UPDATE \"PresentationSkill\" SET \"outlineGuidance\" = 'Use exactly one slide of type TWO_COLUMN. Left column header must be \"추진실적 (이번 주 날짜)\" using the this-week date given above. Right column header must be \"추진계획 (다음 주 날짜)\" using the next-week date given above. Each column: top-level items at level 0, detail sub-items at level 1-2.' WHERE id='go-c82b9a5413d51aa9444b818e1a1eca03';"
```

Expected: `UPDATE 1`.

- [ ] **Step 3: Verify the update**

Run: `docker exec jaslide-postgres-1 psql -U jaslide -d jaslide -c "SELECT \"outlineGuidance\" FROM \"PresentationSkill\" WHERE id='go-c82b9a5413d51aa9444b818e1a1eca03';"`

Expected: the new guidance text from Step 2.

No commit for this task — it changes runtime data in the local stack's Postgres volume, not tracked source code.

---

### Task 5: Rebuild, redeploy, and verify end to end against the running local stack

**Files:** none (build/deploy/manual verification only).

**Interfaces:** none.

- [ ] **Step 1: Rebuild the `core-api` and `renderer` images**

Run: `docker compose --file docker-compose.yml --env-file .env build api renderer`

Expected: both builds finish `Built` (or cache-hit `up to date`) for `jaslide/core-api:v0.6.1` and `jaslide/renderer:v0.6.1`.

- [ ] **Step 2: Recreate the containers with the new images**

Run: `docker compose --file docker-compose.yml --env-file .env up -d --force-recreate api renderer`

Expected: `docker compose ps` shows `api` and `renderer` both `Up ... (healthy)`.

- [ ] **Step 3: Regenerate using the updated skill**

In the browser (already logged in at `http://localhost:3000` as `admin@koreacb.com`), start a new AI generation using the `박태지_0723_업무보고_AI엔지니어링` skill/template with a prompt like "0730 업무보고를 작성해줘" (no explicit dates, to exercise the default this-week/next-week behavior). Approve the outline and let generation complete.

- [ ] **Step 4: Confirm the job completed and check the stored slide content**

Run: `docker exec jaslide-postgres-1 psql -U jaslide -d jaslide -c "SELECT s.type, s.content FROM \"Slide\" s JOIN \"Presentation\" p ON s.\"presentationId\"=p.id ORDER BY p.\"createdAt\" DESC LIMIT 1;" -x`

Expected: `type` is `TWO_COLUMN`; `content` has a `columns` array of 2 entries whose `header` values contain `추진실적`/`추진계획` followed by a date range matching this week and next week's Monday-Friday dates (compare against the actual current date when you run this).

- [ ] **Step 5: Confirm the exported PPTX shows both column headers and nested bullets**

In the editor for the generated presentation, export PPTX, then inspect it:

```bash
unzip -p <downloaded-file>.pptx ppt/slides/slide1.xml | grep -o '<a:t>[^<]*</a:t>' | head -40
```

Expected: both column header strings (with their date ranges) appear as `<a:t>` text runs, along with the bullet text from each column. Open the file in a viewer (or check `<a:pPr lvl="1"`/similar in the raw XML for a nested bullet) to confirm at least one sub-item paragraph carries a non-zero indent level, not all bullets flush at the same level.

No commit for this task — it is verification only, using artifacts already committed in Tasks 1-3 and data already updated in Task 4.
