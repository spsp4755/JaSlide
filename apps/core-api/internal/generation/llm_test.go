package generation

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

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
