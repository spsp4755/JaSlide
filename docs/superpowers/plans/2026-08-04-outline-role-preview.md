# 아웃라인 역할 미리보기 및 고정(static) 강제 기능 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 아웃라인 검토 화면에서 템플릿의 각 도형이 채워질지/고정될지 텍스트 목록으로 보여주고, 사용자가 특정 도형을 영구적으로 "고정(static)"으로 강제할 수 있게 한다.

**Architecture:** 새 도형 필드 `locked bool`을 템플릿 config에 추가하고, `effectiveRole()` 헬퍼로 기존 역할 배정 로직 전체를 관통시킨다. 아웃라인 생성 직후 프론트가 새 `POST /generation/templates/{id}/role-preview`를 폴링해 분류를 트리거하고 결과를 받으며, `PATCH /generation/templates/{id}/objects/{objectId}/lock`으로 사용자가 특정 도형을 고정/해제한다.

**Tech Stack:** Go (chi router), React/TypeScript (Vite), node --test (프론트 정적 검증 테스트).

## Global Constraints

- `locked: true`는 `role` 값과 무관하게 무조건 `static` 취급하되, 원래 `role` 값 자체는 덮어쓰지 않고 보존한다(고정 해제 시 복귀).
- `needsRoleClassification`은 `locked`와 무관하게 기존 그대로 role 필드 존재 여부만 확인한다 — 변경 금지.
- 분류(LLM 호출)는 절대 동기 HTTP 응답을 막으면 안 된다 — role-preview 엔드포인트는 미분류 템플릿에 대해 백그라운드 고루틴으로 분류를 트리거하고 즉시 `pending`으로 응답한다.
- role-preview 요청/응답의 슬라이드는 배열 위치로 대응한다 — `order` 필드로 매칭하지 않는다(아웃라인은 승인 전 재정렬 가능하고 `order`는 승인 시점에만 재번호가 매겨짐).
- 이 기능의 실패(분류 실패, 타임아웃)는 생성 자체를 막지 않는다 — 기존 폰트순위 폴백은 그대로 살아있다.
- 범위 밖: static 외 다른 역할로 재지정, 슬라이드 위 시각적 오버레이, 실제 생성될 본문/KPI 텍스트 미리보기, HTML 템플릿 지원.

---

### Task 1: `effectiveRole` 헬퍼와 기존 역할 읽기 지점 교체

**Files:**
- Modify: `apps/core-api/internal/generation/roles.go` (`requestedGenerativeRoles` L14-31, `anyObjectHasRole` L59-66, `rolePptxObjectEdits` L74-111)
- Test: `apps/core-api/internal/generation/roles_test.go`

**Interfaces:**
- Produces: `func effectiveRole(object map[string]any) string` — 이후 모든 태스크가 도형의 역할을 읽을 때 이 함수를 사용한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/core-api/internal/generation/roles_test.go` 파일 맨 위, 기존 `import` 블록 바로 아래에 추가:

```go
func TestEffectiveRoleReturnsStaticWhenLockedRegardlessOfRole(t *testing.T) {
	object := map[string]any{"id": "shape-1", "kind": "text", "role": "subtitle", "locked": true}
	if got := effectiveRole(object); got != "static" {
		t.Fatalf("effectiveRole() = %q, want static", got)
	}
}

func TestEffectiveRoleReturnsUnderlyingRoleWhenNotLocked(t *testing.T) {
	object := map[string]any{"id": "shape-1", "kind": "text", "role": "subtitle", "locked": false}
	if got := effectiveRole(object); got != "subtitle" {
		t.Fatalf("effectiveRole() = %q, want subtitle", got)
	}
}

func TestEffectiveRoleReturnsEmptyWhenNeverClassified(t *testing.T) {
	object := map[string]any{"id": "shape-1", "kind": "text"}
	if got := effectiveRole(object); got != "" {
		t.Fatalf("effectiveRole() = %q, want empty", got)
	}
}

