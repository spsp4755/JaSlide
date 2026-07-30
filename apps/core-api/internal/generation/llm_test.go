package generation

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

type staticModelSource struct{ model Model }

func (source staticModelSource) DefaultModel(context.Context) (Model, error) {
	return source.model, nil
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
