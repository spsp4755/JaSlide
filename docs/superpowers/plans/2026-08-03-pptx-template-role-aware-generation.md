# PPTX Template Role-Aware Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `pptxObjectEdits`' font-size-rank guess for which template shape gets which generated content with a role-based assignment (title/subtitle/body/date/kpi/static), classified once per template by the LLM and cached on the `Template` row.

**Architecture:** A new LLM call (`ClassifyTemplateRoles`) tags every text/table object in a template's `config.source.slides[].objects[]` with a `role` string, cached in place. New templates are classified at import; existing templates are classified lazily on first use and persisted back. `pptxObjectEdits` becomes role-aware but falls back verbatim to today's font-rank logic whenever a slide's objects carry no role data at all, so there is no behavior regression while classification is pending or unavailable.

**Tech Stack:** Go (`apps/core-api`), the existing `OpenAIClient`/`LLM` interface pattern in `apps/core-api/internal/generation`, Postgres via `pgx` (`apps/core-api/internal/db`).

## Global Constraints

- Role vocabulary is exactly these 6 values, closed list: `title`, `subtitle`, `body`, `date`, `kpi`, `static`. No other values are ever written or read.
- A `table`-kind object may only ever be classified `body` or `static` — never `title`/`subtitle`/`date`/`kpi`.
- Classification runs **once per template**, at import time (new templates) or lazily on first generation request (existing templates), and the result is cached on the `Template` row's `config` column — never re-run once any object in the template carries a non-empty `role`.
- Classification failure (LLM error, invalid JSON) must never fail generation or template import — it leaves objects unclassified, and callers fall back to today's font-size-rank behavior.
- When a slide's template objects carry **zero** role data, `pptxObjectEdits` must behave byte-for-byte like it does today (the pre-existing font-size-rank logic, verbatim, under a new name `legacyPptxObjectEdits`).
- `static`-classified objects (text or table) are **never** included in `objectEdits` — the exported slide keeps that shape's original template content untouched.
- Table CELL-level label/data heuristic (`isTableLabel`) is unchanged — this plan only changes SHAPE-level (whole-object) `body`/`static` assignment.
- This plan only touches the native-PPTX object-edit path (`template.PPTX == true`). The non-PPTX/HTML slide generation path (`heading`/`columns`/`chart`/`timeline`/etc.) is untouched.
- No manual role-review/correction UI. No per-instance values when multiple objects share one generative role (broadcast the same value to all of them).

---

### Task 1: Template role classification core (types, LLM call, merge helpers)

**Files:**
- Create: `apps/core-api/internal/generation/role_classification.go`
- Create: `apps/core-api/internal/generation/role_classification_test.go`

**Interfaces:**
- Consumes: `client.validated` (existing method on `*OpenAIClient`, `apps/core-api/internal/generation/llm.go:223-248`), `truncate`/`number` (existing package-level helpers, `apps/core-api/internal/generation/llm.go:842-848` and `service.go:829-832`).
- Produces: `type RoleClassificationObject struct{ ID, Kind, SampleText string; FontSize, Left, Top, Width, Height float64 }`, `type RoleClassificationSlide struct{ Index int; Objects []RoleClassificationObject }`, `type RoleClassificationRequest struct{ Slides []RoleClassificationSlide }`, `type RoleClassifier interface{ ClassifyTemplateRoles(context.Context, RoleClassificationRequest) (map[string]string, error) }`, method `func (client *OpenAIClient) ClassifyTemplateRoles(ctx context.Context, input RoleClassificationRequest) (map[string]string, error)`, `func buildRoleObjects(source map[string]any) []RoleClassificationSlide`, `func needsRoleClassification(source map[string]any) bool`, `func mergeTemplateRoles(source map[string]any, roles map[string]string) map[string]any`, `func ApplyRoleClassification(ctx context.Context, classifier RoleClassifier, source map[string]any) (map[string]any, error)`. Task 2 and Task 3 call `ApplyRoleClassification`, `RoleClassifier`, and `needsRoleClassification`. Task 5 relies on `object["role"]` being set by `mergeTemplateRoles`.

- [ ] **Step 1: Write the failing tests**

Create `apps/core-api/internal/generation/role_classification_test.go`:

```go
package generation

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestBuildRoleObjectsSkipsNonTextTableAndMissingIDs(t *testing.T) {
	source := map[string]any{"slides": []any{
		map[string]any{"objects": []any{
			map[string]any{"id": "shape-1", "kind": "text", "fontSize": 32.0, "text": "Q3 Report"},
			map[string]any{"id": "shape-2", "kind": "table", "cells": []any{[]any{"A", "B"}}},
			map[string]any{"id": "shape-3", "kind": "image"},
			map[string]any{"kind": "text", "text": "no id, skipped"},
		}},
		map[string]any{"objects": []any{}},
	}}

	slides := buildRoleObjects(source)

	if len(slides) != 1 {
		t.Fatalf("buildRoleObjects() returned %d slides, want 1 (the empty second slide is dropped)", len(slides))
	}
	if slides[0].Index != 0 {
		t.Fatalf("slides[0].Index = %d, want 0", slides[0].Index)
	}
	if len(slides[0].Objects) != 2 {
		t.Fatalf("slides[0].Objects = %d, want 2 (image and no-id objects skipped)", len(slides[0].Objects))
	}
	if slides[0].Objects[0].ID != "shape-1" || slides[0].Objects[0].Kind != "text" || slides[0].Objects[0].FontSize != 32.0 {
		t.Fatalf("slides[0].Objects[0] = %+v, want shape-1/text/32.0", slides[0].Objects[0])
	}
	if slides[0].Objects[1].ID != "shape-2" || slides[0].Objects[1].Kind != "table" {
		t.Fatalf("slides[0].Objects[1] = %+v, want shape-2/table", slides[0].Objects[1])
	}
}

func TestNeedsRoleClassificationTrueWhenNoObjectHasARole(t *testing.T) {
	source := map[string]any{"slides": []any{
		map[string]any{"objects": []any{map[string]any{"id": "shape-1", "kind": "text"}}},
	}}
	if !needsRoleClassification(source) {
		t.Fatal("needsRoleClassification() = false, want true when no object carries a role")
	}
}

func TestNeedsRoleClassificationFalseWhenAnyObjectHasARole(t *testing.T) {
	source := map[string]any{"slides": []any{
		map[string]any{"objects": []any{
			map[string]any{"id": "shape-1", "kind": "text"},
			map[string]any{"id": "shape-2", "kind": "text", "role": "static"},
		}},
	}}
	if needsRoleClassification(source) {
		t.Fatal("needsRoleClassification() = true, want false once any object carries a role")
	}
}

func TestMergeTemplateRolesAppliesReturnedRolesAndDefaultsRestToStatic(t *testing.T) {
	source := map[string]any{"slides": []any{
		map[string]any{"objects": []any{
			map[string]any{"id": "shape-1", "kind": "text"},
			map[string]any{"id": "shape-2", "kind": "table"},
			map[string]any{"id": "shape-3", "kind": "image"},
		}},
	}}

	merged := mergeTemplateRoles(source, map[string]string{"shape-1": "title"})

	slides, _ := merged["slides"].([]any)
	objects, _ := slides[0].(map[string]any)["objects"].([]any)
	first, _ := objects[0].(map[string]any)
	second, _ := objects[1].(map[string]any)
	third, _ := objects[2].(map[string]any)
	if first["role"] != "title" {
		t.Fatalf("shape-1 role = %v, want title", first["role"])
	}
	if second["role"] != "static" {
		t.Fatalf("shape-2 role = %v, want static (not returned by classifier, so defaulted)", second["role"])
	}
	if _, ok := third["role"]; ok {
		t.Fatalf("shape-3 (image) got a role = %v, want no role key at all", third["role"])
	}
}

func TestOpenAIClientClassifyTemplateRolesRejectsInvalidAndKindMismatchedRoles(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		raw, _ := json.Marshal(map[string]any{"roles": map[string]string{
			"shape-1": "title",         // valid, text
			"shape-2": "kpi",           // invalid: table can't be kpi
			"shape-3": "not-a-role",    // invalid: not in the closed vocabulary
			"shape-4": "static",        // valid, table
			"unknown-shape": "title",   // invalid: id not in the request
		}})
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]string{"content": string(raw)}}},
		})
	}))
	defer server.Close()

	llm := NewOpenAIClient(staticModelSource{model: Model{
		ID: "model-1", ModelID: "local-model", Endpoint: server.URL, MaxTokens: 2048, IsActive: true,
	}}, server.Client(), EnvironmentModel{})

	roles, err := llm.ClassifyTemplateRoles(context.Background(), RoleClassificationRequest{Slides: []RoleClassificationSlide{
		{Index: 0, Objects: []RoleClassificationObject{
			{ID: "shape-1", Kind: "text"}, {ID: "shape-2", Kind: "table"},
			{ID: "shape-3", Kind: "text"}, {ID: "shape-4", Kind: "table"},
		}},
	}})
	if err != nil {
		t.Fatalf("ClassifyTemplateRoles() error = %v", err)
	}
	want := map[string]string{"shape-1": "title", "shape-4": "static"}
	if !reflect.DeepEqual(roles, want) {
		t.Fatalf("ClassifyTemplateRoles() = %v, want %v (invalid/kind-mismatched/unknown-id entries dropped)", roles, want)
	}
}

func TestApplyRoleClassificationMergesClassifierResultIntoSource(t *testing.T) {
	source := map[string]any{"slides": []any{
		map[string]any{"objects": []any{map[string]any{"id": "shape-1", "kind": "text"}}},
	}}
	classifier := stubClassifier{roles: map[string]string{"shape-1": "title"}}

	merged, err := ApplyRoleClassification(context.Background(), classifier, source)
	if err != nil {
		t.Fatalf("ApplyRoleClassification() error = %v", err)
	}
	slides, _ := merged["slides"].([]any)
	objects, _ := slides[0].(map[string]any)["objects"].([]any)
	object, _ := objects[0].(map[string]any)
	if object["role"] != "title" {
		t.Fatalf("role = %v, want title", object["role"])
	}
}

type stubClassifier struct{ roles map[string]string }

func (stub stubClassifier) ClassifyTemplateRoles(context.Context, RoleClassificationRequest) (map[string]string, error) {
	return stub.roles, nil
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/core-api && go test ./internal/generation/... -run 'TestBuildRoleObjects|TestNeedsRoleClassification|TestMergeTemplateRoles|TestOpenAIClientClassifyTemplateRoles|TestApplyRoleClassification' -v`
Expected: FAIL — `undefined: buildRoleObjects` (and the other new names) since `role_classification.go` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `apps/core-api/internal/generation/role_classification.go`:

