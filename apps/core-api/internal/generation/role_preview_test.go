package generation

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
)

func TestRolePreviewReturnsUnavailableForHTMLTemplate(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	repo.templates["html-template"] = memoryTemplate{
		public: true,
		config: json.RawMessage(`{"htmlSlides":["<div>Slide</div>"],"source":{"kind":"html"}}`),
	}
	service := NewService(repo, &maliciousHTMLLLM{}, new(recordingQueue))

	result, err := service.RolePreview(context.Background(), "html-template", "user-1", []RolePreviewSlideInput{{Type: "content"}})
	if err != nil {
		t.Fatalf("RolePreview() error = %v", err)
	}
	if result.Status != "unavailable" {
		t.Fatalf("Status = %q, want unavailable", result.Status)
	}
}

func TestRolePreviewTriggersBackgroundClassificationAndReturnsPendingImmediately(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	repo.templates["pptx-template"] = memoryTemplate{
		public: true,
		config: json.RawMessage(`{"source":{"kind":"pptx","slides":[{"objects":[` +
			`{"id":"shape-1","kind":"text","fontSize":32,"text":"Heading"}` +
			`]}]}}`),
	}
	done := make(chan struct{})
	llm := &classifyingLLM{maliciousHTMLLLM: &maliciousHTMLLLM{}, roles: map[string]string{"shape-1": "title"}, done: done}
	service := NewService(repo, llm, new(recordingQueue))

	result, err := service.RolePreview(context.Background(), "pptx-template", "user-1", []RolePreviewSlideInput{{Type: "content"}})
	if err != nil {
		t.Fatalf("RolePreview() error = %v", err)
	}
	if result.Status != "pending" {
		t.Fatalf("Status = %q, want pending", result.Status)
	}

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("background classification never ran")
	}

	var fields map[string]any
	_ = json.Unmarshal(repo.templates["pptx-template"].config, &fields)
	source, _ := fields["source"].(map[string]any)
	if needsRoleClassification(source) {
		t.Fatal("template config was not updated with the classification result")
	}
}

func TestRolePreviewDoesNotStartASecondClassificationWhileOneIsInFlight(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	repo.templates["pptx-template"] = memoryTemplate{
		public: true,
		config: json.RawMessage(`{"source":{"kind":"pptx","slides":[{"objects":[` +
			`{"id":"shape-1","kind":"text","fontSize":32,"text":"Heading"}` +
			`]}]}}`),
	}
	release := make(chan struct{})
	done := make(chan struct{})
	llm := &classifyingLLM{
		maliciousHTMLLLM: &maliciousHTMLLLM{}, roles: map[string]string{"shape-1": "title"},
		release: release, done: done,
	}
	service := NewService(repo, llm, new(recordingQueue))

	if _, err := service.RolePreview(context.Background(), "pptx-template", "user-1", nil); err != nil {
		t.Fatalf("first RolePreview() error = %v", err)
	}
	if _, err := service.RolePreview(context.Background(), "pptx-template", "user-1", nil); err != nil {
		t.Fatalf("second RolePreview() error = %v", err)
	}
	close(release)
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("background classification never completed")
	}
	if llm.classifyCalls != 1 {
		t.Fatalf("classifyCalls = %d, want 1 (second RolePreview must not start a duplicate classification)", llm.classifyCalls)
	}
}

func TestRolePreviewReturnsReadyItemsResolvedByChooseTemplateIndex(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	repo.templates["pptx-template"] = memoryTemplate{
		public: true,
		config: json.RawMessage(`{"source":{"kind":"pptx","slides":[` +
			`{"objects":[{"id":"shape-0","kind":"text","role":"title"}]},` +
			`{"objects":[{"id":"shape-1","kind":"text","role":"body"},` +
			`{"id":"shape-2","kind":"text","role":"static","locked":true},` +
			`{"id":"no-role-shape","kind":"image"}]}` +
			`]}}`),
	}
	service := NewService(repo, &classifyingLLM{maliciousHTMLLLM: &maliciousHTMLLLM{}}, new(recordingQueue))
	requestedIndex := 1

	result, err := service.RolePreview(context.Background(), "pptx-template", "user-1", []RolePreviewSlideInput{
		{Type: "content"},
		{Type: "content", TemplateIndex: &requestedIndex},
	})
	if err != nil {
		t.Fatalf("RolePreview() error = %v", err)
	}
	if result.Status != "ready" {
		t.Fatalf("Status = %q, want ready", result.Status)
	}
	if len(result.Slides) != 2 {
		t.Fatalf("Slides = %d, want 2", len(result.Slides))
	}
	if len(result.Slides[0].Items) != 1 || result.Slides[0].Items[0].ObjectID != "shape-0" {
		t.Fatalf("Slides[0].Items = %v, want exactly shape-0 (chooseTemplateIndex(nil, 0, capable) picks index 0)", result.Slides[0].Items)
	}
	byID := map[string]RolePreviewItem{}
	for _, item := range result.Slides[1].Items {
		byID[item.ObjectID] = item
	}
	if len(byID) != 2 {
		t.Fatalf("Slides[1].Items = %v, want exactly 2 (no-role-shape excluded, it was never classified)", result.Slides[1].Items)
	}
	if byID["shape-1"].Role != "body" || byID["shape-1"].Locked {
		t.Fatalf("shape-1 = %+v, want role=body locked=false", byID["shape-1"])
	}
	if byID["shape-2"].Role != "static" || !byID["shape-2"].Locked {
		t.Fatalf("shape-2 = %+v, want role=static locked=true", byID["shape-2"])
	}
}
