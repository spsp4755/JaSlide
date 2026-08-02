package generation

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/spsp4755/JaSlide/apps/core-api/internal/contentsecurity"
)

var (
	ErrNotFound  = errors.New("not found")
	ErrBadInput  = errors.New("bad input")
	ErrCancelled = errors.New("generation cancelled")
)

type Principal struct {
	ID             string
	OrganizationID *string
}

type Presentation struct {
	ID, Title, UserID, SourceType, Content, Status string
	TemplateID, SkillID                            *string
}

type Job struct {
	ID, UserID, Status string
	PresentationID     *string
	SkillID            *string
	Input, Error       json.RawMessage
	Progress           int
	Presentation       json.RawMessage
}

type Skill struct {
	ID, UserID, OutlineGuidance string
	OrganizationID, TemplateID  *string
	IsPublic                    bool
}

type Slide struct {
	ID             string          `json:"id"`
	PresentationID string          `json:"presentationId"`
	Type           string          `json:"type"`
	Layout         string          `json:"layout"`
	Title          *string         `json:"title"`
	Notes          *string         `json:"notes"`
	Order          int             `json:"order"`
	Content        json.RawMessage `json:"content"`
}

type OutlineSlide struct {
	Order         int      `json:"order"`
	Title         string   `json:"title"`
	Type          string   `json:"type"`
	KeyPoints     []string `json:"keyPoints"`
	TemplateIndex *int     `json:"templateIndex,omitempty"`
}

type Outline struct {
	Title  string         `json:"title"`
	Slides []OutlineSlide `json:"slides"`
}

type StartInput struct {
	Title         string          `json:"title,omitempty"`
	SourceType    string          `json:"sourceType"`
	Content       string          `json:"content"`
	SlideCount    int             `json:"slideCount"`
	Language      string          `json:"language,omitempty"`
	TemplateID    *string         `json:"templateId,omitempty"`
	SkillID       *string         `json:"skillId,omitempty"`
	Options       json.RawMessage `json:"options,omitempty"`
	Outline       *Outline        `json:"outline,omitempty"`
	SkillGuidance string          `json:"skillGuidance,omitempty"`
}

type OutlineInput struct {
	SourceType string          `json:"sourceType,omitempty"`
	Content    string          `json:"content"`
	SlideCount *int            `json:"slideCount,omitempty"`
	Language   string          `json:"language,omitempty"`
	TemplateID *string         `json:"templateId,omitempty"`
	SkillID    *string         `json:"skillId,omitempty"`
	Options    json.RawMessage `json:"options,omitempty"`
}

type StartResult struct {
	JobID          string `json:"jobId"`
	PresentationID string `json:"presentationId"`
	Status         string `json:"status"`
}

type Repository interface {
	VisibleSkill(context.Context, string, string, *string) (Skill, error)
	VisibleTemplateConfig(context.Context, string, string) (json.RawMessage, error)
	CreateGeneration(context.Context, Presentation, Job) error
	GenerationJob(context.Context, string, string) (Job, error)
	SetGenerationStatus(context.Context, string, string, int, json.RawMessage) (bool, error)
	FailGeneration(context.Context, string, json.RawMessage) error
	CancelGeneration(context.Context, string, string) (bool, error)
	CompleteGeneration(context.Context, string, string, []Slide) error
	SlideForEdit(context.Context, string, string) (Slide, error)
	UpdateSlideContent(context.Context, string, json.RawMessage) (Slide, error)
	RecoverableGenerationIDs(context.Context) ([]string, error)
}

type Queue interface {
	Add(context.Context, string) error
}

type LLM interface {
	Outline(context.Context, OutlineRequest) (Outline, error)
	SlideContent(context.Context, SlideRequest) (json.RawMessage, error)
	Critique(context.Context, CritiqueRequest) (string, error)
	CritiqueOutline(context.Context, Outline, string) (Outline, bool, error)
	Edit(context.Context, json.RawMessage, string, string) (json.RawMessage, error)
	SlideHTML(context.Context, string, SlideRequest) (string, error)
	EditHTML(context.Context, string, string) (string, error)
}

