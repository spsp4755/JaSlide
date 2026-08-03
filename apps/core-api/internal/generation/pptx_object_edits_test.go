package generation

import "testing"

// A PPTX-template ("skill") generation edits an existing table cell by
// joining generated lines with "\n" into a single string. That string alone
// carries no per-line indentation, so a multi-level bulleted list ("•" top
// level, "-" sub-items) always rendered flat — in both the exported
// PPTX/PDF and the editor's scene preview. These tests pin the fix: bullet
// levels must survive as a structured {paragraphs: [...]} edit, the same
// shape _apply_native_edit (pptx_generator.py) and apply_edits_to_scene
// (pptx_scene.py) already understand.

func TestSlideLinesPreservesBulletLevels(t *testing.T) {
	fields := map[string]any{
		"bullets": []any{
			map[string]any{"text": "IT 운영 및 AI 연구", "level": float64(0)},
			map[string]any{"text": "프로젝트 관리 및 지원", "level": float64(1)},
			map[string]any{"text": "NL2SQL", "level": float64(1)},
		},
	}

	lines := slideLines(fields, nil)

	want := []contentLine{
		{Text: "IT 운영 및 AI 연구", Level: 0},
		{Text: "프로젝트 관리 및 지원", Level: 1},
		{Text: "NL2SQL", Level: 1},
	}
	if len(lines) != len(want) {
		t.Fatalf("slideLines() = %#v, want %#v", lines, want)
	}
	for index, line := range lines {
		if line != want[index] {
			t.Fatalf("slideLines()[%d] = %#v, want %#v", index, line, want[index])
		}
	}
}

func TestSlideLinesFallsBackToKeyPointsAtLevelZero(t *testing.T) {
	lines := slideLines(map[string]any{}, []string{"a", "b"})

	want := []contentLine{{Text: "a"}, {Text: "b"}}
	if len(lines) != len(want) || lines[0] != want[0] || lines[1] != want[1] {
		t.Fatalf("slideLines() = %#v, want %#v", lines, want)
	}
}

func TestPopulateCellsWritesStructuredParagraphsIntoNonLabelCells(t *testing.T) {
	raw := []any{
		[]any{"추진실적", "추진계획"},   // header row — both cells are labels, left untouched
		[]any{"이번 주 요약", ""}, // short body placeholder is itself a label (unchanged); only the empty cell is a slot
	}
	lines := []contentLine{
		{Text: "IT 운영 및 AI 연구", Level: 0},
		{Text: "프로젝트 관리 및 지원", Level: 1},
		{Text: "NL2SQL", Level: 1},
	}

	cells := populateCells(raw, lines)

	if cells[0][0] != "추진실적" || cells[0][1] != "추진계획" {
		t.Fatalf("header row = %#v, want labels left unchanged", cells[0])
	}
	if cells[1][0] != "이번 주 요약" {
		t.Fatalf("cells[1][0] = %#v, want the label-like placeholder left unchanged", cells[1][0])
	}
	populated, ok := cells[1][1].(map[string]any)
	if !ok {
		t.Fatalf("cells[1][1] = %#v (%T), want a structured {paragraphs: [...]} edit", cells[1][1], cells[1][1])
	}
	paragraphs, ok := populated["paragraphs"].([]map[string]any)
	if !ok || len(paragraphs) != 3 {
		t.Fatalf("paragraphs = %#v, want 3 leveled paragraphs", populated["paragraphs"])
	}
	if paragraphs[0]["level"] != 0 || paragraphs[1]["level"] != 1 || paragraphs[2]["level"] != 1 {
		t.Fatalf("paragraph levels = %v/%v/%v, want 0/1/1", paragraphs[0]["level"], paragraphs[1]["level"], paragraphs[2]["level"])
	}
	firstRun := paragraphs[0]["runs"].([]map[string]any)[0]
	if firstRun["text"] != "IT 운영 및 AI 연구" {
		t.Fatalf("first run text = %#v, want the first line", firstRun["text"])
	}
}

func TestPptxObjectEditsBuildsAStructuredCellEditWhenATableIsPresent(t *testing.T) {
	objects := []map[string]any{
		{"kind": "text", "id": "6", "fontSize": float64(22)},
		{"kind": "table", "id": "14", "cells": []any{
			[]any{"추진실적", "추진계획"},
			[]any{"이번 주 요약", ""},
		}},
	}
	lines := []contentLine{
		{Text: "IT 운영 및 AI 연구", Level: 0},
		{Text: "프로젝트 관리 및 지원", Level: 1},
	}

	edits := pptxObjectEdits(objects, 0, roleContent{Title: "0730 업무보고", Lines: lines})

	if len(edits) != 2 {
		t.Fatalf("edits = %#v, want exactly a title edit and a table edit", edits)
	}
	titleEdit := edits[0]
	if titleEdit["objectId"] != "6" || titleEdit["text"] != "0730 업무보고" {
		t.Fatalf("title edit = %#v, want the plain title text on shape 6", titleEdit)
	}
	tableEdit := edits[1]
	if tableEdit["objectId"] != "14" {
		t.Fatalf("table edit objectId = %#v, want 14", tableEdit["objectId"])
	}
	cells, ok := tableEdit["cells"].([][]any)
	if !ok {
		t.Fatalf("cells = %#v (%T), want [][]any", tableEdit["cells"], tableEdit["cells"])
	}
	populated, ok := cells[1][1].(map[string]any)
	if !ok {
		t.Fatalf("cells[1][1] = %#v, want a structured paragraph edit carrying the bullet levels", cells[1][1])
	}
	if _, ok := populated["paragraphs"]; !ok {
		t.Fatalf("populated cell = %#v, missing paragraphs", populated)
	}
}
