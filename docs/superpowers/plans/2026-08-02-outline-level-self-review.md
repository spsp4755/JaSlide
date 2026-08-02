# Outline-Level Self-Review Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single review step, run once per generation, that critiques the whole LLM-generated outline (slide order/flow, duplication/coverage, count/distribution) and — if it finds a problem — replaces it with a corrected outline returned in the same LLM call, before per-slide content generation begins.

**Architecture:** Add `CritiqueOutline(ctx, Outline) (Outline, bool, error)` to the `LLM` interface and its `OpenAIClient` implementation in `apps/core-api/internal/generation/llm.go`, following the exact shape of the existing `Critique` method (build a prompt, call `client.validated`, parse the response). Wire it into `Service.Process` (`apps/core-api/internal/generation/service.go`) immediately after the LLM successfully generates an outline, inside the branch that already guards LLM-generated outlines — so caller-supplied outlines are structurally unreachable, not just skipped by a runtime check.

**Tech Stack:** Go 1.24, tested via Docker (`golang:1.24.12-bookworm`) since no local Go toolchain is available.

## Global Constraints

- This review step applies ONLY when the outline came from `service.llm.Outline(...)` — never when the caller supplied `input.Outline` directly (that branch never calls `Outline()` at all, so `CritiqueOutline` must not be called there either).
- Exactly one extra LLM call per generation (not per slide) when approved, and still exactly one call when a correction is returned — the corrected outline comes back in the same response as the critique, no second call.
- A `CritiqueOutline` error must never fail generation — always fall back to the original outline.
- Never re-critique a corrected outline.
- The per-slide content self-review (`Critique`/`Edit`, already merged at commit `3b947da`) is untouched by this plan — do not modify `service.llm.Critique`, `service.llm.Edit`, or their call sites in `Process`'s per-slide loop.
- The critique prompt must cover exactly these three checks: (1) slide order/flow, (2) duplication/coverage against the source content, (3) slide count/content distribution balance.

---

### Task 1: Add `CritiqueOutline` to the `LLM` interface and `OpenAIClient`

**Files:**
- Modify: `apps/core-api/internal/generation/service.go:121-128` (the `LLM` interface)
- Modify: `apps/core-api/internal/generation/llm.go` (add the `OpenAIClient.CritiqueOutline` method near the existing `Critique` method at line 92)
- Test: `apps/core-api/internal/generation/llm_test.go`