```go
package generation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// RoleClassificationObject is one text/table shape offered to the LLM for
// role classification -- position and font size help distinguish e.g. a
// small bottom-left footer from a large top title, and SampleText gives the
// model the shape's actual current content (a date string, boilerplate
// copyright text, a KPI number, ...).
type RoleClassificationObject struct {
	ID, Kind, SampleText                string
	FontSize, Left, Top, Width, Height float64
}

// RoleClassificationSlide is one layout slide's eligible (text/table, with
// an id) objects. Index is the template's slide index, carried through so a
// future caller could report per-slide classification if needed -- unused
// by the prompt today but kept for parity with availableLevels' per-slide
// shape.
type RoleClassificationSlide struct {
	Index   int
	Objects []RoleClassificationObject
}

type RoleClassificationRequest struct {
	Slides []RoleClassificationSlide
}

// RoleClassifier is the narrow capability generation.Service and the
// templates package both need -- satisfied by *OpenAIClient, and by any
// test double, without requiring every LLM test fake in this package to
// grow a new method (see docs/superpowers/plans/2026-08-03-pptx-template-role-aware-generation.md
// Task 2's fallback-to-legacy design).
type RoleClassifier interface {
	ClassifyTemplateRoles(ctx context.Context, input RoleClassificationRequest) (map[string]string, error)
}

// roleVocabulary is the closed set of role values classification may ever
// produce -- see the plan's Global Constraints.
var roleVocabulary = map[string]bool{
	"title": true, "subtitle": true, "body": true, "date": true, "kpi": true, "static": true,
}

// tableRoles is the subset of roleVocabulary a "table" kind object may
// carry -- a table can never be a title/subtitle/date/kpi.
var tableRoles = map[string]bool{"body": true, "static": true}

const roleClassificationSystem = "You are a presentation template analyst. Return JSON only."

// ClassifyTemplateRoles asks the classifier once for every eligible object
// in source (all slides), and merges the result back in. Returns source
// unchanged (no error) if there is nothing to classify.
func ApplyRoleClassification(ctx context.Context, classifier RoleClassifier, source map[string]any) (map[string]any, error) {
	slides := buildRoleObjects(source)
	if len(slides) == 0 {
		return source, nil
	}
	roles, err := classifier.ClassifyTemplateRoles(ctx, RoleClassificationRequest{Slides: slides})
	if err != nil {
		return nil, err
	}
	return mergeTemplateRoles(source, roles), nil
}

// buildRoleObjects reads source.slides[].objects[] (the same shape
// templateData.objects() reads, service.go:606-620) and collects every
// text/table object that has an id, grouped by slide index. Slides with no
// eligible objects are omitted.
func buildRoleObjects(source map[string]any) []RoleClassificationSlide {
	rawSlides, _ := source["slides"].([]any)
	var result []RoleClassificationSlide
	for index, rawSlide := range rawSlides {
		slide, _ := rawSlide.(map[string]any)
		rawObjects, _ := slide["objects"].([]any)
		var objects []RoleClassificationObject
		for _, rawObject := range rawObjects {
			object, ok := rawObject.(map[string]any)
			if !ok {
				continue
			}
			kind, _ := object["kind"].(string)
			if kind != "text" && kind != "table" {
				continue
			}
			id, _ := object["id"].(string)
			if id == "" {
				continue
			}
			objects = append(objects, RoleClassificationObject{
				ID: id, Kind: kind, FontSize: number(object["fontSize"]),
				Left: number(object["left"]), Top: number(object["top"]),
				Width: number(object["width"]), Height: number(object["height"]),
				SampleText: sampleText(object),
			})
		}
		if len(objects) == 0 {
			continue
		}
		result = append(result, RoleClassificationSlide{Index: index, Objects: objects})
	}
	return result
}

// sampleText extracts a short preview of an object's current content: the
// flattened text field for a text shape, or the first few cells for a
// table -- enough for the model to recognize "this looks like a date" or
// "this is boilerplate footer text" without sending the whole document.
func sampleText(object map[string]any) string {
	if text, ok := object["text"].(string); ok && strings.TrimSpace(text) != "" {
		return truncate(text, 80)
	}
	if cells, ok := object["cells"].([]any); ok {
		var parts []string
		for _, cell := range cells {
			if text, ok := cell.(string); ok && strings.TrimSpace(text) != "" {
				parts = append(parts, text)
				if len(parts) == 4 {
					break
				}
			}
		}
		return truncate(strings.Join(parts, " | "), 80)
	}
	return ""
}

// needsRoleClassification reports whether classification has never run for
// this template: true only when NOT ONE object across every slide carries
// a non-empty role. mergeTemplateRoles always tags every eligible object
// (defaulting to "static" when the classifier didn't return one), so once
// classification succeeds even once, this permanently returns false for
// that template's persisted config.
func needsRoleClassification(source map[string]any) bool {
	rawSlides, _ := source["slides"].([]any)
	for _, rawSlide := range rawSlides {
		slide, _ := rawSlide.(map[string]any)
		rawObjects, _ := slide["objects"].([]any)
		for _, rawObject := range rawObjects {
			object, ok := rawObject.(map[string]any)
			if !ok {
				continue
			}
			if role, ok := object["role"].(string); ok && role != "" {
				return false
			}
		}
	}
	return true
}

// mergeTemplateRoles writes roles[id] into every matching text/table
// object's "role" field, mutating and returning source. Any eligible
// object the classifier didn't mention gets "static" -- the safest
// default, and what makes needsRoleClassification's "ran once, never
// again" behavior correct even when the classifier's response is
// incomplete.
func mergeTemplateRoles(source map[string]any, roles map[string]string) map[string]any {
	rawSlides, _ := source["slides"].([]any)
	for _, rawSlide := range rawSlides {
		slide, _ := rawSlide.(map[string]any)
		rawObjects, _ := slide["objects"].([]any)
		for _, rawObject := range rawObjects {
			object, ok := rawObject.(map[string]any)
			if !ok {
				continue
			}
			kind, _ := object["kind"].(string)
			if kind != "text" && kind != "table" {
				continue
			}
			id, _ := object["id"].(string)
			if role, ok := roles[id]; ok {
				object["role"] = role
			} else {
				object["role"] = "static"
			}
		}
	}
	return source
}

// ClassifyTemplateRoles asks the model to tag every object in input with
// one of the 6 roles in one call, then drops any entry that names an id
// outside the request, uses a role outside roleVocabulary, or assigns a
// table a non-table-eligible role -- a small local model routinely does
// all three, and a partially-valid result is far more useful than failing
// the whole classification.
func (client *OpenAIClient) ClassifyTemplateRoles(ctx context.Context, input RoleClassificationRequest) (map[string]string, error) {
	kindByID := map[string]string{}
	for _, slide := range input.Slides {
		for _, object := range slide.Objects {
			kindByID[object.ID] = object.Kind
		}
	}
	result := map[string]string{}
	err := client.validated(ctx, roleClassificationSystem, roleClassificationPrompt(input), func(raw json.RawMessage) error {
		var value struct {
			Roles map[string]string `json:"roles"`
		}
		if json.Unmarshal(raw, &value) != nil || len(value.Roles) == 0 {
			return errors.New("role classification requires a non-empty roles object")
		}
		cleaned := map[string]string{}
		for id, role := range value.Roles {
			kind, known := kindByID[id]
			if !known || !roleVocabulary[role] {
				continue
			}
			if kind == "table" && !tableRoles[role] {
				continue
			}
			cleaned[id] = role
		}
		if len(cleaned) == 0 {
			return errors.New("role classification returned no valid roles")
		}
		result = cleaned
		return nil
	})
	return result, err
}

func roleClassificationPrompt(input RoleClassificationRequest) string {
	var lines []string
	for _, slide := range input.Slides {
		lines = append(lines, fmt.Sprintf("Slide %d:", slide.Index))
		for _, object := range slide.Objects {
			lines = append(lines, fmt.Sprintf(
				"  id=%s kind=%s fontSize=%g top=%g sampleText=%q",
				object.ID, object.Kind, object.FontSize, object.Top, object.SampleText,
			))
		}
	}
	return fmt.Sprintf(
		"Classify the role of every shape below in a presentation template. Return JSON only: "+
			"{\"roles\":{\"<id>\":\"<role>\"}} covering every id listed.\n"+
			"Allowed roles: title (the slide's main heading), subtitle (a secondary heading or tagline), "+
			"body (the main fillable text, or a table meant to be filled with data), "+
			"date (a date value), kpi (a single highlighted metric or number), "+
			"static (never regenerate this: logo, footer, page number, or a decorative/reference table).\n"+
			"A shape with kind=table may only be \"body\" or \"static\" -- never title/subtitle/date/kpi.\n"+
			"%s",
		strings.Join(lines, "\n"),
	)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/core-api && go test ./internal/generation/... -run 'TestBuildRoleObjects|TestNeedsRoleClassification|TestMergeTemplateRoles|TestOpenAIClientClassifyTemplateRoles|TestApplyRoleClassification' -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the full package test suite to confirm no regressions**

Run: `cd apps/core-api && go test ./internal/generation/...`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/core-api/internal/generation/role_classification.go apps/core-api/internal/generation/role_classification_test.go
git commit -m "feat(generation): add PPTX template role classification core"
```

