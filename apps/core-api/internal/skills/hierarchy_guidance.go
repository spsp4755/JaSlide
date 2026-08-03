package skills

import (
	"fmt"
	"strings"
)

// bulletHierarchyExample scans a freshly imported PPTX's extracted style
// config (apps/renderer's pptx_to_html output) for the table cell or text
// box with the deepest real multi-level bulleted content — each
// paragraph's own .level, not just its flattened text — and turns it into
// a concrete example the generation prompt can imitate. Returns "" when
// nothing in the deck actually uses more than one level, so a single-level
// deck's outlineGuidance is left exactly as it was before this existed.
func bulletHierarchyExample(config map[string]any) string {
	var best []hierarchyLine
	source, _ := config["source"].(map[string]any)
	slides, _ := source["slides"].([]any)
	for _, rawSlide := range slides {
		slide, _ := rawSlide.(map[string]any)
		objects, _ := slide["objects"].([]any)
		for _, rawObject := range objects {
			object, _ := rawObject.(map[string]any)
			switch object["kind"] {
			case "table":
				rows, _ := object["cellParagraphs"].([]any)
				for _, rawRow := range rows {
					row, _ := rawRow.([]any)
					for _, rawCell := range row {
						if lines := hierarchyLinesFrom(rawCell); deeperHierarchy(lines, best) {
							best = lines
						}
					}
				}
			case "text":
				if lines := hierarchyLinesFrom(object["paragraphs"]); deeperHierarchy(lines, best) {
					best = lines
				}
			}
		}
	}
	return formatHierarchyExample(best)
}

type hierarchyLine struct {
	Text  string
	Level int
}

func hierarchyLinesFrom(raw any) []hierarchyLine {
	items, _ := raw.([]any)
	var lines []hierarchyLine
	for _, rawItem := range items {
		item, ok := rawItem.(map[string]any)
		if !ok {
			continue
		}
		text, _ := item["text"].(string)
		if strings.TrimSpace(text) == "" {
			continue
		}
		level := 0
		if raw, ok := item["level"].(float64); ok && raw > 0 {
			level = int(raw)
		}
		lines = append(lines, hierarchyLine{Text: text, Level: level})
	}
	return lines
}

func deeperHierarchy(candidate, current []hierarchyLine) bool {
	return maxHierarchyLevel(candidate) > maxHierarchyLevel(current)
}

func maxHierarchyLevel(lines []hierarchyLine) int {
	max := -1
	for _, line := range lines {
		if line.Level > max {
			max = line.Level
		}
	}
	return max
}

func formatHierarchyExample(lines []hierarchyLine) string {
	if maxHierarchyLevel(lines) < 1 {
		return ""
	}
	seen := map[int]bool{}
	var examples []string
	for _, line := range lines {
		if seen[line.Level] {
			continue
		}
		seen[line.Level] = true
		examples = append(examples, fmt.Sprintf("레벨 %d 예: '%s'", line.Level, strings.TrimSpace(line.Text)))
	}
	return fmt.Sprintf(
		"이 템플릿의 표/목록은 최대 %d단계 들여쓰기 구조를 사용합니다 (%s — 이 예시 문구는 깊이 구조를 보여주기 위한 것으로, "+
			"내용을 생성할 때 그대로 재사용하지 말고 새 내용을 쓰세요). "+
			"내용을 생성할 때도 각 줄이 대분류인지 하위 항목인지 스스로 판단해 이런 깊이의 계층 구조로 작성하고, "+
			"bullets의 level(0~4)을 정확히 지정하세요.",
		maxHierarchyLevel(lines)+1, strings.Join(examples, ", "),
	)
}
