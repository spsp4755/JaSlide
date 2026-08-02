package skills

import (
	"strings"
	"testing"
)

func TestBulletHierarchyExampleFindsTheDeepestTableCell(t *testing.T) {
	config := map[string]any{
		"source": map[string]any{
			"slides": []any{
				map[string]any{
					"objects": []any{
						map[string]any{
							"kind": "table",
							"cellParagraphs": []any{
								[]any{
									[]any{map[string]any{"text": "추진실적", "level": float64(0)}},
								},
								[]any{
									[]any{
										map[string]any{"text": "사내 시험 시스템(examweb) 고도화", "level": float64(0)},
										map[string]any{"text": "응시 이탈 오류 수정", "level": float64(1)},
										map[string]any{"text": "상세 테스트 및 개선 사항 전달", "level": float64(2)},
									},
								},
							},
						},
					},
				},
			},
		},
	}

	example := bulletHierarchyExample(config)

	if !strings.Contains(example, "3단계") {
		t.Fatalf("example = %q, want it to mention 3 levels of depth", example)
	}
	if !strings.Contains(example, "사내 시험 시스템(examweb) 고도화") || !strings.Contains(example, "응시 이탈 오류 수정") {
		t.Fatalf("example = %q, want it to quote the actual template lines", example)
	}
}

func TestBulletHierarchyExampleIsEmptyForAFlatSingleLevelDeck(t *testing.T) {
	config := map[string]any{
		"source": map[string]any{
			"slides": []any{
				map[string]any{
					"objects": []any{
						map[string]any{
							"kind": "text",
							"paragraphs": []any{
								map[string]any{"text": "그냥 한 줄", "level": float64(0)},
							},
						},
					},
				},
			},
		},
	}

	if example := bulletHierarchyExample(config); example != "" {
		t.Fatalf("example = %q, want empty for a deck with no real multi-level content", example)
	}
}

func TestBulletHierarchyExampleAlsoFindsADeepPlainTextBox(t *testing.T) {
	config := map[string]any{
		"source": map[string]any{
			"slides": []any{
				map[string]any{
					"objects": []any{
						map[string]any{
							"kind": "text",
							"paragraphs": []any{
								map[string]any{"text": "대분류", "level": float64(0)},
								map[string]any{"text": "세부 항목", "level": float64(1)},
							},
						},
					},
				},
			},
		},
	}

	example := bulletHierarchyExample(config)

	if !strings.Contains(example, "2단계") || !strings.Contains(example, "대분류") {
		t.Fatalf("example = %q, want it to describe the text box's own 2-level structure", example)
	}
}
