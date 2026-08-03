package generation

import "sort"

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