func TestPptxObjectEditsExcludesLockedObjectsEvenWithAGenerativeRole(t *testing.T) {
	objects := []map[string]any{
		{"id": "title-shape", "kind": "text", "role": "title"},
		{"id": "locked-subtitle", "kind": "text", "role": "subtitle", "locked": true, "text": "AI 엔지니어링 파트"},
	}
	content := roleContent{Title: "Q3 Results", Subtitle: "New Subtitle That Must Not Appear"}

	edits := pptxObjectEdits(objects, 0, content)

	for _, edit := range edits {
		if edit["objectId"] == "locked-subtitle" {
			t.Fatalf("edits = %v, want locked-subtitle excluded (locked forces static regardless of role)", edits)
		}
	}
}
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/core-api && go test ./internal/generation/... -run TestEffectiveRole -v`
Expected: FAIL — `effectiveRole` 함수가 아직 없어서 컴파일 에러 (`undefined: effectiveRole`)

- [ ] **Step 3: 헬퍼 구현 및 기존 읽기 지점 교체**

`apps/core-api/internal/generation/roles.go`에 `requestedGenerativeRoles` 함수 바로 위에 추가:

```go
// effectiveRole returns an object's role for generation/assignment purposes:
// "static" unconditionally when the user has locked it (regardless of the
// classifier's own role), otherwise the classified role as-is. The
// underlying "role" field is never modified by this function -- unlocking
// (see Service.LockObject) restores whatever the classifier originally
// assigned.
func effectiveRole(object map[string]any) string {
	if locked, _ := object["locked"].(bool); locked {
		return "static"
	}
	role, _ := object["role"].(string)
	return role
}
```

`requestedGenerativeRoles`의 루프 안 `role, _ := object["role"].(string)`를 다음으로 교체:

```go
	for _, object := range objects {
		role := effectiveRole(object)
		if role == "subtitle" || role == "date" || role == "kpi" {
			seen[role] = true
		}
	}