---

### Task 2: Backfill classification into generation.Service.template()

**Files:**
- Modify: `apps/core-api/internal/generation/service.go:103-115` (`Repository` interface), `apps/core-api/internal/generation/service.go:571-589` (`func (service *Service) template`)
- Modify: `apps/core-api/internal/generation/store.go` (add `SQLStore.UpdateTemplateConfig`)
- Modify: `apps/core-api/internal/generation/handlers_test.go` (add `memoryRepository.UpdateTemplateConfig` fake + new test)

**Interfaces:**
- Consumes: `ApplyRoleClassification`, `RoleClassifier`, `needsRoleClassification` (Task 1, same package, `role_classification.go`).
- Produces: `Repository.UpdateTemplateConfig(ctx context.Context, id string, config json.RawMessage) error`. `service.template()`'s returned `templateData.Source` now carries `role` on every eligible object once classification has run — Task 5 depends on this.

- [ ] **Step 1: Write the failing test**

Add to `apps/core-api/internal/generation/handlers_test.go` (near `TestProcessGroundsBulletLevelGuidanceInTheTemplatesRealLevels`):

```go
// classifyingLLM adds ClassifyTemplateRoles on top of maliciousHTMLLLM's
// existing full LLM implementation, so it satisfies both LLM and (via the
// service.llm.(RoleClassifier) type assertion in template()) RoleClassifier.
type classifyingLLM struct {
	*maliciousHTMLLLM
	classifyCalls int
	roles         map[string]string
	classifyErr   error
}

func (llm *classifyingLLM) ClassifyTemplateRoles(_ context.Context, _ RoleClassificationRequest) (map[string]string, error) {
	llm.classifyCalls++
	if llm.classifyErr != nil {
		return nil, llm.classifyErr
	}
	return llm.roles, nil
}

func TestTemplateClassifiesAndPersistsRolesOnFirstUseThenReusesThem(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	repo.templates["pptx-template"] = memoryTemplate{
		public: true,
		config: json.RawMessage(`{"source":{"kind":"pptx","slides":[{"objects":[` +
			`{"id":"shape-1","kind":"text","fontSize":32,"text":"Heading"},` +
			`{"id":"shape-2","kind":"text","fontSize":14,"text":"Body"}` +
			`]}]}}`),
	}
	llm := &classifyingLLM{
		maliciousHTMLLLM: &maliciousHTMLLLM{},
		roles:            map[string]string{"shape-1": "title", "shape-2": "body"},
	}
	service := NewService(repo, llm, new(recordingQueue))
	templateID := "pptx-template"

	template, err := service.template(context.Background(), &templateID, "user-1")
	if err != nil {
		t.Fatalf("template() error = %v", err)
	}
	if llm.classifyCalls != 1 {
		t.Fatalf("classifyCalls = %d, want 1", llm.classifyCalls)
	}
	objects := template.objects(0)
	if objects[0]["role"] != "title" || objects[1]["role"] != "body" {
		t.Fatalf("objects roles = %v / %v, want title / body", objects[0]["role"], objects[1]["role"])
	}

	if _, err := service.template(context.Background(), &templateID, "user-1"); err != nil {
		t.Fatalf("template() second call error = %v", err)
	}
	if llm.classifyCalls != 1 {
		t.Fatalf("classifyCalls after second template() call = %d, want still 1 (persisted, not re-classified)", llm.classifyCalls)
	}
}

func TestTemplateLeavesTemplateUnclassifiedWhenClassificationFails(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	repo.templates["pptx-template"] = memoryTemplate{
		public: true,
		config: json.RawMessage(`{"source":{"kind":"pptx","slides":[{"objects":[` +
			`{"id":"shape-1","kind":"text","fontSize":32,"text":"Heading"}` +
			`]}]}}`),
	}
	llm := &classifyingLLM{maliciousHTMLLLM: &maliciousHTMLLLM{}, classifyErr: errors.New("LLM unavailable")}
	service := NewService(repo, llm, new(recordingQueue))
	templateID := "pptx-template"

	template, err := service.template(context.Background(), &templateID, "user-1")
	if err != nil {
		t.Fatalf("template() error = %v, want nil (classification failure must not fail template())", err)
	}
	if _, hasRole := template.objects(0)[0]["role"]; hasRole {
		t.Fatal("objects[0] has a role after a failed classification, want none")
	}
}
```