type OutlineRequest struct {
	Content, Language string
	SlideCount        int
	TemplateSlides    []string
	PriorTitles       []string
	UsedIndexes       []int
}

type SlideRequest struct {
	Title, Type, Language string
	KeyPoints             []string
}

type CritiqueRequest struct {
	Content   json.RawMessage
	Title     string
	KeyPoints []string
}

type Service struct {
	repo  Repository
	llm   LLM
	queue Queue
	mu    sync.Mutex
	jobs  map[string]*runningJob
}

func NewService(repo Repository, llm LLM, queue Queue) *Service {
	return &Service{repo: repo, llm: llm, queue: queue, jobs: map[string]*runningJob{}}
}

func (service *Service) Start(ctx context.Context, principal Principal, input StartInput) (StartResult, error) {
	if err := validateStart(input); err != nil {
		return StartResult{}, err
	}
	skill, err := service.resolveSkill(ctx, principal, input.SkillID)
	if err != nil {
		return StartResult{}, err
	}
	if input.TemplateID == nil && skill.TemplateID != nil {
		input.TemplateID = skill.TemplateID
	}
	if _, err := service.template(ctx, input.TemplateID, principal.ID); err != nil {
		return StartResult{}, err
	}
	input.SkillGuidance = skill.OutlineGuidance
	if input.Outline != nil {
		if err := validateOutline(*input.Outline); err != nil {
			return StartResult{}, err
		}
		input.SlideCount = len(input.Outline.Slides)
	}
	if input.Language == "" {
		input.Language = detectLanguage(input.Content)
	}
	rawInput, err := json.Marshal(input)
	if err != nil {
		return StartResult{}, err
	}
	presentationID, err := newID()
	if err != nil {
		return StartResult{}, err
	}
	jobID, err := newID()
	if err != nil {
		return StartResult{}, err
	}
	title := input.Title
	if strings.TrimSpace(title) == "" {
		title = "New Presentation"
	}
	var skillID *string
	if skill.ID != "" {
		skillID = &skill.ID
	}
	presentation := Presentation{
		ID: presentationID, Title: title, UserID: principal.ID, SourceType: input.SourceType,
		Content: input.Content, Status: "GENERATING", TemplateID: input.TemplateID, SkillID: skillID,
	}
	job := Job{
		ID: jobID, UserID: principal.ID, Status: "QUEUED", PresentationID: &presentationID,
		SkillID: skillID, Input: rawInput, Progress: 0,
	}
	if err := service.repo.CreateGeneration(ctx, presentation, job); err != nil {
		return StartResult{}, err
	}
	if err := service.queue.Add(ctx, jobID); err != nil {
		raw := json.RawMessage(`{"message":"queue unavailable"}`)
		compensationCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
		defer cancel()
		return StartResult{}, fmt.Errorf("queue generation: %w",
			errors.Join(err, service.repo.FailGeneration(compensationCtx, jobID, raw)))
	}
	return StartResult{JobID: jobID, PresentationID: presentationID, Status: "QUEUED"}, nil
}

func (service *Service) Status(ctx context.Context, jobID, userID string) (Job, error) {
	job, err := service.repo.GenerationJob(ctx, jobID, userID)
	if err != nil {
		return Job{}, ErrNotFound
	}
	return job, nil
}

func (service *Service) Cancel(ctx context.Context, jobID, userID string) error {
	cancelled, err := service.repo.CancelGeneration(ctx, jobID, userID)
	if err != nil {
		return err
	}
	if !cancelled {
		return fmt.Errorf("%w: job not found or already completed", ErrBadInput)
	}
	service.cancelJob(jobID)
	return nil
}

