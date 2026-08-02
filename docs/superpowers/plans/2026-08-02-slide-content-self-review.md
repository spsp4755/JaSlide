# Slide Content Self-Review Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded critique-then-revise-once review step to each generated slide's content, without ever letting a review-step failure fail the whole generation.

**Architecture:** Add one new `Critique` method to the `LLM` interface and `OpenAIClient`, following the exact prompt/`validated()` pattern already used by every other LLM-backed method in `llm.go`. Reuse the existing `Edit` method for the revise half — no new revision machinery. Wire both into `Service.Process`'s per-slide loop.

**Tech Stack:** Go 1.24 (`apps/core-api`). Docker for test execution (no local toolchain).

## Global Constraints

- `Critique` returns an empty string when content is approved, non-empty feedback text otherwise — never a structured "reasons" type, since `Edit` already consumes free text.
- At most one extra LLM call for an approved slide (`Critique`), two for a revised one (`Critique` + `Edit`) — never re-critique the revision, never loop.
- A `Critique` or `Edit` failure must fall back to the original `SlideContent` result silently — it must never call `service.fail` or otherwise stop generation. The existing `SlideContent` failure path (which does call `service.fail`) is unchanged.
- Go tests run via: `docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm go test ./internal/generation/... -v`

---

### Task 1: `Critique` method on `OpenAIClient`

**Files:**
- Modify: `apps/core-api/internal/generation/service.go` (`LLM` interface, new `CritiqueRequest` type)
- Modify: `apps/core-api/internal/generation/llm.go` (new `Critique` method)
- Test: `apps/core-api/internal/generation/llm_test.go`

**Interfaces:**
- Consumes: `client.validated(ctx, system, prompt string, validate func(json.RawMessage) error) error` (existing, `llm.go:144`, unchanged).
- Produces: `type CritiqueRequest struct { Content json.RawMessage; Title string; KeyPoints []string }` and `Critique(ctx context.Context, input CritiqueRequest) (string, error)` on both the `LLM` interface and `OpenAIClient` — Task 2 wires this into `Service.Process` and adds it to two existing test fakes.

- [ ] **Step 1: Write the failing tests**

Add to `apps/core-api/internal/generation/llm_test.go`:

```go
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm go test ./internal/generation/... -run TestOpenAIClientCritique -v`
Expected: FAIL — `CritiqueRequest`/`Critique` don't exist yet (compile error).

- [ ] **Step 3: Add `CritiqueRequest` and extend the `LLM` interface**

In `apps/core-api/internal/generation/service.go`, change:

```go
type LLM interface {
	Outline(context.Context, OutlineRequest) (Outline, error)
	SlideContent(context.Context, SlideRequest) (json.RawMessage, error)
	Edit(context.Context, json.RawMessage, string, string) (json.RawMessage, error)
	SlideHTML(context.Context, string, SlideRequest) (string, error)
	EditHTML(context.Context, string, string) (string, error)
}
```

to:

```go
type LLM interface {
	Outline(context.Context, OutlineRequest) (Outline, error)
	SlideContent(context.Context, SlideRequest) (json.RawMessage, error)
	Critique(context.Context, CritiqueRequest) (string, error)
	Edit(context.Context, json.RawMessage, string, string) (json.RawMessage, error)
	SlideHTML(context.Context, string, SlideRequest) (string, error)
	EditHTML(context.Context, string, string) (string, error)
}
```

Then, immediately after the `SlideRequest` struct definition (`type SlideRequest struct { ... }`), add:

```go
type CritiqueRequest struct {
	Content   json.RawMessage
	Title     string
	KeyPoints []string
}
```

- [ ] **Step 4: Implement `OpenAIClient.Critique`**

In `apps/core-api/internal/generation/llm.go`, add this method directly after `SlideContent` (after its closing `}`):

