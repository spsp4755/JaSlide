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