**Interfaces:**
- Consumes: `Outline` (`service.go:69`, `{Title string; Slides []OutlineSlide}`), `OutlineSlide` (`service.go:61`, `{Order int; Title string; Type string; KeyPoints []string; TemplateIndex *int}`), `parseOutline(raw json.RawMessage, count, templateCount int) (Outline, error)` (`llm.go:312`, existing — do not modify), `client.validated(ctx, system, prompt string, validate func(json.RawMessage) error) error` (`llm.go:173`, existing — do not modify).
- Produces: `LLM.CritiqueOutline(context.Context, Outline) (Outline, bool, error)` — later tasks and the fakes in `handlers_test.go` implement/consume this exact signature. Returns `(originalOrCorrectedOutline, changed bool, error)`. `changed` is `true` only when the model returned a correction; `error` is non-nil only when the call could not be completed (network error, or a malformed response that exhausted `validated`'s retries).

- [ ] **Step 1: Write the failing unit tests**

Add to `apps/core-api/internal/generation/llm_test.go` (place after the existing `TestOpenAIClientCritiqueRetriesOnRejectionWithoutFeedback` test, so it sits next to the sibling `Critique` tests):

```go
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
	outline, changed, err := llm.CritiqueOutline(context.Background(), original)
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
	outline, changed, err := llm.CritiqueOutline(context.Background(), original)
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
	_, changed, err := llm.CritiqueOutline(context.Background(), original)
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
```

Confirm `sync/atomic`'s `atomic` package and `net/http/httptest` are already imported in `llm_test.go` (they are — used by the existing `TestOpenAIClientCritiqueRetriesOnRejectionWithoutFeedback` test).

- [ ] **Step 2: Run the tests to verify they fail**

Run (from repo root):
```bash
docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm \
  go test ./internal/generation/... -run TestOpenAIClientCritiqueOutline -v
```
Expected: FAIL with `llm.CritiqueOutline undefined (type *OpenAIClient has no field or method CritiqueOutline)`.

- [ ] **Step 3: Add `CritiqueOutline` to the `LLM` interface**

In `apps/core-api/internal/generation/service.go`, change the `LLM` interface (currently lines 121-128):

```go
type LLM interface {
	Outline(context.Context, OutlineRequest) (Outline, error)
	SlideContent(context.Context, SlideRequest) (json.RawMessage, error)
	Critique(context.Context, CritiqueRequest) (string, error)
	CritiqueOutline(context.Context, Outline) (Outline, bool, error)
	Edit(context.Context, json.RawMessage, string, string) (json.RawMessage, error)
	SlideHTML(context.Context, string, SlideRequest) (string, error)
	EditHTML(context.Context, string, string) (string, error)
}
```

- [ ] **Step 4: Implement `OpenAIClient.CritiqueOutline`**

In `apps/core-api/internal/generation/llm.go`, add this method directly after the existing `Critique` method (which ends at line 118, just before `func (client *OpenAIClient) Edit`):

```go
func (client *OpenAIClient) CritiqueOutline(ctx context.Context, outline Outline) (Outline, bool, error) {
	titles := make([]string, 0, len(outline.Slides))
	for _, slide := range outline.Slides {
		titles = append(titles, fmt.Sprintf("%d. %s (points: %s)", slide.Order, slide.Title, strings.Join(slide.KeyPoints, "; ")))
	}
	raw, err := json.Marshal(outline)
	if err != nil {
		return outline, false, err
	}
	prompt := fmt.Sprintf(
		"Review this presentation outline as a whole. Check: (1) slide order and flow -- does the deck progress "+
			"logically with no jarring jumps, (2) duplication and coverage -- do any two slides overlap, and are "+
			"the source topics covered without gaps, (3) slide count and distribution -- is any single slide "+
			"overloaded or starved relative to the others. Outline JSON: %s. Slide summary: %s. "+
			"Return JSON only: {\"approved\":true} if it's fine, or {\"approved\":false,\"outline\":{...corrected "+
			"outline, same JSON shape as the input}} if not.",
		raw, strings.Join(titles, " | "),
	)
	var result Outline
	changed := false
	err = client.validated(ctx, "You are a presentation outline reviewer. Return JSON only.", prompt, func(raw json.RawMessage) error {
		var value struct {
			Approved bool            `json:"approved"`
			Outline  json.RawMessage `json:"outline"`
		}
		if json.Unmarshal(raw, &value) != nil {
			return errors.New("invalid outline critique response")
		}
		if !value.Approved {
			if len(value.Outline) == 0 {
				return errors.New("rejected outline critique must include a corrected outline")
			}
			// 30 mirrors validateOutline's slide-count ceiling (service.go:820) --
			// not len(outline.Slides), since a legitimate correction may merge or
			// split slides and change the count.
			corrected, parseErr := parseOutline(value.Outline, 30, 0)
			if parseErr != nil {
				return parseErr
			}
			result = corrected
			changed = true
		}
		return nil
	})
	if err != nil {
		return outline, false, err
	}
	if !changed {
		return outline, false, nil
	}
	return result, true, nil
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:
```bash
docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm \
  go test ./internal/generation/... -run TestOpenAIClientCritiqueOutline -v
```
Expected: PASS (3/3 tests).

Also run the full package to confirm nothing else broke (adding a method to the `LLM` interface requires every implementer to have it — this step surfaces any implementer this task missed):
```bash
docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm \
  go build ./internal/generation/...
```
Expected: build error listing every type that implements `LLM` but lacks `CritiqueOutline` (this is expected here — Task 2 adds it to those fakes; note which types the compiler names so Task 2's implementer knows the exact list).

- [ ] **Step 6: Commit**

```bash
git add apps/core-api/internal/generation/service.go apps/core-api/internal/generation/llm.go apps/core-api/internal/generation/llm_test.go
git commit -m "feat(go-api): add CritiqueOutline method for outline-level self-review"
git push origin feature/outline-level-self-review
```

---

### Task 2: Wire `CritiqueOutline` into `Service.Process`

**Files:**
- Modify: `apps/core-api/internal/generation/service.go:336-352` (the LLM-outline branch inside `Process`)
- Modify: `apps/core-api/internal/generation/handlers_test.go` (add `CritiqueOutline` to `maliciousHTMLLLM`, `cancellableLLM`, `reviewLLM`; add new wiring tests)

**Interfaces:**
- Consumes: `LLM.CritiqueOutline(context.Context, Outline) (Outline, bool, error)` from Task 1.
- Produces: nothing new consumed by later tasks — this is the final task in the plan.

- [ ] **Step 1: Write the failing wiring tests**

In `apps/core-api/internal/generation/handlers_test.go`, first add `CritiqueOutline` to the three existing fakes so the package keeps compiling (each returns the input outline unchanged, `changed=false`, no error — matching how these fakes already treat the per-slide `Critique` as a no-op):

Directly after the existing `func (*maliciousHTMLLLM) Critique(...)` method (around line 206-208):
```go
func (*maliciousHTMLLLM) CritiqueOutline(_ context.Context, outline Outline) (Outline, bool, error) {
	return outline, false, nil
}
```

Directly after the existing `func (*cancellableLLM) Critique(...)` method (around line 238-240):
```go
func (*cancellableLLM) CritiqueOutline(context.Context, Outline) (Outline, bool, error) {
	return Outline{}, false, errors.New("unexpected critique outline call")
}
```

In the `reviewLLM` fake (currently lines 254-289), add fields for configuring outline-critique behavior and a method, then extend the struct definition:

```go
type reviewLLM struct {
	critiqueFeedback string
	critiqueErr      error
	editContent      json.RawMessage
	editErr          error
	critiqueCalls    int
	editCalls        int

	critiqueOutline      Outline
	critiqueOutlineErr   error
	critiqueOutlineCalls int
}
```

Directly after the existing `func (*reviewLLM) Outline(...)` method (around line 263-267):
```go
func (llm *reviewLLM) CritiqueOutline(_ context.Context, outline Outline) (Outline, bool, error) {
	llm.critiqueOutlineCalls++
	if llm.critiqueOutlineErr != nil {
		return Outline{}, false, llm.critiqueOutlineErr
	}
	if len(llm.critiqueOutline.Slides) == 0 {
		return outline, false, nil
	}
	return llm.critiqueOutline, true, nil
}
```

(`reviewLLM.critiqueOutline` defaults to a zero-value `Outline{}` with no slides -- leaving it unset means "approve unchanged," matching the zero-value convention `reviewLLM` already uses for `critiqueFeedback: ""`.)

Now add the wiring tests. Place these after the existing `TestProcessSkipsEditWhenCritiqueApproves` and its sibling tests (search for the last `func TestProcess...` in the file and add after it):

```go
func TestProcessUsesOriginalOutlineWhenCritiqueOutlineApproves(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	presentationID := "presentation-1"
	repo.presentations[presentationID] = Presentation{ID: presentationID, Status: "GENERATING"}
	repo.jobs["job-1"] = Job{
		ID: "job-1", UserID: "user-1", Status: "QUEUED", PresentationID: &presentationID,
		Input: json.RawMessage(`{"sourceType":"TEXT","content":"c","slideCount":1,"language":"en"}`),
	}
	llm := &reviewLLM{}
	service := NewService(repo, llm, new(recordingQueue))

	service.Process(context.Background(), "job-1")

	if llm.critiqueOutlineCalls != 1 {
		t.Fatalf("critique outline calls = %d, want 1", llm.critiqueOutlineCalls)
	}
	if len(repo.slides) != 1 {
		t.Fatalf("persisted slides = %d, want 1", len(repo.slides))
	}
	title := repo.slides[0].Title
	if title == nil || *title != "Slide" {
		t.Fatalf("expected the original outline's slide title, got %v", title)
	}
}

func TestProcessUsesCorrectedOutlineWhenCritiqueOutlineRejects(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	presentationID := "presentation-1"
	repo.presentations[presentationID] = Presentation{ID: presentationID, Status: "GENERATING"}
	repo.jobs["job-1"] = Job{
		ID: "job-1", UserID: "user-1", Status: "QUEUED", PresentationID: &presentationID,
		Input: json.RawMessage(`{"sourceType":"TEXT","content":"c","slideCount":2,"language":"en"}`),
	}
	llm := &reviewLLM{critiqueOutline: Outline{Title: "Deck", Slides: []OutlineSlide{
		{Order: 1, Title: "Corrected One", Type: "CONTENT", KeyPoints: []string{"A"}},
		{Order: 2, Title: "Corrected Two", Type: "CONTENT", KeyPoints: []string{"B"}},
	}}}
	service := NewService(repo, llm, new(recordingQueue))

	service.Process(context.Background(), "job-1")

	if len(repo.slides) != 2 {
		t.Fatalf("persisted slides = %d, want 2 (the corrected outline)", len(repo.slides))
	}
	first := repo.slides[0].Title
	if first == nil || *first != "Corrected One" {
		t.Fatalf("expected the corrected outline's first slide title, got %v", first)
	}
}

func TestProcessFallsBackToOriginalOutlineWhenCritiqueOutlineFails(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	presentationID := "presentation-1"
	repo.presentations[presentationID] = Presentation{ID: presentationID, Status: "GENERATING"}
	repo.jobs["job-1"] = Job{
		ID: "job-1", UserID: "user-1", Status: "QUEUED", PresentationID: &presentationID,
		Input: json.RawMessage(`{"sourceType":"TEXT","content":"c","slideCount":1,"language":"en"}`),
	}
	llm := &reviewLLM{critiqueOutlineErr: errors.New("outline critique unavailable")}
	service := NewService(repo, llm, new(recordingQueue))

	service.Process(context.Background(), "job-1")

	if len(repo.slides) != 1 {
		t.Fatalf("persisted slides = %d, want 1 (fallback to the original outline)", len(repo.slides))
	}
	title := repo.slides[0].Title
	if title == nil || *title != "Slide" {
		t.Fatalf("expected the original outline's slide title after a critique failure, got %v", title)
	}
}

func TestProcessSkipsCritiqueOutlineForCallerSuppliedOutline(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	presentationID := "presentation-1"
	repo.presentations[presentationID] = Presentation{ID: presentationID, Status: "GENERATING"}
	repo.jobs["job-1"] = Job{
		ID: "job-1", UserID: "user-1", Status: "QUEUED", PresentationID: &presentationID,
		Input: json.RawMessage(`{"sourceType":"TEXT","content":"c","language":"en","outline":{"title":"Deck","slides":[{"order":1,"title":"Given","type":"CONTENT","keyPoints":["P"]}]}}`),
	}
	llm := &reviewLLM{}
	service := NewService(repo, llm, new(recordingQueue))

	service.Process(context.Background(), "job-1")

	if llm.critiqueOutlineCalls != 0 {
		t.Fatalf("critique outline calls = %d, want 0 for a caller-supplied outline", llm.critiqueOutlineCalls)
	}
	if len(repo.slides) != 1 {
		t.Fatalf("persisted slides = %d, want 1", len(repo.slides))
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm \
  go build ./internal/generation/...
```
Expected: build error — `*maliciousHTMLLLM`, `*cancellableLLM`, and `*reviewLLM` no longer satisfy `LLM` until Step 3's fakes compile; once they compile, running:
```bash
docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm \
  go test ./internal/generation/... -run TestProcess.*CritiqueOutline -v
```
should FAIL with the new tests failing on assertions (e.g. `critique outline calls = 0, want 1`) because `Process` doesn't call `CritiqueOutline` yet.

- [ ] **Step 3: Wire `CritiqueOutline` into `Process`**

In `apps/core-api/internal/generation/service.go`, change this block (currently lines 335-352):

```go
	var outline Outline
	if input.Outline != nil {
		outline = *input.Outline
	} else {
		catalog, catalogErr := service.templateCatalog(ctx, input.TemplateID, job.UserID)
		if catalogErr != nil {
			service.fail(ctx, jobID, catalogErr)
			return
		}
		outline, err = service.llm.Outline(ctx, OutlineRequest{
			Content: content, Language: input.Language, SlideCount: input.SlideCount,
			TemplateSlides: catalog,
		})
		if err != nil {
			service.fail(ctx, jobID, err)
			return
		}
	}
```

to:

```go
	var outline Outline
	if input.Outline != nil {
		outline = *input.Outline
	} else {
		catalog, catalogErr := service.templateCatalog(ctx, input.TemplateID, job.UserID)
		if catalogErr != nil {
			service.fail(ctx, jobID, catalogErr)
			return
		}
		outline, err = service.llm.Outline(ctx, OutlineRequest{
			Content: content, Language: input.Language, SlideCount: input.SlideCount,
			TemplateSlides: catalog,
		})
		if err != nil {
			service.fail(ctx, jobID, err)
			return
		}
		if revised, changed, critiqueErr := service.llm.CritiqueOutline(ctx, outline); critiqueErr == nil && changed {
			outline = revised
		}
	}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm \
  go test ./internal/generation/... -run TestProcess -v
```
Expected: PASS for all `TestProcess*` tests, including the 4 new ones.

Then run the full package suite to confirm nothing regressed:
```bash
docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm \
  go test ./internal/generation/... -v
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/core-api/internal/generation/service.go apps/core-api/internal/generation/handlers_test.go
git commit -m "feat(go-api): wire outline-level critique into Process before per-slide generation"
git push origin feature/outline-level-self-review
```

---

## Post-Plan Verification (for the final whole-branch reviewer / controller)

After both tasks are complete, re-run the full Go suite once more from a clean state to confirm the merged branch is healthy:

```bash
docker run --rm -v "$(pwd)/apps/core-api:/src" -w /src golang:1.24.12-bookworm \
  go test ./internal/generation/... -v
```

There is no renderer (Python) change in this plan — this sub-project touches only `apps/core-api/internal/generation`.
