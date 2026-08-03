package generation

import (
	"reflect"
	"testing"
)

func TestAvailableLevelsReturnsTheSortedUnionAcrossTextAndTableObjects(t *testing.T) {
	objects := []map[string]any{
		{
			"kind": "text",
			"paragraphs": []any{
				map[string]any{"text": "Top", "level": float64(0)},
				map[string]any{"text": "Nested", "level": float64(2)},
			},
		},
		{
			"kind": "table",
			"cellParagraphs": []any{
				[]any{
					[]any{map[string]any{"text": "Cell", "level": float64(1)}},
				},
			},
		},
	}
	got := availableLevels(objects)
	want := []int{0, 1, 2}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("availableLevels() = %v, want %v", got, want)
	}
}

func TestAvailableLevelsReturnsNilWhenNoObjectCarriesLevelInformation(t *testing.T) {
	objects := []map[string]any{{"kind": "text", "paragraphs": []any{}}}
	if got := availableLevels(objects); got != nil {
		t.Fatalf("availableLevels() = %v, want nil", got)
	}
}
