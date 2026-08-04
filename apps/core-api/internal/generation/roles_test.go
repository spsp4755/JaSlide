package generation

import (
	"reflect"
	"testing"
)

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
