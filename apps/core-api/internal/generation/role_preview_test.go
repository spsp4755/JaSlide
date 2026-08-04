package generation

import (
	"context"
	"encoding/json"
	"errors"
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
	llm := &classifyingLLM{maliciousHTMLLLM: &maliciousHTMLLLM{}, roles: map[string]string{"shape-1": "title"}}
	service := NewService(repo, llm, new(recordingQueue))

	result, err := service.RolePreview(context.Background(), "pptx-template", "user-1", []RolePreviewSlideInput{{Type: "content"}})
	if err != nil {
		t.Fatalf("RolePreview() error = %v", err)
	}
	if result.Status != "pending" {
		t.Fatalf("Status = %q, want pending", result.Status)
	}

	// Poll service.classifying instead of an llm-level done channel: the
	// in-flight flag only clears (classifyInBackground's deferred Delete)
	// after service.template(..., classify=true) fully returns, which is
	// after the classification result is persisted -- an llm-level done
	// channel closes earlier, before that persistence write, and would
	// race with the read below.
	deadline := time.Now().Add(2 * time.Second)
	for {
		if _, inFlight := service.classifying.Load("pptx-template"); !inFlight {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("background classification never finished (in-flight flag never cleared)")
		}
		time.Sleep(10 * time.Millisecond)
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

func TestLockObjectSetsLockedAndPreservesOriginalRole(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	repo.templates["pptx-template"] = memoryTemplate{
		public: true, userID: "user-1",
		config: json.RawMessage(`{"source":{"kind":"pptx","slides":[{"objects":[` +
			`{"id":"shape-1","kind":"text","role":"subtitle"}` +
			`]}]}}`),
	}
	service := NewService(repo, &maliciousHTMLLLM{}, new(recordingQueue))

	item, err := service.LockObject(context.Background(), "pptx-template", "user-1", false, "shape-1", true)
	if err != nil {
		t.Fatalf("LockObject() error = %v", err)
	}
	if item.Role != "static" || !item.Locked {
		t.Fatalf("LockObject() = %+v, want role=static locked=true", item)
	}

	var fields map[string]any
	_ = json.Unmarshal(repo.templates["pptx-template"].config, &fields)
	source, _ := fields["source"].(map[string]any)
	slides, _ := source["slides"].([]any)
	slide, _ := slides[0].(map[string]any)
	objects, _ := slide["objects"].([]any)
	object, _ := objects[0].(map[string]any)
	if locked, _ := object["locked"].(bool); !locked {
		t.Fatal("locked was not persisted to the template config")
	}
	if object["role"] != "subtitle" {
		t.Fatalf("role = %v, want subtitle preserved (locking must not overwrite the classified role)", object["role"])
	}
}

func TestLockObjectUnlockRevertsToOriginalClassifiedRole(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	repo.templates["pptx-template"] = memoryTemplate{
		public: true, userID: "user-1",
		config: json.RawMessage(`{"source":{"kind":"pptx","slides":[{"objects":[` +
			`{"id":"shape-1","kind":"text","role":"subtitle","locked":true}` +
			`]}]}}`),
	}
	service := NewService(repo, &maliciousHTMLLLM{}, new(recordingQueue))

	item, err := service.LockObject(context.Background(), "pptx-template", "user-1", false, "shape-1", false)
	if err != nil {
		t.Fatalf("LockObject() error = %v", err)
	}
	if item.Role != "subtitle" || item.Locked {
		t.Fatalf("LockObject() = %+v, want role=subtitle locked=false", item)
	}
}

func TestLockObjectReturnsBadInputForUnknownObjectID(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	repo.templates["pptx-template"] = memoryTemplate{
		public: true, userID: "user-1",
		config: json.RawMessage(`{"source":{"kind":"pptx","slides":[{"objects":[{"id":"shape-1","kind":"text","role":"body"}]}]}}`),
	}
	service := NewService(repo, &maliciousHTMLLLM{}, new(recordingQueue))

	if _, err := service.LockObject(context.Background(), "pptx-template", "user-1", false, "does-not-exist", true); !errors.Is(err, ErrBadInput) {
		t.Fatalf("LockObject() error = %v, want ErrBadInput", err)
	}
}

func TestLockObjectRejectsNonOwnerNonAdminOnSomeoneElsesTemplate(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["stranger"] = db.User{ID: "stranger"}
	repo.templates["pptx-template"] = memoryTemplate{
		public: true, userID: "owner",
		config: json.RawMessage(`{"source":{"kind":"pptx","slides":[{"objects":[{"id":"shape-1","kind":"text","role":"body"}]}]}}`),
	}
	service := NewService(repo, &maliciousHTMLLLM{}, new(recordingQueue))

	if _, err := service.LockObject(context.Background(), "pptx-template", "stranger", false, "shape-1", true); !errors.Is(err, ErrBadInput) {
		t.Fatalf("LockObject() error = %v, want ErrBadInput (a non-owner, non-admin viewer of a public template must not be able to lock its shapes)", err)
	}
}

func TestLockObjectAllowsAdminToLockSomeoneElsesTemplate(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["admin-1"] = db.User{ID: "admin-1"}
	repo.templates["pptx-template"] = memoryTemplate{
		public: true, userID: "owner",
		config: json.RawMessage(`{"source":{"kind":"pptx","slides":[{"objects":[{"id":"shape-1","kind":"text","role":"body"}]}]}}`),
	}
	service := NewService(repo, &maliciousHTMLLLM{}, new(recordingQueue))

	item, err := service.LockObject(context.Background(), "pptx-template", "admin-1", true, "shape-1", true)
	if err != nil {
		t.Fatalf("LockObject() error = %v, want nil (an admin must be able to lock any template's shapes)", err)
	}
	if item.Role != "static" || !item.Locked {
		t.Fatalf("LockObject() = %+v, want role=static locked=true", item)
	}
}