func (service *Service) GenerateOutline(ctx context.Context, principal Principal, input OutlineInput) (Outline, error) {
	if strings.TrimSpace(input.Content) == "" {
		return Outline{}, fmt.Errorf("%w: Content is required", ErrBadInput)
	}
	skill, err := service.resolveSkill(ctx, principal, input.SkillID)
	if err != nil {
		return Outline{}, err
	}
	if input.TemplateID == nil {
		input.TemplateID = skill.TemplateID
	}
	content := input.Content
	if skill.OutlineGuidance != "" {
		content += "\n\n[Writing Skill Guide]\n" + skill.OutlineGuidance
	}
	count := automaticSlideCount(content)
	if input.SlideCount != nil {
		count = *input.SlideCount
	}
	if count < 1 || count > 30 {
		return Outline{}, fmt.Errorf("%w: slideCount must be between 1 and 30", ErrBadInput)
	}
	language := input.Language
	if language == "" {
		language = detectLanguage(content)
	}
	catalog, err := service.templateCatalog(ctx, input.TemplateID, principal.ID)
	if err != nil {
		return Outline{}, err
	}
	return service.llm.Outline(ctx, OutlineRequest{
		Content: content, Language: language, SlideCount: count, TemplateSlides: catalog,
	})
}

type popQueue interface {
	Pop(context.Context) (string, error)
}

func (service *Service) Run(ctx context.Context) {
	queue, ok := service.queue.(popQueue)
	if !ok {
		return
	}
	lastRecovery := time.Time{}
	for ctx.Err() == nil {
		if time.Since(lastRecovery) >= 10*time.Second {
			service.recover(ctx)
			lastRecovery = time.Now()
		}
		id, err := queue.Pop(ctx)
		if err != nil {
			continue
		}
		service.Process(ctx, id)
	}
}

// recover is deliberately retried by Run: a Redis outage must not strand rows
// that were committed to Postgres before their queue message was delivered.
func (service *Service) recover(ctx context.Context) {
	ids, err := service.repo.RecoverableGenerationIDs(ctx)
	if err != nil {
		return
	}
	for _, id := range ids {
		_ = service.queue.Add(ctx, id)
	}
}

