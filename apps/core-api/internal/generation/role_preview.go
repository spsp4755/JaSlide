package generation

import "context"

// RolePreviewSlideInput is the minimal per-outline-slide shape the
// role-preview endpoint needs to resolve which template slide an outline
// slide would use -- the same fields chooseTemplateIndex already consumes.
// Slides are matched to the request by array position, not by any id field
// -- see the design doc's note on why "order" is unsafe here (an outline
// can be reordered client-side before its order field is renumbered).
type RolePreviewSlideInput struct {
	Type          string
	TemplateIndex *int
}

// RolePreviewItem describes one template object's role for display. Role is
// always the *effective* role (see effectiveRole) so a locked object always
// reports "static" here, matching what generation will actually do. Locked
// mirrors the object's own "locked" field, distinguishing a user override
// (locked:true) from an object the classifier itself decided was static.
type RolePreviewItem struct {
	ObjectID string `json:"objectId"`
	Role     string `json:"role"`
	Locked   bool   `json:"locked"`
}

type RolePreviewSlideResult struct {
	Items []RolePreviewItem `json:"items"`
}

// RolePreviewResult.Status is one of "pending" (classification just
// triggered or already running), "ready" (Slides is populated), or
// "unavailable" (not a PPTX template -- no shape/role concept applies).
type RolePreviewResult struct {
	Status string                   `json:"status"`
	Slides []RolePreviewSlideResult `json:"slides,omitempty"`
}

// RolePreview reports, for each of the caller's outline slides (in the same
// order), which template shapes will be filled in vs left untouched. If the
// template has never been classified, this triggers classification in the
// background (classifyInBackground) and returns "pending" immediately -- it
// never blocks on the LLM round-trip, the same constraint template()'s
// classify parameter already enforces for Start/GenerateOutline.
func (service *Service) RolePreview(ctx context.Context, templateID, userID string, slides []RolePreviewSlideInput) (RolePreviewResult, error) {
	template, err := service.template(ctx, &templateID, userID, false)
	if err != nil {
		return RolePreviewResult{}, err
	}
	if !template.PPTX {
		return RolePreviewResult{Status: "unavailable"}, nil
	}
	if needsRoleClassification(template.Source) {
		service.classifyInBackground(templateID, userID)
		return RolePreviewResult{Status: "pending"}, nil
	}
	capable := template.capableIndexes()
	result := make([]RolePreviewSlideResult, len(slides))
	for index, slide := range slides {
		templateIndex := chooseTemplateIndex(slide.TemplateIndex, index, capable)
		items := []RolePreviewItem{}
		if templateIndex >= 0 {
			for _, object := range template.objects(templateIndex) {
				id, _ := object["id"].(string)
				role := effectiveRole(object)
				if id == "" || role == "" {
					continue
				}
				locked, _ := object["locked"].(bool)
				items = append(items, RolePreviewItem{ObjectID: id, Role: role, Locked: locked})
			}
		}
		result[index] = RolePreviewSlideResult{Items: items}
	}
	return RolePreviewResult{Status: "ready", Slides: result}, nil
}

// classifyInBackground starts role classification for templateID unless
// classification is already running for that same template -- multiple
// RolePreview calls for the same unclassified template (concurrent
// tabs/users) must not each start their own LLM round-trip. Runs detached
// from the request context: the HTTP request that triggered this will
// already have returned by the time classification finishes.
func (service *Service) classifyInBackground(templateID, userID string) {
	if _, alreadyRunning := service.classifying.LoadOrStore(templateID, true); alreadyRunning {
		return
	}
	go func() {
		defer service.classifying.Delete(templateID)
		_, _ = service.template(context.Background(), &templateID, userID, true)
	}()
}
