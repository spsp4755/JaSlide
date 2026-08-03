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
	ID, Kind, SampleText               string
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
	if classifier == nil {
		return source, nil
	}
	slides := buildRoleObjects(source)
	if len(slides) == 0 {
		return source, nil
	}
	roles, err := classifier.ClassifyTemplateRoles(ctx, RoleClassificationRequest{Slides: slides})
	if err != nil {
		return source, err
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
