package renderer

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

func TestFixtureImportsAndExports(t *testing.T) {
	baseURL := os.Getenv("JASLIDE_RENDERER_URL")
	pptxPath := os.Getenv("JASLIDE_PPTX_FIXTURE")
	zipPath := os.Getenv("JASLIDE_ZIP_FIXTURE")
	if baseURL == "" || pptxPath == "" || zipPath == "" {
		t.Skip("renderer integration fixtures are not configured")
	}
	client := New(baseURL, &http.Client{Timeout: 3 * time.Minute})
	pptx, err := os.ReadFile(pptxPath)
	if err != nil {
		t.Fatal(err)
	}
	archive, err := os.ReadFile(zipPath)
	if err != nil {
		t.Fatal(err)
	}

	var pptxResult, zipResult struct {
		Config map[string]any `json:"config"`
	}
	if err := client.PostFile(context.Background(), "/api/extract/style", "fixture.pptx", PPTXContentType, pptx, &pptxResult); err != nil {
		t.Fatal(err)
	}
	if err := client.PostFile(context.Background(), "/api/extract/html-template", "fixture.zip", "application/zip", archive, &zipResult); err != nil {
		t.Fatal(err)
	}
	if len(stringList(pptxResult.Config["htmlSlides"])) == 0 || pptxResult.Config["archive"] == nil {
		t.Fatal("PPTX extraction did not preserve editable slide structure")
	}
	htmlSlides := stringList(zipResult.Config["htmlSlides"])
	if len(htmlSlides) == 0 || zipResult.Config["archive"] == nil {
		t.Fatal("HTML ZIP extraction did not preserve slide structure")
	}

	payload := map[string]any{"presentation": map[string]any{
		"id": "fixture", "title": "fixture",
		"slides": []map[string]any{{
			"id": "slide-1", "order": 1, "type": "CONTENT", "layout": "center",
			"content": map[string]any{"html": htmlSlides[0]},
		}},
	}}
	assertStreamPrefix(t, client, "/api/render/pptx", payload, "PK")
	assertStreamPrefix(t, client, "/api/render/pdf", payload, "%PDF")
}

func assertStreamPrefix(t *testing.T, client *Client, path string, payload any, prefix string) {
	t.Helper()
	stream, err := client.StreamJSON(context.Background(), path, payload)
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Body.Close()
	data, err := io.ReadAll(io.LimitReader(stream.Body, 8))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(data), prefix) {
		raw, _ := json.Marshal(data)
		t.Fatalf("%s returned invalid stream prefix: %s", path, raw)
	}
}

func stringList(value any) []string {
	raw, _ := value.([]any)
	result := make([]string, 0, len(raw))
	for _, item := range raw {
		if text, ok := item.(string); ok {
			result = append(result, text)
		}
	}
	return result
}