Add the `UpdateTemplateConfig` fake to `memoryRepository` (near `VisibleTemplateConfig` in `handlers_test.go`):

```go
func (repo *memoryRepository) UpdateTemplateConfig(_ context.Context, id string, config json.RawMessage) error {
	template, ok := repo.templates[id]
	if !ok {
		return errors.New("not found")
	}
	template.config = config
	repo.templates[id] = template
	return nil
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/core-api && go test ./internal/generation/... -run 'TestTemplateClassifiesAndPersistsRolesOnFirstUseThenReusesThem|TestTemplateLeavesTemplateUnclassifiedWhenClassificationFails' -v`
Expected: FAIL — compile error (`memoryRepository` does not implement `Repository`: `UpdateTemplateConfig` not yet in the interface, or `service.template()` doesn't classify).

- [ ] **Step 3: Implement**

In `apps/core-api/internal/generation/service.go`, add `UpdateTemplateConfig` to the `Repository` interface (`service.go:103-115`):

```go
type Repository interface {
	VisibleSkill(context.Context, string, string, *string) (Skill, error)
	VisibleTemplateConfig(context.Context, string, string) (json.RawMessage, error)
	UpdateTemplateConfig(context.Context, string, json.RawMessage) error
	CreateGeneration(context.Context, Presentation, Job) error
	GenerationJob(context.Context, string, string) (Job, error)
	SetGenerationStatus(context.Context, string, string, int, json.RawMessage) (bool, error)
	FailGeneration(context.Context, string, json.RawMessage) error
	CancelGeneration(context.Context, string, string) (bool, error)
	CompleteGeneration(context.Context, string, string, []Slide) error
	SlideForEdit(context.Context, string, string) (Slide, error)
	UpdateSlideContent(context.Context, string, json.RawMessage) (Slide, error)
	RecoverableGenerationIDs(context.Context) ([]string, error)
}
```

Replace `func (service *Service) template` (`service.go:571-589`) with:

```go
func (service *Service) template(ctx context.Context, id *string, userID string) (templateData, error) {
	if id == nil || *id == "" {
		return templateData{}, nil
	}
	raw, err := service.repo.VisibleTemplateConfig(ctx, *id, userID)
	if err != nil {
		return templateData{}, fmt.Errorf("%w: Template not found", ErrBadInput)
	}
	raw, err = contentsecurity.SanitizeTemplateConfig(raw)
	if err != nil {
		return templateData{}, fmt.Errorf("%w: Invalid template", ErrBadInput)
	}
	fields := rawObject(raw)
	htmlSlides := stringSlice(fields["htmlSlides"])
	source, _ := fields["source"].(map[string]any)
	if source["kind"] == "pptx" && needsRoleClassification(source) {
		service.classifyTemplateRoles(ctx, *id, fields, source)
	}
	return templateData{
		PPTX: source["kind"] == "pptx", HTMLSlides: htmlSlides, Source: source,
	}, nil
}

// classifyTemplateRoles runs role classification once for a PPTX template
// that has never been classified (needsRoleClassification), then persists
// the result so future calls skip straight past that check. A classifier
// unavailable on service.llm, or a classification error, is a silent no-op
// -- pptxObjectEdits' font-rank fallback (Task 5) covers a template that
// never gets classified.
func (service *Service) classifyTemplateRoles(ctx context.Context, id string, fields, source map[string]any) {
	classifier, ok := service.llm.(RoleClassifier)
	if !ok {
		return
	}
	classified, err := ApplyRoleClassification(ctx, classifier, source)
	if err != nil {
		return
	}
	fields["source"] = classified
	if encoded, err := json.Marshal(fields); err == nil {
		_ = service.repo.UpdateTemplateConfig(ctx, id, encoded)
	}
}
```

In `apps/core-api/internal/generation/store.go`, add (near `VisibleTemplateConfig`):

```go
func (store *SQLStore) UpdateTemplateConfig(ctx context.Context, id string, config json.RawMessage) error {
	_, err := store.db.Pool().Exec(ctx, `UPDATE "Template" SET "config"=$2,"updatedAt"=NOW() WHERE "id"=$1`, id, config)
	return err
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/core-api && go test ./internal/generation/... -run 'TestTemplateClassifiesAndPersistsRolesOnFirstUseThenReusesThem|TestTemplateLeavesTemplateUnclassifiedWhenClassificationFails' -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full package test suite and a full build**

Run: `cd apps/core-api && go build ./... && go test ./...`
Expected: PASS (`go build ./...` matters here: `store.go`'s `SQLStore` and any other `Repository` implementer must still satisfy the interface with the new method)

- [ ] **Step 6: Commit**

```bash
git add apps/core-api/internal/generation/service.go apps/core-api/internal/generation/store.go apps/core-api/internal/generation/handlers_test.go
git commit -m "feat(generation): classify and persist PPTX template roles on first use"
```

---

### Task 3: Classify new templates at import time

**Files:**
- Modify: `apps/core-api/internal/templates/handlers.go:31-39` (`Service` struct, `NewService`), `apps/core-api/internal/templates/handlers.go:229-273` (`importPPTX`)
- Modify: `apps/core-api/cmd/api/main.go:65-77` (construction order)

**Interfaces:**
- Consumes: `generation.RoleClassifier`, `generation.ApplyRoleClassification` (Task 1, exported from the `generation` package). `*generation.OpenAIClient` (constructed in `main.go`) already satisfies `generation.RoleClassifier` once Task 1 lands.
- Produces: `templates.NewService`'s signature gains a 4th parameter — no other package calls `templates.NewService` today except `main.go` (confirmed: only call site is `cmd/api/main.go:67`).

- [ ] **Step 1: Update the Service struct and constructor**

In `apps/core-api/internal/templates/handlers.go`, add the import and update the struct/constructor (`handlers.go:1-39`):

```go
import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/auth"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/contentsecurity"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/generation"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/httpjson"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/renderer"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/storagepath"
)

const maxTemplateBytes = 20 << 20

type Service struct {
	db       *db.Store
	renderer *renderer.Client
	root     string
	roles    generation.RoleClassifier
}

