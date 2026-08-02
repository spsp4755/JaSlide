package generation

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/spsp4755/JaSlide/apps/core-api/internal/outboundpolicy"
)

type staticModelSource struct{ model Model }

func (source staticModelSource) DefaultModel(context.Context) (Model, error) {
	return source.model, nil
}

func TestOpenAIClientRejectsModelEndpointOutsideConfiguredAllowlist(t *testing.T) {
	policy, err := outboundpolicy.New([]string{"http://approved.internal/v1"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	client := NewOpenAIClient(staticModelSource{model: Model{
		ID: "model-1", ModelID: "unsafe", Endpoint: "http://169.254.169.254/latest", IsActive: true,
	}}, http.DefaultClient, EnvironmentModel{}, policy)
	if _, err := client.resolveModel(context.Background()); err == nil {
		t.Fatal("expected unapproved model endpoint rejection")
	}
}

func TestOpenAIClientDoesNotReadUnapprovedEnvironmentSecret(t *testing.T) {
	t.Setenv("DATABASE_URL", "secret-database-url")
	policy, err := outboundpolicy.New([]string{"http://approved.internal/v1"}, []string{"APPROVED_LLM_KEY"})
	if err != nil {
		t.Fatal(err)
	}
	client := NewOpenAIClient(staticModelSource{model: Model{
		ID: "model-1", ModelID: "safe", Endpoint: "http://approved.internal/v1",
		APIKeyEnvVar: "DATABASE_URL", IsActive: true,
	}}, http.DefaultClient, EnvironmentModel{}, policy)
	model, err := client.resolveModel(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if model.APIKey != "" {
		t.Fatal("unapproved environment secret was loaded")
	}
}

func TestConfiguredLocalModelGeneratesTenSlideOutlineInBatches(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		call := calls.Add(1)
		var input struct {
			MaxTokens int `json:"max_tokens"`
		}
		if err := json.NewDecoder(request.Body).Decode(&input); err != nil {
			t.Fatal(err)
		}
		if input.MaxTokens != 8192 {
			t.Errorf("max_tokens = %d, want configured 8192", input.MaxTokens)
		}
		count := 6
		if call == 2 {
			count = 4
		}
		slides := make([]map[string]any, count)
		for index := range slides {
			slides[index] = map[string]any{
				"order": index + 1, "title": "Slide", "type": "CONTENT",
				"keyPoints": []string{"Specific point"},
			}
		}
		raw, _ := json.Marshal(map[string]any{"title": "Deck", "slides": slides})
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]string{"content": string(raw)}}},
		})
	}))
	defer server.Close()

	llm := NewOpenAIClient(staticModelSource{model: Model{
		ID: "model-1", Provider: "lmstudio", ModelID: "local-model",
		Endpoint: server.URL, MaxTokens: 8192, IsActive: true,
	}}, server.Client(), EnvironmentModel{})
	outline, err := llm.Outline(context.Background(), OutlineRequest{
		Content: "AI security", Language: "ko", SlideCount: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 || len(outline.Slides) != 10 {
		t.Fatalf("calls = %d slides = %d", calls.Load(), len(outline.Slides))
	}
	for index, slide := range outline.Slides {
		if slide.Order != index+1 {
			t.Fatalf("slide %d order = %d", index, slide.Order)
		}
	}
}

func TestParseSlideContentAcceptsTitleAsHeadingFallback(t *testing.T) {
	raw, err := parseSlideContent(json.RawMessage(`{"title":"업무보고","body":"내용"}`), "CONTENT")
	if err != nil {
		t.Fatalf("expected fallback to title to succeed, got error: %v", err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}
	if value["heading"] != "업무보고" {
		t.Fatalf("expected heading %q, got %v", "업무보고", value["heading"])
	}
}

func TestParseSlideContentStillRequiresHeadingOrTitle(t *testing.T) {
	if _, err := parseSlideContent(json.RawMessage(`{"body":"내용"}`), "CONTENT"); err == nil {
		t.Fatal("expected error when neither heading nor title is present")
	}
}

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

func TestParseSlideContentBuildsTableFromChartWhenModelUsesTheWrongKey(t *testing.T) {
	raw, err := parseSlideContent(json.RawMessage(
		`{"heading":"실적","chart":{"labels":["개발팀","기획팀"],"values":[90,85]}}`,
	), "TABLE")
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	table, ok := value["table"].(map[string]any)
	if !ok || table["isExample"] != nil {
		t.Fatalf("expected a real (non-example) table built from chart data, got %v", value["table"])
	}
	rows, ok := table["rows"].([]any)
	if !ok || len(rows) != 2 {
		t.Fatalf("expected 2 rows from the chart's 2 labels, got %v", table["rows"])
	}
	first, ok := rows[0].([]any)
	if !ok || first[0] != "개발팀" || first[1] != "90" {
		t.Fatalf("expected first row [개발팀 90], got %v", rows[0])
	}
}

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

func TestOpenAIClientCritiqueApprovesWellFormedContent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		raw, _ := json.Marshal(map[string]any{"approved": true})
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]string{"content": string(raw)}}},
		})
	}))
	defer server.Close()

	llm := NewOpenAIClient(staticModelSource{model: Model{
		ID: "model-1", ModelID: "local-model", Endpoint: server.URL, MaxTokens: 2048, IsActive: true,
	}}, server.Client(), EnvironmentModel{})
	feedback, err := llm.Critique(context.Background(), CritiqueRequest{
		Content: json.RawMessage(`{"heading":"실적","bullets":[{"text":"90% 달성","level":0}]}`),
		Title:   "실적", KeyPoints: []string{"90% 달성"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if feedback != "" {
		t.Fatalf("expected empty feedback for approved content, got %q", feedback)
	}
}

func TestOpenAIClientCritiqueReturnsFeedbackWhenRejected(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		raw, _ := json.Marshal(map[string]any{"approved": false, "feedback": "Add the missing key point about Q3 results"})
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]string{"content": string(raw)}}},
		})
	}))
	defer server.Close()

	llm := NewOpenAIClient(staticModelSource{model: Model{
		ID: "model-1", ModelID: "local-model", Endpoint: server.URL, MaxTokens: 2048, IsActive: true,
	}}, server.Client(), EnvironmentModel{})
	feedback, err := llm.Critique(context.Background(), CritiqueRequest{
		Content: json.RawMessage(`{"heading":"실적","bullets":[{"text":"일부 항목","level":0}]}`),
		Title:   "실적", KeyPoints: []string{"Q3 실적", "Q4 계획"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if feedback != "Add the missing key point about Q3 results" {
		t.Fatalf("expected feedback to be passed through, got %q", feedback)
	}
}

func TestOpenAIClientCritiqueIgnoresFeedbackWhenApproved(t *testing.T) {
	// Final whole-branch review: models routinely fill both fields even when
	// approved is true; feedback must be ignored in that case.
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		raw, _ := json.Marshal(map[string]any{"approved": true, "feedback": "minor nit, ignore"})
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]string{"content": string(raw)}}},
		})
	}))
	defer server.Close()

	llm := NewOpenAIClient(staticModelSource{model: Model{
		ID: "model-1", ModelID: "local-model", Endpoint: server.URL, MaxTokens: 2048, IsActive: true,
	}}, server.Client(), EnvironmentModel{})
	feedback, err := llm.Critique(context.Background(), CritiqueRequest{
		Content: json.RawMessage(`{"heading":"h"}`), Title: "h", KeyPoints: []string{"x"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if feedback != "" {
		t.Fatalf("expected empty feedback when approved is true, got %q", feedback)
	}
}

func TestOpenAIClientCritiqueRetriesOnRejectionWithoutFeedback(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		call := calls.Add(1)
		var raw []byte
		if call == 1 {
			raw, _ = json.Marshal(map[string]any{"approved": false})
		} else {
			raw, _ = json.Marshal(map[string]any{"approved": false, "feedback": "Be more specific"})
		}
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]string{"content": string(raw)}}},
		})
	}))
	defer server.Close()

	llm := NewOpenAIClient(staticModelSource{model: Model{
		ID: "model-1", ModelID: "local-model", Endpoint: server.URL, MaxTokens: 2048, IsActive: true,
	}}, server.Client(), EnvironmentModel{})
	feedback, err := llm.Critique(context.Background(), CritiqueRequest{
		Content: json.RawMessage(`{"heading":"h"}`), Title: "h", KeyPoints: []string{"x"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 {
		t.Fatalf("calls = %d, want 2 (retry after a rejection with no feedback)", calls.Load())
	}
	if feedback != "Be more specific" {
		t.Fatalf("expected feedback from the retried response, got %q", feedback)
	}
}

func TestOpenAIClientCritiqueOutlineApprovesWellFormedOutline(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		raw, _ := json.Marshal(map[string]any{"approved": true})
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]string{"content": string(raw)}}},
		})
	}))
	defer server.Close()

	llm := NewOpenAIClient(staticModelSource{model: Model{
		ID: "model-1", ModelID: "local-model", Endpoint: server.URL, MaxTokens: 2048, IsActive: true,
	}}, server.Client(), EnvironmentModel{})
	original := Outline{Title: "Deck", Slides: []OutlineSlide{
		{Order: 1, Title: "Intro", Type: "CONTENT", KeyPoints: []string{"Hello"}},
	}}
	outline, changed, err := llm.CritiqueOutline(context.Background(), original, "")
	if err != nil {
		t.Fatal(err)
	}
	if changed {
		t.Fatal("expected changed = false for an approved outline")
	}
	if outline.Title != original.Title || len(outline.Slides) != len(original.Slides) {
		t.Fatalf("expected the original outline back unchanged, got %+v", outline)
	}
}