func (service *Service) Process(ctx context.Context, jobID string) {
	ctx, finished := service.jobContext(ctx, jobID)
	defer finished()
	job, err := service.repo.GenerationJob(ctx, jobID, "")
	if err != nil || job.Status == "COMPLETED" || job.Status == "FAILED" || job.Status == "CANCELLED" {
		return
	}
	var input StartInput
	if json.Unmarshal(job.Input, &input) != nil {
		service.fail(ctx, jobID, errors.New("invalid generation input"))
		return
	}
	if err := service.updateStatus(ctx, jobID, "GENERATING_OUTLINE", 10); err != nil {
		return
	}
	content := input.Content
	if input.SkillGuidance != "" {
		content += "\n\n[Writing Skill Guide]\n" + input.SkillGuidance
	}
	var outline Outline
	if input.Outline != nil {
		outline = *input.Outline
	} else {
		catalog, catalogErr := service.templateCatalog(ctx, input.TemplateID, job.UserID)
		if catalogErr != nil {
			service.fail(ctx, jobID, catalogErr)
			return
		}
		outline, err = service.llm.Outline(ctx, OutlineRequest{
			Content: content, Language: input.Language, SlideCount: input.SlideCount,
			TemplateSlides: catalog,
		})
		if err != nil {
			service.fail(ctx, jobID, err)
			return
		}
		if revised, changed, critiqueErr := service.llm.CritiqueOutline(ctx, outline, content); critiqueErr == nil && changed {
			outline = revised
		}
	}
	if err := service.updateStatus(ctx, jobID, "GENERATING_CONTENT", 30); err != nil {
		return
	}
	template, err := service.template(ctx, input.TemplateID, job.UserID)
	if err != nil {
		service.fail(ctx, jobID, err)
		return
	}
	capable := template.capableIndexes()
	var slides []Slide
	for index, item := range outline.Slides {
		rawContent, contentErr := service.llm.SlideContent(ctx, SlideRequest{
			Title: item.Title, Type: item.Type, Language: input.Language, KeyPoints: item.KeyPoints,
		})
		if contentErr != nil {
			service.fail(ctx, jobID, contentErr)
			return
		}
		if feedback, critiqueErr := service.llm.Critique(ctx, CritiqueRequest{
			Content: rawContent, Title: item.Title, KeyPoints: item.KeyPoints,
		}); critiqueErr == nil && feedback != "" {
			if revised, editErr := service.llm.Edit(ctx, rawContent, feedback, item.Type); editErr == nil {
				rawContent = revised
			}
		}
		fields := rawObject(rawContent)
		templateIndex := chooseTemplateIndex(item.TemplateIndex, index, capable)
		if templateIndex >= 0 {
			fields["templateIndex"] = templateIndex
		}
		if template.PPTX && templateIndex >= 0 {
			fields["objectEdits"] = pptxObjectEdits(
				template.objects(templateIndex), templateIndex, item.Title, slideLines(fields, item.KeyPoints),
			)
		} else if templateIndex >= 0 && templateIndex < len(template.HTMLSlides) {
			original := template.HTMLSlides[templateIndex]
			generated, htmlErr := service.llm.SlideHTML(ctx, original, SlideRequest{
				Title: item.Title, Type: item.Type, Language: input.Language, KeyPoints: item.KeyPoints,
			})
			if htmlErr == nil {
				generated, htmlErr = contentsecurity.SanitizeHTML(generated)
			}
			if htmlErr == nil && preservesHTMLStructure(original, generated) {
				fields["html"] = generated
			} else {
				fields["html"] = original
			}
		}
		encoded, marshalErr := json.Marshal(fields)
		if marshalErr != nil {
			service.fail(ctx, jobID, marshalErr)
			return
		}
		id, idErr := newID()
		if idErr != nil {
			service.fail(ctx, jobID, idErr)
			return
		}
		title := item.Title
		slides = append(slides, Slide{
			ID: id, Order: index, Type: item.Type, Title: &title, Content: encoded,
			Layout: defaultLayout(item.Type),
		})
		progress := 30 + ((index + 1) * 50 / len(outline.Slides))
		if err := service.updateStatus(ctx, jobID, "GENERATING_CONTENT", progress); err != nil {
			return
		}
	}
	if err := service.updateStatus(ctx, jobID, "APPLYING_DESIGN", 85); err != nil {
		return
	}
	if err := service.repo.CompleteGeneration(ctx, jobID, outline.Title, slides); err != nil {
		if !errors.Is(err, ErrCancelled) {
			service.fail(ctx, jobID, err)
		}
	}
}

type runningJob struct{ cancel context.CancelFunc }

func (service *Service) jobContext(parent context.Context, jobID string) (context.Context, func()) {
	ctx, cancel := context.WithCancel(parent)
	job := &runningJob{cancel: cancel}
	service.mu.Lock()
	if previous := service.jobs[jobID]; previous != nil {
		previous.cancel()
	}
	service.jobs[jobID] = job
	service.mu.Unlock()
	return ctx, func() {
		cancel()
		service.mu.Lock()
		if service.jobs[jobID] == job {
			delete(service.jobs, jobID)
		}
		service.mu.Unlock()
	}
}

func (service *Service) cancelJob(jobID string) {
	service.mu.Lock()
	job := service.jobs[jobID]
	service.mu.Unlock()
	if job != nil {
		job.cancel()
	}
}

// CancelLive interrupts an in-flight LLM request after its durable job state
// has been moved to CANCELLED by the caller.
func (service *Service) CancelLive(jobID string) { service.cancelJob(jobID) }

type AIEditInput struct {
	SlideID     string   `json:"slideId,omitempty"`
	SlideIDs    []string `json:"slideIds,omitempty"`
	Instruction string   `json:"instruction"`
}