func NewService(store *db.Store, renderer *renderer.Client, root string, roles generation.RoleClassifier) *Service {
	return &Service{db: store, renderer: renderer, root: filepath.Clean(root), roles: roles}
}
```

- [ ] **Step 2: Call classification in importPPTX**

Replace the body of `importPPTX` (`handlers.go:229-273`) with:

```go
func (service *Service) importPPTX(writer http.ResponseWriter, request *http.Request) {
	file, header, fields, err := templateUpload(writer, request, ".pptx")
	if err != nil {
		writeError(writer, http.StatusBadRequest, "PPTX file up to 20MB required")
		return
	}
	var extracted struct {
		Config json.RawMessage `json:"config"`
	}
	if err := service.renderer.PostFile(
		request.Context(), "/api/extract/style", header.Filename,
		renderer.PPTXContentType, file, &extracted,
	); err != nil {
		writeRendererError(writer, err)
		return
	}
	if !validPPTXConfig(extracted.Config) {
		writeError(writer, http.StatusBadRequest, "Invalid renderer template config")
		return
	}
	key, err := service.storeTemplateFile(header.Filename, file)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "Could not store template")
		return
	}
	config := rawObject(extracted.Config)
	source, _ := config["source"].(map[string]any)
	if source == nil {
		source = map[string]any{"kind": "pptx"}
	}
	source["storageKey"] = key
	if classified, classifyErr := generation.ApplyRoleClassification(request.Context(), service.roles, source); classifyErr == nil {
		source = classified
	}
	config["source"] = source
	config["pptxTemplate"] = map[string]any{"storageKey": key, "originalname": header.Filename}
	configRaw, _ := json.Marshal(config)
	input := templateInput{
		Name: fields["name"], Description: pointer(fields["description"]),
		Category: defaultString(fields["category"], "CUSTOM"), Config: configRaw,
		IsPublic: strings.EqualFold(fields["isPublic"], "true"), OrganizationID: pointer(fields["organizationId"]),
	}
	raw, err := service.createTemplate(request.Context(), input)
	if err != nil {
		service.removeTemplateFile(key)
	}
	writeRaw(writer, raw, http.StatusCreated, err)
}
```

(Only the four new lines calling `generation.ApplyRoleClassification` are new; everything else in this function is unchanged from today.)

- [ ] **Step 3: Reorder construction in main.go**

In `apps/core-api/cmd/api/main.go`, move `templateService`'s construction after `llmClient` and pass it in (`main.go:65-77`):

```go
	client := &http.Client{Timeout: 30 * time.Second}
	rendererClient := renderer.New(cfg.RendererURL, &http.Client{Timeout: 180 * time.Second})
	generationStore := generation.NewSQLStore(store)
	generationQueue := generation.NewRedisQueue(store.Redis())
	llmPolicy, err := outboundpolicy.New(cfg.AllowedLLMEndpoints, cfg.AllowedLLMAPIKeyEnvVars)
	if err != nil {
		return err
	}
	llmClient := generation.NewOpenAIClient(generationStore, &http.Client{Timeout: 5 * time.Minute}, generation.EnvironmentModel{
		BaseURL: cfg.OpenAIBaseURL, APIKey: cfg.OpenAIAPIKey, Model: cfg.OpenAIModel, MaxTokens: cfg.OpenAIMaxTokens,
	}, llmPolicy)
	templateService := templates.NewService(store, rendererClient, cfg.LocalStoragePath, llmClient)
	generationService := generation.NewService(generationStore, llmClient, generationQueue)
	go generationService.Run(signalContext)