func TestOpenAIClientCritiqueOutlineReturnsCorrectedOutlineWhenRejected(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		raw, _ := json.Marshal(map[string]any{
			"approved": false,
			"outline": map[string]any{
				"title": "Deck",
				"slides": []map[string]any{
					{"order": 1, "title": "Intro", "type": "CONTENT", "keyPoints": []string{"Hello"}},
					{"order": 2, "title": "Details", "type": "CONTENT", "keyPoints": []string{"World"}},
				},
			},
		})
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]string{"content": string(raw)}}},
		})
	}))
	defer server.Close()

	llm := NewOpenAIClient(staticModelSource{model: Model{
		ID: "model-1", ModelID: "local-model", Endpoint: server.URL, MaxTokens: 2048, IsActive: true,
	}}, server.Client(), EnvironmentModel{})
	original := Outline{Title: "Deck", Slides: []OutlineSlide{
		{Order: 1, Title: "Intro", Type: "CONTENT", KeyPoints: []string{"Hello"}},
	}}
	outline, changed, err := llm.CritiqueOutline(context.Background(), original, "")
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("expected changed = true for a rejected outline")
	}
	if len(outline.Slides) != 2 || outline.Slides[1].Title != "Details" {
		t.Fatalf("expected the corrected 2-slide outline, got %+v", outline)
	}
}