func (service *Service) AIEdit(ctx context.Context, userID string, input AIEditInput) ([]Slide, error) {
	ids := input.SlideIDs
	if len(ids) == 0 && input.SlideID != "" {
		ids = []string{input.SlideID}
	}
	if len(ids) == 0 || strings.TrimSpace(input.Instruction) == "" {
		return nil, fmt.Errorf("%w: No slide specified", ErrBadInput)
	}
	type edit struct {
		id      string
		content json.RawMessage
	}
	edits := make([]edit, 0, len(ids))
	for _, id := range ids {
		slide, err := service.repo.SlideForEdit(ctx, id, userID)
		if err != nil {
			return nil, fmt.Errorf("%w: Slide not found", ErrBadInput)
		}
		fields := rawObject(slide.Content)
		if html, ok := fields["html"].(string); ok && strings.TrimSpace(html) != "" {
			edited, err := service.llm.EditHTML(ctx, html, input.Instruction)
			if err != nil {
				return nil, err
			}
			edited, err = contentsecurity.SanitizeHTML(edited)
			if err != nil {
				return nil, fmt.Errorf("invalid edited HTML")
			}
			if preservesHTMLStructure(html, edited) {
				fields["html"] = edited
			}
		} else {
			edited, err := service.llm.Edit(ctx, slide.Content, input.Instruction, slide.Type)
			if err != nil {
				return nil, err
			}
			editedFields := rawObject(edited)
			for key, value := range editedFields {
				fields[key] = value
			}
			if objectEdits, ok := fields["objectEdits"].([]any); ok {
				lines := slideLines(fields, nil)
				for index, item := range objectEdits {
					object, ok := item.(map[string]any)
					if !ok {
						continue
					}
					if _, ok := object["text"]; ok && len(lines) > 0 {
						object["text"] = lines[min(index, len(lines)-1)]
					}
				}
			}
		}
		raw, err := json.Marshal(fields)
		if err != nil {
			return nil, err
		}
		edits = append(edits, edit{id: id, content: raw})
	}
	result := make([]Slide, 0, len(edits))
	for _, edit := range edits {
		slide, err := service.repo.UpdateSlideContent(ctx, edit.id, edit.content)
		if err != nil {
			return nil, err
		}
		result = append(result, slide)
	}
	return result, nil
}

func (service *Service) fail(ctx context.Context, jobID string, err error) {
	raw, _ := json.Marshal(map[string]string{"message": err.Error()})
	_ = service.repo.FailGeneration(ctx, jobID, raw)
}

type templateData struct {
	PPTX       bool
	HTMLSlides []string
	Source     map[string]any
}

func (service *Service) template(ctx context.Context, id *string, userID string) (templateData, error) {
	if id == nil || *id == "" {
		return templateData{}, nil
	}
	raw, err := service.repo.VisibleTemplateConfig(ctx, *id, userID)
	if err != nil {
		return templateData{}, fmt.Errorf("%w: Template not found", ErrBadInput)
	}
	raw, err = contentsecurity.SanitizeTemplateConfig(raw)
	if err != nil {
		return templateData{}, fmt.Errorf("%w: Invalid template", ErrBadInput)
	}
	fields := rawObject(raw)
	htmlSlides := stringSlice(fields["htmlSlides"])
	source, _ := fields["source"].(map[string]any)
	return templateData{
		PPTX: source["kind"] == "pptx", HTMLSlides: htmlSlides, Source: source,
	}, nil
}

func (service *Service) templateCatalog(ctx context.Context, id *string, userID string) ([]string, error) {
	template, err := service.template(ctx, id, userID)
	if err != nil {
		return nil, err
	}
	result := make([]string, len(template.HTMLSlides))
	for index, html := range template.HTMLSlides {
		result[index] = truncate(strings.TrimSpace(htmlTag.ReplaceAllString(html, " ")), 180)
		if result[index] == "" {
			result[index] = "Visual layout"
		}
	}
	return result, nil
}