```

`anyObjectHasRole` 전체를 다음으로 교체:

```go
func anyObjectHasRole(objects []map[string]any) bool {
	for _, object := range objects {
		if effectiveRole(object) != "" {
			return true
		}
	}
	return false
}
```

`rolePptxObjectEdits`의 루프 시작 부분 `role, _ := object["role"].(string)`를 다음으로 교체:

```go
	for _, object := range objects {
		role := effectiveRole(object)
		if role == "static" {
			continue
		}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd apps/core-api && go test ./internal/generation/... -v`
Expected: PASS — 새로 추가한 4개 테스트를 포함해 패키지 전체 테스트가 통과 (기존 role_classification_test.go/roles_test.go 회귀 없음)

- [ ] **Step 5: 커밋**

```bash
git add apps/core-api/internal/generation/roles.go apps/core-api/internal/generation/roles_test.go
git commit -m "feat(generation): add effectiveRole helper so a locked object always reports static"
```

---

### Task 2: `RolePreview` 서비스 메서드 + 엔드포인트

**Files:**
- Create: `apps/core-api/internal/generation/role_preview.go`
- Modify: `apps/core-api/internal/generation/service.go:165-171` (Service 구조체에 in-flight 추적 필드 추가)
- Modify: `apps/core-api/internal/generation/handlers.go:24-40` (핸들러 추가, 라우트 등록)
- Modify: `apps/core-api/internal/generation/handlers_test.go:892-905` (`classifyingLLM`에 테스트 동기화용 채널 필드 추가)
- Test: `apps/core-api/internal/generation/role_preview_test.go`

**Interfaces:**
- Consumes: `effectiveRole` (Task 1), `templateData.objects(index int) []map[string]any`, `templateData.capableIndexes() []int`, `chooseTemplateIndex(requested *int, order int, capable []int) int`, `needsRoleClassification(source map[string]any) bool` (모두 기존 `service.go`/`role_classification.go`에 이미 존재, 서명 그대로 재사용), `service.template(ctx, id *string, userID string, classify bool) (templateData, error)`.
- Produces: `type RolePreviewSlideInput struct { Type string; TemplateIndex *int }`, `type RolePreviewItem struct { ObjectID, Role string; Locked bool }` (JSON 태그 포함), `type RolePreviewResult struct { Status string; Slides []RolePreviewSlideResult }`, `func (service *Service) RolePreview(ctx context.Context, templateID, userID string, slides []RolePreviewSlideInput) (RolePreviewResult, error)` — Task 3이 `RolePreviewItem`을 재사용한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/core-api/internal/generation/handlers_test.go`의 기존 `classifyingLLM` 타입(L892-905)을 다음으로 교체(테스트에서만 쓰는 동기화 채널 2개 추가, 기존 필드/동작은 그대로):

```go
// classifyingLLM adds ClassifyTemplateRoles on top of maliciousHTMLLLM's
// existing full LLM implementation, so it satisfies both LLM and (via the
// service.llm.(RoleClassifier) type assertion in template()) RoleClassifier.
// release/done let a test control and observe a background classification
// goroutine deterministically instead of sleeping: if release is non-nil,
// ClassifyTemplateRoles blocks on it before proceeding; if done is
// non-nil, it's closed right before returning.
type classifyingLLM struct {
	*maliciousHTMLLLM
	classifyCalls int
	roles         map[string]string
	classifyErr   error
	release       chan struct{}
	done          chan struct{}
}

func (llm *classifyingLLM) ClassifyTemplateRoles(_ context.Context, _ RoleClassificationRequest) (map[string]string, error) {
	if llm.release != nil {
		<-llm.release
	}
	llm.classifyCalls++
	if llm.done != nil {
		defer close(llm.done)
	}
	if llm.classifyErr != nil {
		return nil, llm.classifyErr
	}
	return llm.roles, nil
}
```

새 파일 `apps/core-api/internal/generation/role_preview_test.go` 생성:

```go
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/core-api && go test ./internal/generation/... -run TestRolePreview -v`
Expected: FAIL — `RolePreviewSlideInput`, `RolePreviewItem`, `Service.RolePreview` 등이 아직 없어서 컴파일 에러

- [ ] **Step 3: `Service` 구조체에 in-flight 추적 필드 추가**

`apps/core-api/internal/generation/service.go`의 `Service` 구조체(L165-171)를 다음으로 교체(생성자 `NewService`는 변경 불필요 — `sync.Map`의 zero value는 바로 사용 가능):

```go
type Service struct {
	repo  Repository
	llm   LLM
	queue Queue
	mu    sync.Mutex
	jobs  map[string]*runningJob
	// classifying tracks template IDs with a background role-classification
	// goroutine currently running (see RolePreview/classifyInBackground in
	// role_preview.go) so concurrent callers for the same unclassified
	// template don't each start their own LLM round-trip.
	classifying sync.Map
}
```

- [ ] **Step 4: `role_preview.go` 구현**

새 파일 `apps/core-api/internal/generation/role_preview.go` 생성:

```go
package generation

import "context"

// RolePreviewSlideInput is the minimal per-outline-slide shape the
// role-preview endpoint needs to resolve which template slide an outline
// slide would use -- the same fields chooseTemplateIndex already consumes.
// Slides are matched to the request by array position, not by any id field
// -- see the design doc's note on why "order" is unsafe here (an outline
// can be reordered client-side before its order field is renumbered).
type RolePreviewSlideInput struct {
	Type          string
	TemplateIndex *int
}

// RolePreviewItem describes one template object's role for display. Role is
// always the *effective* role (see effectiveRole) so a locked object always
// reports "static" here, matching what generation will actually do. Locked
// mirrors the object's own "locked" field, distinguishing a user override
// (locked:true) from an object the classifier itself decided was static.
type RolePreviewItem struct {
	ObjectID string `json:"objectId"`
	Role     string `json:"role"`
	Locked   bool   `json:"locked"`
}

type RolePreviewSlideResult struct {
	Items []RolePreviewItem `json:"items"`
}

// RolePreviewResult.Status is one of "pending" (classification just
// triggered or already running), "ready" (Slides is populated), or
// "unavailable" (not a PPTX template -- no shape/role concept applies).
type RolePreviewResult struct {
	Status string                   `json:"status"`
	Slides []RolePreviewSlideResult `json:"slides,omitempty"`
}

// RolePreview reports, for each of the caller's outline slides (in the same
// order), which template shapes will be filled in vs left untouched. If the
// template has never been classified, this triggers classification in the
// background (classifyInBackground) and returns "pending" immediately -- it
// never blocks on the LLM round-trip, the same constraint template()'s
// classify parameter already enforces for Start/GenerateOutline.
func (service *Service) RolePreview(ctx context.Context, templateID, userID string, slides []RolePreviewSlideInput) (RolePreviewResult, error) {
	template, err := service.template(ctx, &templateID, userID, false)
	if err != nil {
		return RolePreviewResult{}, err
	}
	if !template.PPTX {
		return RolePreviewResult{Status: "unavailable"}, nil
	}
	if needsRoleClassification(template.Source) {
		service.classifyInBackground(templateID, userID)
		return RolePreviewResult{Status: "pending"}, nil
	}
	capable := template.capableIndexes()
	result := make([]RolePreviewSlideResult, len(slides))
	for index, slide := range slides {
		templateIndex := chooseTemplateIndex(slide.TemplateIndex, index, capable)
		items := []RolePreviewItem{}
		if templateIndex >= 0 {
			for _, object := range template.objects(templateIndex) {
				id, _ := object["id"].(string)
				role := effectiveRole(object)
				if id == "" || role == "" {
					continue
				}
				locked, _ := object["locked"].(bool)
				items = append(items, RolePreviewItem{ObjectID: id, Role: role, Locked: locked})
			}
		}
		result[index] = RolePreviewSlideResult{Items: items}
	}
	return RolePreviewResult{Status: "ready", Slides: result}, nil
}

// classifyInBackground starts role classification for templateID unless
// classification is already running for that same template -- multiple
// RolePreview calls for the same unclassified template (concurrent
// tabs/users) must not each start their own LLM round-trip. Runs detached
// from the request context: the HTTP request that triggered this will
// already have returned by the time classification finishes.
func (service *Service) classifyInBackground(templateID, userID string) {
	if _, alreadyRunning := service.classifying.LoadOrStore(templateID, true); alreadyRunning {
		return
	}
	go func() {
		defer service.classifying.Delete(templateID)
		_, _ = service.template(context.Background(), &templateID, userID, true)
	}()
}
```

- [ ] **Step 5: HTTP 핸들러 및 라우트 등록**

`apps/core-api/internal/generation/handlers.go`의 `NewHandlers`(L29-40) 라우트 등록 목록에 `router.Post("/edit", handler.edit)` 바로 다음 줄로 추가:

```go
	router.Post("/templates/{templateId}/role-preview", handler.rolePreview)
```

`handler.edit` 함수(L162-179) 바로 다음에 새 함수 추가:

```go
func (handler *handlers) rolePreview(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		Slides []struct {
			Type          string `json:"type"`
			TemplateIndex *int   `json:"templateIndex"`
		} `json:"slides"`
	}
	if err := decode(writer, request, &input); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	slides := make([]RolePreviewSlideInput, len(input.Slides))
	for index, slide := range input.Slides {
		slides[index] = RolePreviewSlideInput{Type: slide.Type, TemplateIndex: slide.TemplateIndex}
	}
	user, _ := auth.PrincipalFromContext(request.Context())
	result, err := handler.service.RolePreview(request.Context(), chi.URLParam(request, "templateId"), user.ID, slides)
	writeServiceResult(writer, http.StatusOK, result, err)
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `cd apps/core-api && go test ./internal/generation/... -v`
Expected: PASS — `role_preview_test.go`의 4개 테스트 포함 패키지 전체 통과

- [ ] **Step 7: 커밋**

```bash
git add apps/core-api/internal/generation/role_preview.go apps/core-api/internal/generation/role_preview_test.go apps/core-api/internal/generation/service.go apps/core-api/internal/generation/handlers.go apps/core-api/internal/generation/handlers_test.go
git commit -m "feat(generation): add role-preview endpoint with background classification trigger"
```

---

### Task 3: `LockObject` 서비스 메서드 + 엔드포인트

**Files:**
- Modify: `apps/core-api/internal/generation/role_preview.go` (LockObject + findObjectByID 추가)
- Modify: `apps/core-api/internal/generation/handlers.go` (핸들러 추가, 라우트 등록)
- Test: `apps/core-api/internal/generation/role_preview_test.go`

**Interfaces:**
- Consumes: `RolePreviewItem` (Task 2), `rawObject(json.RawMessage) map[string]any`, `effectiveRole` (Task 1), `service.repo.VisibleTemplateConfig`/`UpdateTemplateConfig` (기존 Repository 인터페이스).
- Produces: `func (service *Service) LockObject(ctx context.Context, templateID, userID, objectID string, locked bool) (RolePreviewItem, error)`.

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/core-api/internal/generation/role_preview_test.go` 끝에 추가:

```go
func TestLockObjectSetsLockedAndPreservesOriginalRole(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	repo.templates["pptx-template"] = memoryTemplate{
		public: true,
		config: json.RawMessage(`{"source":{"kind":"pptx","slides":[{"objects":[` +
			`{"id":"shape-1","kind":"text","role":"subtitle"}` +
			`]}]}}`),
	}
	service := NewService(repo, &maliciousHTMLLLM{}, new(recordingQueue))

	item, err := service.LockObject(context.Background(), "pptx-template", "user-1", "shape-1", true)
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
		public: true,
		config: json.RawMessage(`{"source":{"kind":"pptx","slides":[{"objects":[` +
			`{"id":"shape-1","kind":"text","role":"subtitle","locked":true}` +
			`]}]}}`),
	}
	service := NewService(repo, &maliciousHTMLLLM{}, new(recordingQueue))

	item, err := service.LockObject(context.Background(), "pptx-template", "user-1", "shape-1", false)
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
		public: true,
		config: json.RawMessage(`{"source":{"kind":"pptx","slides":[{"objects":[{"id":"shape-1","kind":"text","role":"body"}]}]}}`),
	}
	service := NewService(repo, &maliciousHTMLLLM{}, new(recordingQueue))

	if _, err := service.LockObject(context.Background(), "pptx-template", "user-1", "does-not-exist", true); !errors.Is(err, ErrBadInput) {
		t.Fatalf("LockObject() error = %v, want ErrBadInput", err)
	}
}
```

`role_preview_test.go`의 import 블록에 `"errors"`를 추가한다:

```go
import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
)
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/core-api && go test ./internal/generation/... -run TestLockObject -v`
Expected: FAIL — `Service.LockObject`가 아직 없어서 컴파일 에러

- [ ] **Step 3: `LockObject` 구현**

`apps/core-api/internal/generation/role_preview.go`의 import를 다음으로 교체:

```go
import (
	"context"
	"encoding/json"
	"fmt"
)
```

파일 끝에 추가:

```go
// LockObject sets (or clears) one template object's user-forced "locked"
// override -- see effectiveRole. The underlying "role" field is never
// touched, so clearing the override (locked=false) restores whatever the
// classifier originally assigned. Persists via UpdateTemplateConfig, the
// same repo method classifyTemplateRoles already uses, so the change is
// permanent and visible to every future generation.
func (service *Service) LockObject(ctx context.Context, templateID, userID, objectID string, locked bool) (RolePreviewItem, error) {
	raw, err := service.repo.VisibleTemplateConfig(ctx, templateID, userID)
	if err != nil {
		return RolePreviewItem{}, fmt.Errorf("%w: Template not found", ErrBadInput)
	}
	fields := rawObject(raw)
	source, _ := fields["source"].(map[string]any)
	object, err := findObjectByID(source, objectID)
	if err != nil {
		return RolePreviewItem{}, err
	}
	object["locked"] = locked
	encoded, err := json.Marshal(fields)
	if err != nil {
		return RolePreviewItem{}, err
	}
	if err := service.repo.UpdateTemplateConfig(ctx, templateID, encoded); err != nil {
		return RolePreviewItem{}, err
	}
	return RolePreviewItem{ObjectID: objectID, Role: effectiveRole(object), Locked: locked}, nil
}

// findObjectByID locates one object by id across every slide in source,
// returning a wrapped ErrBadInput if no slide's objects contain it -- the
// same "not found -> ErrBadInput" convention service.template() already
// uses for a missing template, rather than the ErrNotFound sentinel (that
// one is reserved for generation jobs -- see writeServiceResult's hardcoded
// "Job not found" message).
func findObjectByID(source map[string]any, objectID string) (map[string]any, error) {
	rawSlides, _ := source["slides"].([]any)
	for _, rawSlide := range rawSlides {
		slide, _ := rawSlide.(map[string]any)
		rawObjects, _ := slide["objects"].([]any)
		for _, rawObject := range rawObjects {
			object, ok := rawObject.(map[string]any)
			if !ok {
				continue
			}
			if id, _ := object["id"].(string); id == objectID {
				return object, nil
			}
		}
	}
	return nil, fmt.Errorf("%w: Object not found", ErrBadInput)
}
```

- [ ] **Step 4: HTTP 핸들러 및 라우트 등록**

`apps/core-api/internal/generation/handlers.go`의 `NewHandlers`에서 Task 2가 추가한 줄 다음에:

```go
	router.Patch("/templates/{templateId}/objects/{objectId}/lock", handler.lockObject)
```

`rolePreview` 핸들러 함수 다음에 추가:

```go
func (handler *handlers) lockObject(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		Locked bool `json:"locked"`
	}
	if err := decode(writer, request, &input); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	user, _ := auth.PrincipalFromContext(request.Context())
	result, err := handler.service.LockObject(
		request.Context(), chi.URLParam(request, "templateId"), user.ID, chi.URLParam(request, "objectId"), input.Locked,
	)
	writeServiceResult(writer, http.StatusOK, result, err)
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd apps/core-api && go test ./internal/generation/... -v`
Expected: PASS — 패키지 전체 테스트 통과

- [ ] **Step 6: 커밋**

```bash
git add apps/core-api/internal/generation/role_preview.go apps/core-api/internal/generation/role_preview_test.go apps/core-api/internal/generation/handlers.go
git commit -m "feat(generation): add object lock/unlock endpoint for permanent static overrides"
```

---

### Task 4: 프론트엔드 — 역할 미리보기 폴링 및 고정/해제 UI

**Files:**
- Modify: `apps/web/src/lib/api.ts` (generationApi에 `rolePreview`/`lockObject` 추가)
- Modify: `apps/web/src/app/dashboard/page.tsx` (`OutlineSlide`에 `templateIndex` 추가, 폴링 useEffect, 카드 렌더링, 고정 토글 핸들러)
- Test: `apps/web/test/role-preview.test.js`

**Interfaces:**
- Consumes: `POST /generation/templates/{id}/role-preview`, `PATCH /generation/templates/{id}/objects/{objectId}/lock` (Task 2/3에서 만든 백엔드 엔드포인트, 응답 JSON 형태는 스펙과 동일).
- Produces: 없음 (최종 UI 소비 지점).

- [ ] **Step 1: 실패하는 테스트 작성**

새 파일 `apps/web/test/role-preview.test.js` 생성:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const webRoot = path.join(__dirname, '..');

test('generation api client exposes role-preview and lock endpoints', () => {
    const api = fs.readFileSync(path.join(webRoot, 'src', 'lib', 'api.ts'), 'utf8');
    assert.match(api, /rolePreview:\s*\(templateId: string/);
    assert.match(api, /\/generation\/templates\/\$\{templateId\}\/role-preview/);
    assert.match(api, /lockObject:\s*\(templateId: string/);
    assert.match(api, /\/generation\/templates\/\$\{templateId\}\/objects\/\$\{objectId\}\/lock/);
});

test('outline review polls role-preview by array position and stops once ready', () => {
    const dashboard = fs.readFileSync(path.join(webRoot, 'src', 'app', 'dashboard', 'page.tsx'), 'utf8');

    assert.match(dashboard, /generationApi\.rolePreview\(/);
    assert.match(dashboard, /attempts < 30/);
    assert.match(dashboard, /status === 'ready'/);
    assert.match(dashboard, /rolePreviewKey/);
});

test('outline review shows role labels with a lock/unlock toggle', () => {
    const dashboard = fs.readFileSync(path.join(webRoot, 'src', 'app', 'dashboard', 'page.tsx'), 'utf8');

    assert.match(dashboard, /ROLE_LABELS/);
    assert.match(dashboard, /고정하기/);
    assert.match(dashboard, /고정 해제/);
    assert.match(dashboard, /generationApi\.lockObject\(/);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/web && node --test test/role-preview.test.js`
Expected: FAIL — 3개 테스트 모두 `assert.match` 실패 (해당 문자열이 아직 소스에 없음)

- [ ] **Step 3: API 클라이언트에 두 메서드 추가**

`apps/web/src/lib/api.ts`의 `generationApi`(L95-109) 안, `edit` 항목 바로 다음에 추가:

```ts
    rolePreview: (templateId: string, slides: { type: string; templateIndex: number | null }[]) =>
        api.post(`/generation/templates/${templateId}/role-preview`, { slides }),
    lockObject: (templateId: string, objectId: string, locked: boolean) =>
        api.patch(`/generation/templates/${templateId}/objects/${objectId}/lock`, { locked }),
```

- [ ] **Step 4: `dashboard/page.tsx` 타입과 상태 추가**

`OutlineSlide` 인터페이스(L35-40)를 다음으로 교체(백엔드는 이미 `templateIndex`를 내려주지만 프론트 타입에 없었다 — `omitempty`라 없을 수도 있으므로 optional):

```ts
interface OutlineSlide {
    order: number;
    title: string;
    type: string;
    keyPoints: string[];
    templateIndex?: number | null;
}
```

`Outline` 인터페이스 바로 다음에 새 타입 추가:

```ts
interface RolePreviewItem {
    objectId: string;
    role: string;
    locked: boolean;
}

interface RolePreviewSlide {
    items: RolePreviewItem[];
}

const ROLE_LABELS: Record<string, string> = {
    title: '제목', subtitle: '부제목', body: '본문', date: '날짜', kpi: 'KPI', static: '고정',
};
```

Outline review state 블록(L93-97, `outlineContext` 선언 다음)에 새 state 추가:

```ts
    const [rolePreview, setRolePreview] = useState<RolePreviewSlide[] | null>(null);
```

- [ ] **Step 5: 폴링 `useEffect`와 고정 토글 핸들러 추가**

`pollJobStatus` 함수(L339-370) 바로 다음에 추가:

```ts
    const rolePreviewKey = outline
        ? JSON.stringify(outline.slides.map((slide) => ({ type: slide.type, templateIndex: slide.templateIndex ?? null })))
        : null;

    useEffect(() => {
        if (!outline || !outlineContext?.templateId) {
            setRolePreview(null);
            return;
        }
        setRolePreview(null);
        let cancelled = false;
        let attempts = 0;
        const templateId = outlineContext.templateId;
        const slides = outline.slides.map((slide) => ({ type: slide.type, templateIndex: slide.templateIndex ?? null }));
        const poll = async () => {
            if (cancelled) return;
            attempts += 1;
            try {
                const response = await generationApi.rolePreview(templateId, slides);
                if (cancelled) return;
                if (response.data.status === 'ready') {
                    setRolePreview(response.data.slides);
                    return;
                }
            } catch {
                // Best-effort: role preview failing does not block generation
                // (the font-rank fallback still applies), so fail silently.
            }
            if (!cancelled && attempts < 30) setTimeout(poll, 2000);
        };
        poll();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rolePreviewKey, outlineContext?.templateId]);

    const handleToggleLock = async (templateId: string, objectId: string, slideIndex: number, locked: boolean) => {
        try {
            const response = await generationApi.lockObject(templateId, objectId, locked);
            setRolePreview((prev) => prev && prev.map((slide, i) => (i !== slideIndex ? slide : {
                items: slide.items.map((item) => (item.objectId === objectId ? response.data : item)),
            })));
        } catch (error: any) {
            toast({
                title: locked ? '고정 실패' : '고정 해제 실패',
                description: error.response?.data?.message || (locked ? '도형을 고정하지 못했습니다.' : '고정을 해제하지 못했습니다.'),
                variant: 'destructive',
            });
        }
    };
```

- [ ] **Step 6: 아웃라인 카드에 역할 목록 렌더링**

아웃라인 카드 JSX(L442-456, `keyPoints`를 렌더링하는 `<div className="mt-3 space-y-2 pl-8">...</div>` 블록) 바로 다음, 카드를 닫는 `</div>`(L457) 이전에 추가:

```tsx
                                        {rolePreview?.[i] && rolePreview[i].items.length > 0 && (
                                            <div className="mt-3 space-y-1 border-t border-border pt-3 pl-8">
                                                {rolePreview[i].items.map((item) => {
                                                    const label = ROLE_LABELS[item.role] ?? item.role;
                                                    const isUserLocked = item.role === 'static' && item.locked;
                                                    const isClassifierStatic = item.role === 'static' && !item.locked;
                                                    return (
                                                        <div key={item.objectId} className="flex items-center justify-between text-xs text-muted-foreground">
                                                            <span>
                                                                {label} · {isClassifierStatic ? '🔒 고정됨(템플릿 원본)' : isUserLocked ? '🔒 고정됨' : '채워질 예정'}
                                                            </span>
                                                            {!isClassifierStatic && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleToggleLock(outlineContext!.templateId!, item.objectId, i, !isUserLocked)}
                                                                    className="text-primary hover:underline"
                                                                >
                                                                    {isUserLocked ? '고정 해제' : '고정하기'}
                                                                </button>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `cd apps/web && node --test test/role-preview.test.js`
Expected: PASS — 3개 테스트 모두 통과

Run: `cd apps/web && npm run lint`
Expected: PASS — `tsc --noEmit`이 새 타입/코드에서 타입 에러 없이 통과

- [ ] **Step 8: 커밋**

```bash
git add apps/web/src/lib/api.ts apps/web/src/app/dashboard/page.tsx apps/web/test/role-preview.test.js
git commit -m "feat(web): show per-slide role preview with a static-lock toggle in outline review"
```

---

### Task 5: 수동 종단 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: 로컬 스택 재빌드 및 기동**

```bash
docker compose -f docker-compose.yml -p jaslide-try up -d --build api web
```

- [ ] **Step 2: 이미 분류된 실제 템플릿으로 역할 미리보기 확인**

브라우저에서 `http://localhost:3100` 접속, 기존에 분류가 끝난 템플릿(박태지_0723_업무보고_AI엔지니어링, 이전 세션에서 이미 role 분류됨)을 선택해 아웃라인을 생성한다. 아웃라인 검토 화면의 각 슬라이드 카드 아래에 역할 목록(제목/부제목/본문/날짜/KPI 중 실제 그 슬라이드에 있는 것들, "채워질 예정" 또는 "🔒 고정됨")이 몇 초 안에 나타나는지 확인한다.

Expected: 목록이 뜨고, 부서명 라벨처럼 원래 template에서 `static`으로 분류된 도형은 "🔒 고정됨(템플릿 원본)"으로 버튼 없이 표시된다.

- [ ] **Step 3: 도형을 고정하고 생성해서 실제로 반영되는지 확인**

`subtitle`로 분류된 도형(예: 부서명 자리) 옆의 "고정하기" 버튼을 클릭한다. 버튼이 "🔒 고정됨" + "고정 해제"로 즉시 바뀌는지 확인한 뒤, 아웃라인을 승인하고 생성을 완료한다. 생성된 프레젠테이션을 열어 그 도형의 텍스트가 템플릿 원본 그대로이고 새로 생성된 텍스트로 덮어써지지 않았는지 확인한다.

Expected: 고정한 도형은 원본 텍스트 그대로, 나머지 도형(제목/본문 등)은 정상적으로 새 콘텐츠로 채워진다.

- [ ] **Step 4: 고정 해제 후 재생성으로 원래 분류 복귀 확인**

같은 템플릿으로 새 아웃라인을 생성해 역할 미리보기를 다시 띄우고, 방금 고정한 도형의 "고정 해제" 버튼을 클릭한다. 그 도형이 다시 "채워질 예정"(subtitle)으로 표시되는지 확인한 뒤 생성을 완료해서, 이번에는 그 도형이 정상적으로 새 subtitle 텍스트로 채워지는지 확인한다.

Expected: 고정 해제 후에는 원래 LLM이 분류한 역할(subtitle)로 정상 동작 — 즉 `role` 필드가 고정 중에도 보존되어 있었음이 실증됨.

- [ ] **Step 5: 미분류 신규 템플릿으로 pending→ready 전환 확인**

한 번도 role 분류가 실행되지 않은 새 PPTX를 임포트해 곧바로 아웃라인을 생성한다. 아웃라인 화면이 뜨자마자는 역할 목록이 안 보이다가(또는 로딩 상태), 분류가 끝나면 자동으로 목록이 나타나는지 확인한다.

Expected: 아웃라인 생성 자체는 분류 완료를 기다리지 않고 즉시 뜨고, 몇 초 후 역할 목록만 추가로 나타난다 (동기 경로 차단 없음 확인).