```go
func (client *OpenAIClient) Critique(ctx context.Context, input CritiqueRequest) (string, error) {
	var feedback string
	prompt := fmt.Sprintf(
		"Review this generated slide JSON against its title and key points. Check: (1) every key point is reflected "+
			"somewhere in the content, (2) bullets are concrete and specific, not generic filler, (3) the heading "+
			"matches what the body/bullets actually say. Title: %s. Key points: %s. Slide JSON: %s. "+
			"Return JSON only: {\"approved\":true} if it's fine, or {\"approved\":false,\"feedback\":\"specific "+
			"instruction to fix it\"} if not.",
		input.Title, strings.Join(input.KeyPoints, "; "), input.Content,
	)
	err := client.validated(ctx, "You are a presentation content reviewer. Return JSON only.", prompt, func(raw json.RawMessage) error {
		var value struct {
			Approved bool   `json:"approved"`
			Feedback string `json:"feedback"`
		}
		if json.Unmarshal(raw, &value) != nil {
			return errors.New("invalid critique response")
		}
		if !value.Approved && strings.TrimSpace(value.Feedback) == "" {
			return errors.New("rejected critique must include feedback")
		}
		if !value.Approved {
			feedback = value.Feedback
		}
		return nil
	})
	return feedback, err
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm go test ./internal/generation/... -v`
Expected: PASS (all tests — this will still fail to compile until Task 2 updates the two existing test-fake structs that implement `LLM`; if you hit that compile error, it confirms `LLM` is a real interface contract and is expected — Task 2 fixes it. If you want a clean PASS for this task alone, temporarily skip the full-package run and use `-run TestOpenAIClientCritique` as in Step 2 to confirm just the new tests, then rely on Task 2 to restore full-suite compilation.)

- [ ] **Step 6: Commit**

```bash
git add apps/core-api/internal/generation/service.go apps/core-api/internal/generation/llm.go apps/core-api/internal/generation/llm_test.go
git commit -m "feat(go-api): add Critique method for slide content self-review"
```

---

### Task 2: Wire the review loop into `Service.Process`

**Files:**
- Modify: `apps/core-api/internal/generation/service.go` (`Process`)
- Modify: `apps/core-api/internal/generation/handlers_test.go` (`maliciousHTMLLLM`, `cancellableLLM` need a `Critique` method to keep implementing `LLM`; new `reviewLLM` fake)
- Test: `apps/core-api/internal/generation/handlers_test.go`

**Interfaces:**
- Consumes: `Critique(ctx context.Context, input CritiqueRequest) (string, error)` and `CritiqueRequest{Content, Title, KeyPoints}` (Task 1).

- [ ] **Step 1: Write the failing tests**

Add to `apps/core-api/internal/generation/handlers_test.go`, near the other fake LLM types (after `maliciousHTMLLLM`'s methods, before `cancellableLLM`'s methods, or anywhere at file scope):

```go
type reviewLLM struct {
	critiqueFeedback string
	critiqueErr      error
	editContent      json.RawMessage
	editErr          error
	critiqueCalls    int
	editCalls        int
}

func (*reviewLLM) Outline(context.Context, OutlineRequest) (Outline, error) {
	return Outline{Title: "Deck", Slides: []OutlineSlide{{
		Order: 1, Title: "Slide", Type: "CONTENT", KeyPoints: []string{"Point"},
	}}}, nil
}

func (*reviewLLM) SlideContent(context.Context, SlideRequest) (json.RawMessage, error) {
	return json.RawMessage(`{"heading":"Slide","bullets":[{"text":"Original"}]}`), nil
}

func (llm *reviewLLM) Critique(context.Context, CritiqueRequest) (string, error) {
	llm.critiqueCalls++
	return llm.critiqueFeedback, llm.critiqueErr
}

func (llm *reviewLLM) Edit(context.Context, json.RawMessage, string, string) (json.RawMessage, error) {
	llm.editCalls++
	return llm.editContent, llm.editErr
}

func (*reviewLLM) SlideHTML(context.Context, string, SlideRequest) (string, error) {
	return "", errors.New("unexpected slide HTML call")
}

func (*reviewLLM) EditHTML(context.Context, string, string) (string, error) {
	return "", errors.New("unexpected edit HTML call")
}

func TestProcessSkipsEditWhenCritiqueApproves(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	presentationID := "presentation-1"
	repo.presentations[presentationID] = Presentation{ID: presentationID, Status: "GENERATING"}
	repo.jobs["job-1"] = Job{
		ID: "job-1", UserID: "user-1", Status: "QUEUED", PresentationID: &presentationID,
		Input: json.RawMessage(`{"sourceType":"TEXT","content":"c","slideCount":1,"language":"en"}`),
	}
	llm := &reviewLLM{critiqueFeedback: ""}
	service := NewService(repo, llm, new(recordingQueue))

	service.Process(context.Background(), "job-1")

	if llm.editCalls != 0 {
		t.Fatalf("edit calls = %d, want 0 when critique approves", llm.editCalls)
	}
	if len(repo.slides) != 1 {
		t.Fatalf("persisted slides = %d, want 1", len(repo.slides))
	}
	heading, _ := rawObject(repo.slides[0].Content)["heading"].(string)
	if heading != "Slide" {
		t.Fatalf("expected original content preserved, got heading %q", heading)
	}
}

func TestProcessAppliesEditWhenCritiqueRequestsChanges(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	presentationID := "presentation-1"
	repo.presentations[presentationID] = Presentation{ID: presentationID, Status: "GENERATING"}
	repo.jobs["job-1"] = Job{
		ID: "job-1", UserID: "user-1", Status: "QUEUED", PresentationID: &presentationID,
		Input: json.RawMessage(`{"sourceType":"TEXT","content":"c","slideCount":1,"language":"en"}`),
	}
	llm := &reviewLLM{
		critiqueFeedback: "Add the missing key point",
		editContent:      json.RawMessage(`{"heading":"Revised","bullets":[{"text":"Fixed"}]}`),
	}
	service := NewService(repo, llm, new(recordingQueue))

	service.Process(context.Background(), "job-1")

	if llm.editCalls != 1 {
		t.Fatalf("edit calls = %d, want 1 when critique requests changes", llm.editCalls)
	}
	if len(repo.slides) != 1 {
		t.Fatalf("persisted slides = %d, want 1", len(repo.slides))
	}
	heading, _ := rawObject(repo.slides[0].Content)["heading"].(string)
	if heading != "Revised" {
		t.Fatalf("expected the Edit result stored, got heading %q", heading)
	}
}

func TestProcessFallsBackToOriginalContentWhenCritiqueFails(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	presentationID := "presentation-1"
	repo.presentations[presentationID] = Presentation{ID: presentationID, Status: "GENERATING"}
	repo.jobs["job-1"] = Job{
		ID: "job-1", UserID: "user-1", Status: "QUEUED", PresentationID: &presentationID,
		Input: json.RawMessage(`{"sourceType":"TEXT","content":"c","slideCount":1,"language":"en"}`),
	}
	llm := &reviewLLM{critiqueErr: errors.New("network error")}
	service := NewService(repo, llm, new(recordingQueue))

	service.Process(context.Background(), "job-1")

	if llm.editCalls != 0 {
		t.Fatalf("edit calls = %d, want 0 when critique fails", llm.editCalls)
	}
	if len(repo.slides) != 1 {
		t.Fatalf("persisted slides = %d, want 1 (generation must not fail on a critique error)", len(repo.slides))
	}
	heading, _ := rawObject(repo.slides[0].Content)["heading"].(string)
	if heading != "Slide" {
		t.Fatalf("expected original content preserved on critique failure, got heading %q", heading)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm go test ./internal/generation/... -run TestProcess -v`