func (template templateData) objects(index int) []map[string]any {
	slides, _ := template.Source["slides"].([]any)
	if index < 0 || index >= len(slides) {
		return nil
	}
	slide, _ := slides[index].(map[string]any)
	rawObjects, _ := slide["objects"].([]any)
	result := make([]map[string]any, 0, len(rawObjects))
	for _, item := range rawObjects {
		if object, ok := item.(map[string]any); ok {
			result = append(result, object)
		}
	}
	return result
}

func (template templateData) capableIndexes() []int {
	total := len(template.HTMLSlides)
	if slides, ok := template.Source["slides"].([]any); ok && len(slides) > total {
		total = len(slides)
	}
	all := make([]int, total)
	for index := range all {
		all[index] = index
	}
	if !template.PPTX {
		return all
	}
	var capable []int
	for _, index := range all {
		for _, object := range template.objects(index) {
			if object["kind"] == "text" || object["kind"] == "table" {
				capable = append(capable, index)
				break
			}
		}
	}
	if len(capable) > 0 {
		return capable
	}
	return all
}

func chooseTemplateIndex(requested *int, order int, capable []int) int {
	if len(capable) == 0 {
		return -1
	}
	if requested != nil {
		for _, value := range capable {
			if value == *requested {
				return value
			}
		}
	}
	return capable[order%len(capable)]
}

func pptxObjectEdits(objects []map[string]any, slide int, title string, lines []string) []map[string]any {
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
		text := strings.Join(lines, "\n")
		if index == 0 {
			text = title
		}
		edits = append(edits, map[string]any{
			"objectId": texts[index]["id"], "slide": slide, "text": text,
		})
	}
	for _, table := range tables {
		edits = append(edits, map[string]any{
			"objectId": table["id"], "slide": slide,
			"cells": populateCells(table["cells"], lines),
		})
	}
	if len(edits) == 0 {
		edits = append(edits, map[string]any{
			"objectId": fmt.Sprintf("generated-title-%d", slide), "slide": slide,
			"kind": "text", "addText": title, "text": strings.Join(append([]string{title}, lines...), "\n"),
			"left": 140, "top": 120, "width": 1640, "height": 560, "fontSize": 34, "color": "#1A1A1A",
		})
	}
	return edits
}

func populateCells(raw any, lines []string) [][]string {
	rows, ok := raw.([]any)
	if !ok {
		return nil
	}
	result := make([][]string, len(rows))
	slots := 0
	for rowIndex, rawRow := range rows {
		cells, _ := rawRow.([]any)
		result[rowIndex] = make([]string, len(cells))
		for cellIndex, rawCell := range cells {
			result[rowIndex][cellIndex], _ = rawCell.(string)
			if !isTableLabel(result[rowIndex][cellIndex]) {
				slots++
			}
		}
	}
	size := max(1, (len(lines)+max(slots, 1)-1)/max(slots, 1))
	next := 0
	for rowIndex := range result {
		for cellIndex, text := range result[rowIndex] {
			if isTableLabel(text) {
				continue
			}
			end := min(len(lines), next+size)
			if next < end {
				result[rowIndex][cellIndex] = strings.Join(lines[next:end], "\n")
			}
			next = end
		}
	}
	return result
}

func isTableLabel(value string) bool {
	value = strings.TrimSpace(value)
	return value != "" && !strings.Contains(value, "\n") && len([]rune(value)) <= 60
}

func slideLines(fields map[string]any, fallback []string) []string {
	var result []string
	if body, ok := fields["body"].(string); ok && strings.TrimSpace(body) != "" {
		result = append(result, body)
	}
	if bullets, ok := fields["bullets"].([]any); ok {
		for _, item := range bullets {
			if bullet, ok := item.(map[string]any); ok {
				if text, ok := bullet["text"].(string); ok && strings.TrimSpace(text) != "" {
					result = append(result, text)
				}
			}
		}
	}
	if len(result) == 0 {
		result = append(result, fallback...)
	}
	return result
}

