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
			"shape-1":       "title",      // valid, text
			"shape-2":       "kpi",        // invalid: table can't be kpi
			"shape-3":       "not-a-role", // invalid: not in the closed vocabulary
			"shape-4":       "static",     // valid, table
			"unknown-shape": "title",      // invalid: id not in the request
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
