package generation

import "sort"

// availableLevels returns the sorted union of indentation levels actually
// present across a slide's text and table objects, so slidePrompt can tell
// the model exactly which levels this specific template slide supports
// instead of a blanket 0-4 range. Mirrors the skills package's
// hierarchyLinesFrom in spirit (same source shape: object["paragraphs"] for
// text, object["cellParagraphs"] rows-of-cells-of-paragraphs for tables) but
// is defined locally — generation does not import skills, matching the
// existing precedent of the two packages each having their own
// level-carrying line type (skills.hierarchyLine vs generation.contentLine).
func availableLevels(objects []map[string]any) []int {
	seen := map[int]bool{}
	for _, object := range objects {
		switch object["kind"] {
		case "text":
			collectLevels(object["paragraphs"], seen)
		case "table":
			rows, _ := object["cellParagraphs"].([]any)
			for _, rawRow := range rows {
				row, _ := rawRow.([]any)
				for _, rawCell := range row {
					collectLevels(rawCell, seen)
				}
			}
		}
	}
	if len(seen) == 0 {
		return nil
	}
	levels := make([]int, 0, len(seen))
	for level := range seen {
		levels = append(levels, level)
	}
	sort.Ints(levels)
	return levels
}

func collectLevels(raw any, seen map[int]bool) {
	items, _ := raw.([]any)
	for _, rawItem := range items {
		item, ok := rawItem.(map[string]any)
		if !ok {
			continue
		}
		if level, ok := item["level"].(float64); ok {
			seen[int(level)] = true
		}
	}
}