func rawObject(raw json.RawMessage) map[string]any {
	result := map[string]any{}
	_ = json.Unmarshal(raw, &result)
	return result
}

func stringSlice(raw any) []string {
	values, _ := raw.([]any)
	result := make([]string, 0, len(values))
	for _, value := range values {
		if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
			result = append(result, text)
		}
	}
	return result
}

func preservesHTMLStructure(template, candidate string) bool {
	for _, pattern := range []*regexp.Regexp{tableTag, cellTag, dataObject} {
		if len(pattern.FindAllString(candidate, -1)) < len(pattern.FindAllString(template, -1)) {
			return false
		}
	}
	return true
}

func number(value any) float64 {
	number, _ := value.(float64)
	return number
}

func defaultLayout(slideType string) string {
	if slideType == "TWO_COLUMN" {
		return "two-column"
	}
	return "center"
}

var (
	htmlTag    = regexp.MustCompile(`<[^>]*>`)
	tableTag   = regexp.MustCompile(`(?i)<table\b`)
	cellTag    = regexp.MustCompile(`(?i)<(?:td|th)\b`)
	dataObject = regexp.MustCompile(`(?i)data-object\s*=\s*["']true["']`)
)

func (service *Service) updateStatus(ctx context.Context, jobID, status string, progress int) error {
	updated, err := service.repo.SetGenerationStatus(ctx, jobID, status, progress, nil)
	if err != nil {
		return err
	}
	if !updated {
		return ErrCancelled
	}
	return nil
}

func (service *Service) resolveSkill(ctx context.Context, principal Principal, skillID *string) (Skill, error) {
	if skillID == nil || *skillID == "" {
		return Skill{}, nil
	}
	skill, err := service.repo.VisibleSkill(ctx, *skillID, principal.ID, principal.OrganizationID)
	if err != nil {
		return Skill{}, fmt.Errorf("%w: Skill not found", ErrBadInput)
	}
	return skill, nil
}

func validateStart(input StartInput) error {
	if !sourceTypes[input.SourceType] || strings.TrimSpace(input.Content) == "" ||
		input.SlideCount < 1 || input.SlideCount > 30 {
		return fmt.Errorf("%w: sourceType, content and slideCount (1-30) are required", ErrBadInput)
	}
	return nil
}

func validateOutline(outline Outline) error {
	if strings.TrimSpace(outline.Title) == "" || len(outline.Slides) == 0 || len(outline.Slides) > 30 {
		return fmt.Errorf("%w: invalid outline", ErrBadInput)
	}
	for index, slide := range outline.Slides {
		if strings.TrimSpace(slide.Title) == "" || !slideTypes[slide.Type] ||
			len(slide.KeyPoints) == 0 || len(slide.KeyPoints) > 8 {
			return fmt.Errorf("%w: invalid outline slide %d", ErrBadInput, index+1)
		}
		outline.Slides[index].Order = index + 1
	}
	return nil
}

func detectLanguage(text string) string {
	for _, value := range text {
		if value >= '\uAC00' && value <= '\uD7AF' {
			return "ko"
		}
	}
	return "en"
}

func automaticSlideCount(content string) int {
	count := (len([]rune(strings.Join(strings.Fields(content), ""))) + 349) / 350
	if count < 1 {
		return 1
	}
	if count > 30 {
		return 30
	}
	return count
}

func newID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return "go-" + hex.EncodeToString(value[:]), nil
}

var sourceTypes = map[string]bool{"TEXT": true, "DOCX": true, "PDF": true, "MARKDOWN": true, "CSV": true, "URL": true}
var slideTypes = map[string]bool{
	"TITLE": true, "CONTENT": true, "BULLET_LIST": true, "TWO_COLUMN": true,
	"IMAGE": true, "CHART": true, "TABLE": true, "QUOTE": true, "COMPARISON": true,
	"SECTION_HEADER": true, "BLANK": true, "TIMELINE": true, "PROCESS": true, "KPI": true,
}