Expected: FAIL to compile — `*reviewLLM` doesn't implement `Critique` being called yet inside `Process` (it exists on the struct but `Process` never calls it, so `editCalls`/`critiqueCalls` stay 0 and the "Revised" test fails); also `maliciousHTMLLLM`/`cancellableLLM` don't implement the `LLM` interface yet (missing `Critique` method — this is a compile error affecting the whole package until Step 3).

- [ ] **Step 3: Add `Critique` to the two existing test fakes**

In `apps/core-api/internal/generation/handlers_test.go`, add directly after `maliciousHTMLLLM`'s `SlideContent` method:

```go
func (*maliciousHTMLLLM) Critique(context.Context, CritiqueRequest) (string, error) {
	return "", nil
}
```

And directly after `cancellableLLM`'s `SlideContent` method:

```go
func (*cancellableLLM) Critique(context.Context, CritiqueRequest) (string, error) {
	return "", errors.New("unexpected critique call")
}
```

(`cancellableLLM`'s `Outline` blocks/cancels before the flow ever reaches `SlideContent` or `Critique`, matching the "unexpected call" pattern its other post-`Outline` methods already use.)

- [ ] **Step 4: Wire the review step into `Process`**

In `apps/core-api/internal/generation/service.go`, change:

```go
		rawContent, contentErr := service.llm.SlideContent(ctx, SlideRequest{
			Title: item.Title, Type: item.Type, Language: input.Language, KeyPoints: item.KeyPoints,
		})
		if contentErr != nil {
			service.fail(ctx, jobID, contentErr)
			return
		}
		fields := rawObject(rawContent)
```

to:

```go
		rawContent, contentErr := service.llm.SlideContent(ctx, SlideRequest{
			Title: item.Title, Type: item.Type, Language: input.Language, KeyPoints: item.KeyPoints,
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm go test ./internal/generation/... -v`
Expected: PASS (all tests, including Task 1's and this task's)

- [ ] **Step 6: Commit**

```bash
git add apps/core-api/internal/generation/service.go apps/core-api/internal/generation/handlers_test.go
git commit -m "feat(go-api): wire critique-then-revise-once into slide generation"
```