func TestOpenAIClientCritiqueOutlineCapsCorrectedSlideCount(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		slides := make([]map[string]any, 0, 10)
		for i := 1; i <= 10; i++ {
			slides = append(slides, map[string]any{
				"order": i, "title": fmt.Sprintf("Slide %d", i), "type": "CONTENT", "keyPoints": []string{"Point"},
			})
		}
		raw, _ := json.Marshal(map[string]any{
			"approved": false,
			"outline":  map[string]any{"title": "Deck", "slides": slides},
		})
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]string{"content": string(raw)}}},
		})
	}))
	defer server.Close()

	llm := NewOpenAIClient(staticModelSource{model: Model{
		ID: "model-1", ModelID: "local-model", Endpoint: server.URL, MaxTokens: 2048, IsActive: true,
	}}, server.Client(), EnvironmentModel{})
	// Original outline has only 1 slide; a legitimate correction may grow it by
	// a couple of slides but must not balloon to match the mock's 10 slides.
	original := Outline{Title: "Deck", Slides: []OutlineSlide{
		{Order: 1, Title: "Intro", Type: "CONTENT", KeyPoints: []string{"Hello"}},
	}}
	outline, changed, err := llm.CritiqueOutline(context.Background(), original, "")
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("expected changed = true for a rejected outline")
	}
	if len(outline.Slides) > len(original.Slides)+2 {
		t.Fatalf("expected corrected outline capped at %d slides, got %d", len(original.Slides)+2, len(outline.Slides))
	}
	if len(outline.Slides) >= 10 {
		t.Fatalf("expected corrected outline truncated well below the mock's 10 slides, got %d", len(outline.Slides))
	}
}

func TestOpenAIClientCritiqueOutlineRetriesOnInvalidCorrection(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		call := calls.Add(1)
		var raw []byte
		if call == 1 {
			// Rejected but the "outline" field has no title -- parseOutline will
			// reject this, forcing a retry.
			raw, _ = json.Marshal(map[string]any{"approved": false, "outline": map[string]any{"slides": []any{}}})
		} else {
			raw, _ = json.Marshal(map[string]any{
				"approved": false,
				"outline": map[string]any{
					"title": "Deck",
					"slides": []map[string]any{
						{"order": 1, "title": "Intro", "type": "CONTENT", "keyPoints": []string{"Hello"}},
					},
				},
			})
		}
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]string{"content": string(raw)}}},
		})
	}))
	defer server.Close()

	llm := NewOpenAIClient(staticModelSource{model: Model{
		ID: "model-1", ModelID: "local-model", Endpoint: server.URL, MaxTokens: 2048, IsActive: true,
	}}, server.Client(), EnvironmentModel{})
	original := Outline{Title: "Deck", Slides: []OutlineSlide{
		{Order: 1, Title: "Intro", Type: "CONTENT", KeyPoints: []string{"Hello"}},
	}}
	_, changed, err := llm.CritiqueOutline(context.Background(), original, "")
	if err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 {
		t.Fatalf("calls = %d, want 2 (retry after an invalid correction)", calls.Load())
	}
	if !changed {
		t.Fatal("expected changed = true once the retried response validates")
	}
}