```

- [ ] **Step 4: Build the whole module**

Run: `cd apps/core-api && go build ./...`
Expected: builds cleanly. There is no existing test file for the `templates` package (`apps/core-api/internal/templates/*_test.go` — none exist today), so this task adds no new Go test file; `generation.ApplyRoleClassification`/`RoleClassifier` are already unit-tested in Task 1, and the two-line call added here is proven end-to-end by Task 6's manual verification (upload a real template, confirm its stored `config` carries `role` fields).

- [ ] **Step 5: Commit**

```bash
git add apps/core-api/internal/templates/handlers.go apps/core-api/cmd/api/main.go
git commit -m "feat(templates): classify PPTX template roles at import time"
```

---

### Task 4: Ground the generation prompt in each slide's requested roles

**Files:**
- Modify: `apps/core-api/internal/generation/service.go:139-152` (`SlideRequest`), `apps/core-api/internal/generation/service.go:377-386` (`Process()`'s per-slide loop)
- Create: `apps/core-api/internal/generation/roles.go` (only `requestedGenerativeRoles` in this task; `pptxObjectEdits`'s rewrite is Task 5)
- Modify: `apps/core-api/internal/generation/llm.go:776-803` (`slidePrompt`), `apps/core-api/internal/generation/llm.go:406-470` (`parseSlideContent`)
- Create: `apps/core-api/internal/generation/roles_test.go`
- Modify: `apps/core-api/internal/generation/llm_test.go`

**Interfaces:**
- Consumes: `object["role"]` set by Task 1/2/3's classification (falls back to no requested roles when absent, which is always safe — `slidePrompt` already handles `RequestedRoles == nil`).
- Produces: `SlideRequest.RequestedRoles []string`, `func requestedGenerativeRoles(objects []map[string]any) []string`, `parseSlideContent` now also emits `date`/`kpiValue` fields in its returned JSON when the model provides them. Task 5's `roleContent` construction reads `fields["subheading"]`/`fields["date"]`/`fields["kpiValue"]`.

- [ ] **Step 1: Write the failing tests**

Create `apps/core-api/internal/generation/roles_test.go`:

```go
package generation

import "testing"

func TestRequestedGenerativeRolesReturnsSortedDistinctRoles(t *testing.T) {
	objects := []map[string]any{
		{"id": "a", "kind": "text", "role": "kpi"},
		{"id": "b", "kind": "text", "role": "date"},
		{"id": "c", "kind": "text", "role": "kpi"}, // duplicate role, must not repeat
		{"id": "d", "kind": "text", "role": "title"},
		{"id": "e", "kind": "table", "role": "body"},
	}

	got := requestedGenerativeRoles(objects)

	want := []string{"date", "kpi"}
	if len(got) != len(want) {
		t.Fatalf("requestedGenerativeRoles() = %v, want %v", got, want)
	}
	for index, role := range want {
		if got[index] != role {
			t.Fatalf("requestedGenerativeRoles() = %v, want %v", got, want)
		}
	}
}

func TestRequestedGenerativeRolesReturnsNilWhenNoneOfTheThreeRolesArePresent(t *testing.T) {
	objects := []map[string]any{
		{"id": "a", "kind": "text", "role": "title"},
		{"id": "b", "kind": "text", "role": "body"},
		{"id": "c", "kind": "text", "role": "static"},
	}
	if got := requestedGenerativeRoles(objects); got != nil {
		t.Fatalf("requestedGenerativeRoles() = %v, want nil", got)
	}
}
```

Add to `apps/core-api/internal/generation/llm_test.go` (near `TestSlidePromptUsesAvailableLevelsWhenPresent`):

```go
func TestSlidePromptRequestsSubtitleDateAndKPIOnlyWhenRequested(t *testing.T) {
	withRoles := slidePrompt(SlideRequest{Title: "T", Type: "CONTENT", RequestedRoles: []string{"date", "kpi", "subtitle"}})
	for _, want := range []string{"subheading", "\"date\"", "kpiValue"} {
		if !strings.Contains(withRoles, want) {
			t.Fatalf("slidePrompt() with RequestedRoles = %q, want it to mention %q", withRoles, want)
		}
	}

	withoutRoles := slidePrompt(SlideRequest{Title: "T", Type: "CONTENT"})
	for _, notWanted := range []string{"date box", "highlighted metric box", "subtitle box"} {
		if strings.Contains(withoutRoles, notWanted) {
			t.Fatalf("slidePrompt() without RequestedRoles = %q, should not mention %q", withoutRoles, notWanted)
		}
	}
}

func TestParseSlideContentPassesThroughDateAndKPIValue(t *testing.T) {
	raw, err := parseSlideContent(json.RawMessage(`{"heading":"Q3","date":"2026.08.03","kpiValue":"32%"}`), "CONTENT")
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	if value["date"] != "2026.08.03" {
		t.Fatalf("date = %v, want 2026.08.03", value["date"])
	}
	if value["kpiValue"] != "32%" {
		t.Fatalf("kpiValue = %v, want 32%%", value["kpiValue"])
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/core-api && go test ./internal/generation/... -run 'TestRequestedGenerativeRoles|TestSlidePromptRequestsSubtitleDateAndKPIOnlyWhenRequested|TestParseSlideContentPassesThroughDateAndKPIValue' -v`
Expected: FAIL — `undefined: requestedGenerativeRoles`, and the prompt/parse assertions fail against today's behavior.

- [ ] **Step 3: Implement**

Create `apps/core-api/internal/generation/roles.go` with just the role-request helper for now (Task 5 adds the rest of this file):

```go
package generation

import "sort"

// requestedGenerativeRoles returns the sorted, de-duplicated set of
// subtitle/date/kpi roles actually present among a slide's template
// objects, so slidePrompt only asks the model for fields this specific
// slide's template can actually use. title/body are always requested by
// slidePrompt regardless of role data, so they are not included here.
func requestedGenerativeRoles(objects []map[string]any) []string {
	seen := map[string]bool{}
	for _, object := range objects {
		role, _ := object["role"].(string)
		if role == "subtitle" || role == "date" || role == "kpi" {
			seen[role] = true
		}
	}
	if len(seen) == 0 {
		return nil
	}
	result := make([]string, 0, len(seen))
	for role := range seen {
		result = append(result, role)
	}
	sort.Strings(result)
	return result
}
```

In `apps/core-api/internal/generation/service.go`, add the field to `SlideRequest` (`service.go:139-152`):

```go
type SlideRequest struct {
	Title, Type, Language string
	KeyPoints             []string
	// SkillGuidance is the same per-skill outlineGuidance text the outline
	// call already receives — a PPTX-imported skill's guidance can include a
	// concrete bullet-hierarchy example (see bulletHierarchyExample in the
	// skills package), which only helps if the per-slide content call that
	// actually produces bullet levels sees it too.
	SkillGuidance string
	// AvailableLevels is the sorted set of indentation levels this slide's
	// destination template objects actually support — empty for non-PPTX
	// slides, where slidePrompt falls back to a generic 0-4 range.
	AvailableLevels []int
	// RequestedRoles is the sorted set of subtitle/date/kpi roles this
	// slide's destination template objects actually carry (see
	// requestedGenerativeRoles) — empty when the template has none of
	// these, in which case slidePrompt asks for none of them.
	RequestedRoles []string
}
```

In `apps/core-api/internal/generation/service.go`'s `Process()` (`service.go:377-386`), compute and thread it through:

```go
	for index, item := range outline.Slides {
		templateIndex := chooseTemplateIndex(item.TemplateIndex, index, capable)
		var levels []int
		var requestedRoles []string
		if template.PPTX && templateIndex >= 0 {
			objects := template.objects(templateIndex)
			levels = availableLevels(objects)
			requestedRoles = requestedGenerativeRoles(objects)
		}
		rawContent, contentErr := service.llm.SlideContent(ctx, SlideRequest{
			Title: item.Title, Type: item.Type, Language: input.Language, KeyPoints: item.KeyPoints,
			SkillGuidance: input.SkillGuidance, AvailableLevels: levels, RequestedRoles: requestedRoles,
		})
```

In `apps/core-api/internal/generation/llm.go`, update `slidePrompt` (`llm.go:776-803`):

```go
func slidePrompt(input SlideRequest) string {
	guidance := ""
	if strings.TrimSpace(input.SkillGuidance) != "" {
		guidance = "\n\n[Writing Skill Guide]\n" + input.SkillGuidance
	}
	levelGuidance := "level 0-4 for indentation"
	if len(input.AvailableLevels) > 0 {
		parts := make([]string, len(input.AvailableLevels))
		for i, level := range input.AvailableLevels {
			parts[i] = strconv.Itoa(level)
		}
		levelGuidance = fmt.Sprintf("level — only these values are usable in this template: %s", strings.Join(parts, ", "))
	}
	roleGuidance := roleFieldGuidance(input.RequestedRoles)
	return fmt.Sprintf(
		"Create concise slide content in %s. Title: %s. Type: %s. Key points: %s. "+
			"Return JSON only with heading, optional subheading/body, 3-5 bullets "+
			"(each an object with text and %s), "+
			"chart for CHART as {\"labels\":[\"...\"],\"values\":[0]}, "+
			"table for TABLE as {\"headers\":[\"...\"],\"rows\":[[\"...\"]]}, "+
			"columns for TWO_COLUMN as exactly two {\"header\":\"...\",\"bullets\":[{\"text\":\"...\",\"level\":0}]} objects, "+
			"timeline for TIMELINE as {\"items\":[{\"date\":\"...\",\"label\":\"...\",\"description\":\"...\"}]} with 3-8 items, "+
			"process for PROCESS as {\"steps\":[{\"label\":\"...\",\"description\":\"...\"}]} with 2-6 steps, "+
			"comparison for COMPARISON as {\"left\":{\"title\":\"...\",\"bullets\":[\"...\"]},\"right\":{\"title\":\"...\",\"bullets\":[\"...\"]}}, "+
			"and metrics for KPI as {\"metrics\":[{\"value\":\"...\",\"label\":\"...\"}]} with 2-6 cards. "+
			"Do not write bullet characters (-, •) as literal text in the bullet text — the template already draws them.%s%s%s",
		input.Language, input.Title, input.Type, strings.Join(input.KeyPoints, "; "), levelGuidance, dateGuidance(), guidance, roleGuidance,
	)
}

// roleFieldGuidance appends explicit instructions for the extra fields this
// slide's destination template can actually use (subheading/date/
// kpiValue), computed from RequestedRoles so slides without a matching
// template shape are never asked to invent one.
func roleFieldGuidance(requestedRoles []string) string {
	var extra []string
	for _, role := range requestedRoles {
		switch role {
		case "subtitle":
			extra = append(extra, "This slide's template has a subtitle box: always include a concise \"subheading\" (one line).")
		case "date":
			extra = append(extra, "This slide's template has a date box: include a \"date\" field using one of the computed dates above.")
		case "kpi":
			extra = append(extra, "This slide's template has a highlighted metric box: include a \"kpiValue\" field with one short number/metric string relevant to the content.")
		}
	}
	if len(extra) == 0 {
		return ""
	}
	return " " + strings.Join(extra, " ")
}
```

In `apps/core-api/internal/generation/llm.go`'s `parseSlideContent` (`llm.go:406-470`), extend the pass-through field loop:

```go
	result := map[string]any{"heading": heading}
	for _, field := range []string{"subheading", "body", "date", "kpiValue"} {
		if text, ok := value[field].(string); ok && strings.TrimSpace(text) != "" {
			result[field] = text
		}
	}
```

(Only that one line's field list changed — the rest of `parseSlideContent` is untouched.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/core-api && go test ./internal/generation/... -run 'TestRequestedGenerativeRoles|TestSlidePromptRequestsSubtitleDateAndKPIOnlyWhenRequested|TestParseSlideContentPassesThroughDateAndKPIValue' -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full package test suite**

Run: `cd apps/core-api && go test ./internal/generation/...`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/core-api/internal/generation/roles.go apps/core-api/internal/generation/roles_test.go apps/core-api/internal/generation/service.go apps/core-api/internal/generation/llm.go apps/core-api/internal/generation/llm_test.go
git commit -m "feat(generation): ground subtitle/date/kpi prompt fields in the template's requested roles"
```

---

### Task 5: Role-aware pptxObjectEdits

**Files:**
- Modify: `apps/core-api/internal/generation/roles.go` (add the role-aware assignment logic, from Task 4)
- Modify: `apps/core-api/internal/generation/service.go:377-406` (`Process()`'s call site), `apps/core-api/internal/generation/service.go:672-717` (remove the old `pptxObjectEdits`, now moved)
- Create: `apps/core-api/internal/generation/roles_test.go` additions (same file Task 4 created)

**Interfaces:**
- Consumes: `object["role"]` (Task 1/2/3), `fields["subheading"]`/`fields["date"]`/`fields["kpiValue"]` (Task 4's `parseSlideContent`).
- Produces: `pptxObjectEdits(objects []map[string]any, slide int, content roleContent) []map[string]any` — signature changes from today's `(objects, slide, title string, lines []contentLine)`. `type roleContent struct{ Title, Subtitle, Date, KPI string; Lines []contentLine }`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/core-api/internal/generation/roles_test.go`:

```go
func TestPptxObjectEditsFallsBackToLegacyWhenNoRoleData(t *testing.T) {
	objects := []map[string]any{
		{"id": "small", "kind": "text", "fontSize": 14.0},
		{"id": "big", "kind": "text", "fontSize": 32.0},
	}
	content := roleContent{Title: "Title", Lines: []contentLine{{Text: "Body line"}}}

	got := pptxObjectEdits(objects, 0, content)
	want := legacyPptxObjectEdits(objects, 0, content.Title, content.Lines)

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("pptxObjectEdits() with no role data = %v, want it to equal legacyPptxObjectEdits() = %v", got, want)
	}
}

func TestPptxObjectEditsExcludesStaticObjects(t *testing.T) {
	objects := []map[string]any{
		{"id": "title-shape", "kind": "text", "role": "title"},
		{"id": "footer-shape", "kind": "text", "role": "static", "text": "Confidential"},
		{"id": "legend-table", "kind": "table", "role": "static", "cells": []any{[]any{"A"}}},
	}
	content := roleContent{Title: "Q3 Results"}

	edits := pptxObjectEdits(objects, 0, content)

	if len(edits) != 1 {
		t.Fatalf("edits = %v, want exactly 1 (only the title shape, static shapes excluded)", edits)
	}
	if edits[0]["objectId"] != "title-shape" {
		t.Fatalf("edits[0][objectId] = %v, want title-shape", edits[0]["objectId"])
	}
}

func TestPptxObjectEditsAssignsSingleValueRoles(t *testing.T) {
	objects := []map[string]any{
		{"id": "title-shape", "kind": "text", "role": "title"},
		{"id": "subtitle-shape", "kind": "text", "role": "subtitle"},
		{"id": "date-shape", "kind": "text", "role": "date"},
		{"id": "kpi-shape", "kind": "text", "role": "kpi"},
	}
	content := roleContent{Title: "Q3 Results", Subtitle: "Board Review", Date: "2026.08.03", KPI: "32%"}

	edits := pptxObjectEdits(objects, 0, content)

	byID := map[string]any{}
	for _, edit := range edits {
		byID[edit["objectId"].(string)] = edit["text"]
	}
	if byID["title-shape"] != "Q3 Results" || byID["subtitle-shape"] != "Board Review" ||
		byID["date-shape"] != "2026.08.03" || byID["kpi-shape"] != "32%" {
		t.Fatalf("edits by objectId->text = %v, want each shape to get its matching role's value", byID)
	}
}

func TestPptxObjectEditsBroadcastsSameRoleToMultipleObjects(t *testing.T) {
	objects := []map[string]any{
		{"id": "kpi-left", "kind": "text", "role": "kpi"},
		{"id": "kpi-right", "kind": "text", "role": "kpi"},
	}
	content := roleContent{Title: "T", KPI: "1,204건"}

	edits := pptxObjectEdits(objects, 0, content)

	if len(edits) != 2 || edits[0]["text"] != "1,204건" || edits[1]["text"] != "1,204건" {
		t.Fatalf("edits = %v, want both kpi shapes to receive the same broadcast value", edits)
	}
}

func TestPptxObjectEditsFillsBodyTextAndTable(t *testing.T) {
	objects := []map[string]any{
		{"id": "body-shape", "kind": "text", "role": "body"},
		{"id": "data-table", "kind": "table", "role": "body", "cells": []any{[]any{""}}},
	}
	content := roleContent{Title: "T", Lines: []contentLine{{Text: "Point one"}, {Text: "Point two", Level: 1}}}

	edits := pptxObjectEdits(objects, 0, content)

	var sawParagraphs, sawCells bool
	for _, edit := range edits {
		if edit["objectId"] == "body-shape" {
			if _, ok := edit["paragraphs"]; ok {
				sawParagraphs = true
			}
		}
		if edit["objectId"] == "data-table" {
			if _, ok := edit["cells"]; ok {
				sawCells = true
			}
		}
	}
	if !sawParagraphs || !sawCells {
		t.Fatalf("edits = %v, want a paragraphs edit for body-shape and a cells edit for data-table", edits)
	}
}

func TestPptxObjectEditsSynthesizesTextBoxWhenEveryObjectIsStatic(t *testing.T) {
	objects := []map[string]any{
		{"id": "logo", "kind": "text", "role": "static"},
	}
	content := roleContent{Title: "Only Title", Lines: []contentLine{{Text: "Only Body"}}}

	edits := pptxObjectEdits(objects, 3, content)

	if len(edits) != 1 || edits[0]["objectId"] != "generated-title-3" {
		t.Fatalf("edits = %v, want a single synthesized generated-title-3 edit", edits)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/core-api && go test ./internal/generation/... -run 'TestPptxObjectEdits' -v`
Expected: FAIL — `pptxObjectEdits` still has the old 4-argument signature (compile error), and `legacyPptxObjectEdits`/`roleContent` don't exist yet.

- [ ] **Step 3: Implement**

Remove the old `pptxObjectEdits` function entirely from `apps/core-api/internal/generation/service.go` (delete lines `672-717`, the whole function from `func pptxObjectEdits(objects []map[string]any, slide int, title string, lines []contentLine) []map[string]any {` through its closing `}`). `contentLine`, `paragraphsFromLines`, `populateCells`, `isTableLabel`, and `slideLines` all stay in `service.go` unchanged — they're shared by both the legacy and role-aware paths.

Append to `apps/core-api/internal/generation/roles.go` (which already has `requestedGenerativeRoles` from Task 4):

```go
// roleContent is the generated per-slide values pptxObjectEdits assigns to
// template objects by role, replacing the old font-size-rank guess.
// Title/Lines are always populated (as before); Subtitle/Date/KPI are
// empty unless that slide's template actually has a matching-role object
// (see requestedGenerativeRoles) and the model provided a value for it.
type roleContent struct {
	Title, Subtitle, Date, KPI string
	Lines                      []contentLine
}

// pptxObjectEdits assigns generated content to a PPTX template slide's
// objects. If none of the slide's objects have ever been role-classified,
// it defers entirely to legacyPptxObjectEdits so behavior is unchanged
// while classification is pending or unavailable (see anyObjectHasRole).
func pptxObjectEdits(objects []map[string]any, slide int, content roleContent) []map[string]any {
	if !anyObjectHasRole(objects) {
		return legacyPptxObjectEdits(objects, slide, content.Title, content.Lines)
	}
	return rolePptxObjectEdits(objects, slide, content)
}

// anyObjectHasRole reports whether template role classification has ever
// run for this slide's objects. A classified template always tags every
// eligible object with a non-empty role (mergeTemplateRoles defaults
// unclassified-but-eligible objects to "static"), so "zero objects have a
// role" means classification hasn't happened yet or failed.
func anyObjectHasRole(objects []map[string]any) bool {
	for _, object := range objects {
		if role, ok := object["role"].(string); ok && role != "" {
			return true
		}
	}
	return false
}

// rolePptxObjectEdits assigns generated content by each object's classified
// role instead of guessing from font size. static objects (text or table)
// are never touched, so the template's own date/footer/decorative content
// survives untouched. Multiple objects sharing a generative role all
// receive the same value (broadcast) — see the design doc's "범위 밖"
// section for why per-instance values are out of scope.
func rolePptxObjectEdits(objects []map[string]any, slide int, content roleContent) []map[string]any {
	singleValues := map[string]string{
		"title": content.Title, "subtitle": content.Subtitle,
		"date": content.Date, "kpi": content.KPI,
	}
	var edits []map[string]any
	for _, object := range objects {
		role, _ := object["role"].(string)
		if role == "static" {
			continue
		}
		switch object["kind"] {
		case "table":
			if role == "body" {
				edits = append(edits, map[string]any{
					"objectId": object["id"], "slide": slide,
					"cells": populateCells(object["cells"], content.Lines),
				})
			}
		case "text":
			if role == "body" {
				edits = append(edits, map[string]any{
					"objectId": object["id"], "slide": slide, "paragraphs": paragraphsFromLines(content.Lines),
				})
				continue
			}
			if value, known := singleValues[role]; known && strings.TrimSpace(value) != "" {
				edits = append(edits, map[string]any{
					"objectId": object["id"], "slide": slide, "text": value,
				})
			}
		}
	}
	if len(edits) == 0 {
		edits = append(edits, syntheticTitleEdit(slide, content.Title, content.Lines))
	}
	return edits
}

// legacyPptxObjectEdits is the original font-size-rank assignment, kept
// verbatim for slides/templates whose objects have never been role-
// classified (see anyObjectHasRole) so behavior does not regress while
// classification is pending or unavailable.
func legacyPptxObjectEdits(objects []map[string]any, slide int, title string, lines []contentLine) []map[string]any {
	var texts, tables []map[string]any
	for _, object := range objects {
		switch object["kind"] {
		case "text":
			texts = append(texts, object)
		case "table":
			tables = append(tables, object)
		}
	}
	sort.SliceStable(texts, func(i, j int) bool { return number(texts[i]["fontSize"]) > number(texts[j]["fontSize"]) })
	var edits []map[string]any
	textLimit := min(len(texts), 2)
	if len(tables) > 0 {
		textLimit = min(len(texts), 1)
	}
	for index := 0; index < textLimit; index++ {
		if index == 0 {
			edits = append(edits, map[string]any{
				"objectId": texts[index]["id"], "slide": slide, "text": title,
			})
			continue
		}
		edits = append(edits, map[string]any{
			"objectId": texts[index]["id"], "slide": slide, "paragraphs": paragraphsFromLines(lines),
		})
	}
	for _, table := range tables {
		edits = append(edits, map[string]any{
			"objectId": table["id"], "slide": slide,
			"cells": populateCells(table["cells"], lines),
		})
	}
	if len(edits) == 0 {
		edits = append(edits, syntheticTitleEdit(slide, title, lines))
	}
	return edits
}

// syntheticTitleEdit synthesizes a plain text box when a template slide has
// no editable text/table objects at all (e.g. an image-only layout, or a
// slide where every object is classified static), so the slide never
// comes out completely blank.
func syntheticTitleEdit(slide int, title string, lines []contentLine) map[string]any {
	texts := make([]string, len(lines))
	for index, line := range lines {
		texts[index] = line.Text
	}
	return map[string]any{
		"objectId": fmt.Sprintf("generated-title-%d", slide), "slide": slide,
		"kind": "text", "addText": title, "text": strings.Join(append([]string{title}, texts...), "\n"),
		"left": 140, "top": 120, "width": 1640, "height": 560, "fontSize": 34, "color": "#1A1A1A",
	}
}
```

`roles.go` now needs `"fmt"`, `"sort"`, and `"strings"` imported at its top:

```go
package generation

import (
	"fmt"
	"sort"
	"strings"
)
```

In `apps/core-api/internal/generation/service.go`'s `Process()`, update the call site (`service.go:399-405`):

```go
		fields := rawObject(rawContent)
		if templateIndex >= 0 {
			fields["templateIndex"] = templateIndex
		}
		if template.PPTX && templateIndex >= 0 {
			subtitle, _ := fields["subheading"].(string)
			date, _ := fields["date"].(string)
			kpi, _ := fields["kpiValue"].(string)
			fields["objectEdits"] = pptxObjectEdits(
				template.objects(templateIndex), templateIndex, roleContent{
					Title: item.Title, Subtitle: subtitle, Date: date, KPI: kpi,
					Lines: slideLines(fields, item.KeyPoints),
				},
			)
		} else if templateIndex >= 0 && templateIndex < len(template.HTMLSlides) {
```

(Only the `if template.PPTX && templateIndex >= 0 { ... }` block's body changed; the surrounding `else if` and everything else in `Process()` is untouched.)

Add `"reflect"` to `apps/core-api/internal/generation/roles_test.go`'s imports (used by `TestPptxObjectEditsFallsBackToLegacyWhenNoRoleData`):

```go
package generation

import (
	"reflect"
	"testing"
)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/core-api && go test ./internal/generation/... -run 'TestPptxObjectEdits' -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Run the full package test suite and a full build**

Run: `cd apps/core-api && go build ./... && go test ./...`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/core-api/internal/generation/roles.go apps/core-api/internal/generation/roles_test.go apps/core-api/internal/generation/service.go
git commit -m "feat(generation): make pptxObjectEdits role-aware with a font-rank fallback"
```

---

### Task 6: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Rebuild and restart the local stack**

```bash
docker compose -p jaslide-try build core-api web renderer
docker compose -p jaslide-try up -d --no-deps core-api web renderer
```

- [ ] **Step 2: Re-upload a real fill-in-report template**

Using a template whose layout has a date box and/or a highlighted-metric box that is NOT the largest or second-largest font on the slide (the exact condition that causes today's font-rank bug), import it fresh via the admin PPTX import UI. Confirm via a direct DB query that its stored `config.source.slides[].objects[]` now carry a `role` field:

```bash
docker exec -it jaslide-try-postgres-1 psql -U jaslide -d jaslide -c \
  "SELECT config->'source'->'slides'->0->'objects' FROM \"Template\" WHERE name = '<template name>';"
```

Expected: every text/table object in the JSON has a `"role"` key, one of `title`/`subtitle`/`body`/`date`/`kpi`/`static`.

- [ ] **Step 2: Generate a deck and inspect the exported PPTX**

Run a real generation against this template through the local LLM stack (LM Studio, as in the prior bullet-level-fidelity manual verification). Export the resulting presentation to PPTX and inspect it:

- The date/subtitle/KPI shapes (previously at risk of being overwritten by the font-rank heuristic) now either keep the template's original content (if classified `static`) or show new, plausible generated content sized to fit that shape's role (if classified `date`/`subtitle`/`kpi`) — not the full generated body/bullet text.
- The title still lands in the title shape, and the body/bullets still land correctly (regression check against the pre-existing behavior for a template with a plain title+body layout).

- [ ] **Step 3: Confirm the font-rank fallback still works for an unclassified/legacy template**

Using a template that predates this feature (or by manually clearing the `role` keys from a test template's stored config via a direct SQL `UPDATE`), generate a slide against it and confirm the behavior matches the pre-existing font-rank assignment (title in the largest-font shape, body/bullets in the second-largest) — proving `legacyPptxObjectEdits`'s fallback path is truly reachable and correct in production, not just in unit tests.

- [ ] **Step 4: Record the outcome**

No commit needed for this task (verification only) — report the findings (screenshots or exported PPTX XML excerpts showing `role`-driven placement) when handing this plan off for final review.
