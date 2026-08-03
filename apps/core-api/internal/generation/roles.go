package generation

import (
	"fmt"
	"sort"
	"strings"
)

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
