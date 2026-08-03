package generation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
)

type memoryRepository struct {
	users         map[string]db.User
	presentations map[string]Presentation
	jobs          map[string]Job
	skills        map[string]Skill
	templates     map[string]memoryTemplate
	slides        []Slide
}

type memoryTemplate struct {
	config         json.RawMessage
	public         bool
	userID         string
	organizationID *string
}

func newMemoryRepository() *memoryRepository {
	return &memoryRepository{
		users: map[string]db.User{}, presentations: map[string]Presentation{},
		jobs: map[string]Job{}, skills: map[string]Skill{}, templates: map[string]memoryTemplate{},
	}
}

func (repo *memoryRepository) FindUserByID(_ context.Context, id string) (db.User, error) {
	user, ok := repo.users[id]
	if !ok {
		return db.User{}, errors.New("not found")
	}
	return user, nil
}

func (repo *memoryRepository) VisibleSkill(_ context.Context, id, userID string, organizationID *string) (Skill, error) {
	skill, ok := repo.skills[id]
	if !ok || (!skill.IsPublic && skill.UserID != userID) {
		return Skill{}, errors.New("not found")
	}
	return skill, nil
}

func (repo *memoryRepository) VisibleTemplateConfig(_ context.Context, id, userID string) (json.RawMessage, error) {
	template, ok := repo.templates[id]
	if !ok {
		return nil, errors.New("not found")
	}
	if template.public || template.userID == userID {
		return template.config, nil
	}
	user := repo.users[userID]
	if template.organizationID != nil && user.OrganizationID != nil && *template.organizationID == *user.OrganizationID {
		return template.config, nil
	}
	return nil, errors.New("not found")
}

func (repo *memoryRepository) UpdateTemplateConfig(_ context.Context, id string, config json.RawMessage) error {
	template, ok := repo.templates[id]
	if !ok {
		return errors.New("not found")
	}
	template.config = config
	repo.templates[id] = template
	return nil
}

func (repo *memoryRepository) CreateGeneration(_ context.Context, presentation Presentation, job Job) error {
	repo.presentations[presentation.ID] = presentation
	repo.jobs[job.ID] = job
	return nil
}

func (repo *memoryRepository) GenerationJob(_ context.Context, id, userID string) (Job, error) {
	job, ok := repo.jobs[id]
	if !ok || (userID != "" && job.UserID != userID) {
		return Job{}, errors.New("not found")
	}
	return job, nil
}

func (repo *memoryRepository) FailGeneration(ctx context.Context, id string, raw json.RawMessage) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	job := repo.jobs[id]
	if job.Status == "CANCELLED" {
		return nil
	}
	job.Status, job.Error = "FAILED", raw
	repo.jobs[id] = job
	if job.PresentationID != nil {
		presentation := repo.presentations[*job.PresentationID]
		presentation.Status = "FAILED"
		repo.presentations[*job.PresentationID] = presentation
	}
	return nil
}

func (repo *memoryRepository) SetGenerationStatus(_ context.Context, id, status string, progress int, errorValue json.RawMessage) (bool, error) {
	job, ok := repo.jobs[id]
	if !ok || job.Status == "CANCELLED" {
		return false, nil
	}
	job.Status, job.Progress, job.Error = status, progress, errorValue
	repo.jobs[id] = job
	return true, nil
}

func (repo *memoryRepository) CancelGeneration(_ context.Context, id, userID string) (bool, error) {
	job, ok := repo.jobs[id]
	if !ok || job.UserID != userID || job.Status == "COMPLETED" || job.Status == "FAILED" {
		return false, nil
	}
	job.Status = "CANCELLED"
	repo.jobs[id] = job
	if job.PresentationID != nil {
		presentation := repo.presentations[*job.PresentationID]
		presentation.Status = "FAILED"
		repo.presentations[*job.PresentationID] = presentation
	}
	return true, nil
}

func (repo *memoryRepository) CompleteGeneration(_ context.Context, jobID, title string, slides []Slide) error {
	job := repo.jobs[jobID]
	if job.Status == "CANCELLED" {
		return ErrCancelled
	}
	job.Status, job.Progress = "COMPLETED", 100
	repo.jobs[jobID] = job
	repo.slides = append([]Slide(nil), slides...)
	if job.PresentationID != nil {
		presentation := repo.presentations[*job.PresentationID]
		presentation.Title, presentation.Status = title, "COMPLETED"
		repo.presentations[*job.PresentationID] = presentation
	}
	return nil
}

func (repo *memoryRepository) SlideForEdit(context.Context, string, string) (Slide, error) {
	return Slide{}, errors.New("not found")
}

func (repo *memoryRepository) UpdateSlideContent(context.Context, string, json.RawMessage) (Slide, error) {
	return Slide{}, errors.New("not found")
}

func (repo *memoryRepository) RecoverableGenerationIDs(context.Context) ([]string, error) {
	var ids []string
	for id, job := range repo.jobs {
		switch job.Status {
		case "QUEUED", "PROCESSING", "GENERATING_OUTLINE", "GENERATING_CONTENT", "APPLYING_DESIGN", "RENDERING":
			ids = append(ids, id)
		}
	}
	return ids, nil
}

type recordingQueue struct {
	ids    []string
	addErr error
}

func (queue *recordingQueue) Add(_ context.Context, id string) error {
	queue.ids = append(queue.ids, id)
	return queue.addErr
}

type recoveryQueue struct {
	added chan string
}

type cancellingQueue struct{ cancel context.CancelFunc }

func (queue cancellingQueue) Add(context.Context, string) error {
	queue.cancel()
	return errors.New("redis request cancelled")
}

func (queue *recoveryQueue) Add(_ context.Context, id string) error {
	queue.added <- id
	return nil
}

func (queue *recoveryQueue) Pop(ctx context.Context) (string, error) {
	<-ctx.Done()
	return "", ctx.Err()
}

type cancellableLLM struct {
	started   chan struct{}
	cancelled chan struct{}
	release   chan struct{}
	once      sync.Once
}

type maliciousHTMLLLM struct {
	seenTemplate     string
	seenSlideRequest SlideRequest
}

func (*maliciousHTMLLLM) Outline(context.Context, OutlineRequest) (Outline, error) {
	return Outline{Title: "Deck", Slides: []OutlineSlide{{
		Order: 1, Title: "Slide", Type: "CONTENT", KeyPoints: []string{"Point"},
	}}}, nil
}

func (llm *maliciousHTMLLLM) SlideContent(_ context.Context, input SlideRequest) (json.RawMessage, error) {
	llm.seenSlideRequest = input
	return json.RawMessage(`{"heading":"Slide","bullets":[{"text":"Point"}]}`), nil
}

func (*maliciousHTMLLLM) Critique(context.Context, CritiqueRequest) (string, error) {
	return "", nil
}

func (*maliciousHTMLLLM) CritiqueOutline(_ context.Context, outline Outline, _ string) (Outline, bool, error) {
	return outline, false, nil
}

func (*maliciousHTMLLLM) Edit(context.Context, json.RawMessage, string, string) (json.RawMessage, error) {
	return nil, errors.New("unexpected edit call")
}

func (llm *maliciousHTMLLLM) SlideHTML(_ context.Context, template string, _ SlideRequest) (string, error) {
	llm.seenTemplate = template
	return `<div data-object="true" onclick="steal()">Safe<script>steal()</script><img src="x" onerror="steal()"></div>`, nil
}

func (*maliciousHTMLLLM) EditHTML(context.Context, string, string) (string, error) {
	return "", errors.New("unexpected edit HTML call")
}

func (llm *cancellableLLM) Outline(ctx context.Context, _ OutlineRequest) (Outline, error) {
	llm.once.Do(func() { close(llm.started) })
	select {
	case <-ctx.Done():
		close(llm.cancelled)
		return Outline{}, ctx.Err()
	case <-llm.release:
		return Outline{}, errors.New("released")
	}
}

func (*cancellableLLM) SlideContent(context.Context, SlideRequest) (json.RawMessage, error) {
	return nil, errors.New("unexpected slide content call")
}

func (*cancellableLLM) Critique(context.Context, CritiqueRequest) (string, error) {
	return "", errors.New("unexpected critique call")
}

func (*cancellableLLM) CritiqueOutline(context.Context, Outline, string) (Outline, bool, error) {
	return Outline{}, false, errors.New("unexpected critique outline call")
}

func (*cancellableLLM) Edit(context.Context, json.RawMessage, string, string) (json.RawMessage, error) {
	return nil, errors.New("unexpected edit call")
}

func (*cancellableLLM) SlideHTML(context.Context, string, SlideRequest) (string, error) {
	return "", errors.New("unexpected slide HTML call")
}

func (*cancellableLLM) EditHTML(context.Context, string, string) (string, error) {
	return "", errors.New("unexpected edit HTML call")
}

type reviewLLM struct {
	critiqueFeedback string
	critiqueErr      error
	editContent      json.RawMessage
	editErr          error
	critiqueCalls    int
	editCalls        int

	critiqueOutline      Outline
	critiqueOutlineErr   error
	critiqueOutlineCalls int
}

func (*reviewLLM) Outline(context.Context, OutlineRequest) (Outline, error) {
	return Outline{Title: "Deck", Slides: []OutlineSlide{{
		Order: 1, Title: "Slide", Type: "CONTENT", KeyPoints: []string{"Point"},
	}}}, nil
}

func (*reviewLLM) SlideContent(context.Context, SlideRequest) (json.RawMessage, error) {
	return json.RawMessage(`{"heading":"Slide","bullets":[{"text":"Original"}]}`), nil
}

func (llm *reviewLLM) Critique(context.Context, CritiqueRequest) (string, error) {
	llm.critiqueCalls++
	return llm.critiqueFeedback, llm.critiqueErr
}

func (llm *reviewLLM) CritiqueOutline(_ context.Context, outline Outline, _ string) (Outline, bool, error) {
	llm.critiqueOutlineCalls++
	if llm.critiqueOutlineErr != nil {
		return Outline{}, false, llm.critiqueOutlineErr
	}
	if len(llm.critiqueOutline.Slides) == 0 {
		return outline, false, nil
	}
	return llm.critiqueOutline, true, nil
}

func (llm *reviewLLM) Edit(context.Context, json.RawMessage, string, string) (json.RawMessage, error) {
	llm.editCalls++
	return llm.editContent, llm.editErr
}

func (*reviewLLM) SlideHTML(context.Context, string, SlideRequest) (string, error) {
	return "", errors.New("unexpected slide HTML call")
}

func (*reviewLLM) EditHTML(context.Context, string, string) (string, error) {
	return "", errors.New("unexpected edit HTML call")
}

func TestProcessSkipsEditWhenCritiqueApproves(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	presentationID := "presentation-1"
	repo.presentations[presentationID] = Presentation{ID: presentationID, Status: "GENERATING"}
	repo.jobs["job-1"] = Job{
		ID: "job-1", UserID: "user-1", Status: "QUEUED", PresentationID: &presentationID,
		Input: json.RawMessage(`{"sourceType":"TEXT","content":"c","slideCount":1,"language":"en"}`),
	}
	llm := &reviewLLM{critiqueFeedback: ""}
	service := NewService(repo, llm, new(recordingQueue))

	service.Process(context.Background(), "job-1")

	if llm.editCalls != 0 {
		t.Fatalf("edit calls = %d, want 0 when critique approves", llm.editCalls)
	}
	if len(repo.slides) != 1 {
		t.Fatalf("persisted slides = %d, want 1", len(repo.slides))
	}
	heading, _ := rawObject(repo.slides[0].Content)["heading"].(string)
	if heading != "Slide" {
		t.Fatalf("expected original content preserved, got heading %q", heading)
	}
}

func TestProcessAppliesEditWhenCritiqueRequestsChanges(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	presentationID := "presentation-1"
	repo.presentations[presentationID] = Presentation{ID: presentationID, Status: "GENERATING"}
	repo.jobs["job-1"] = Job{
		ID: "job-1", UserID: "user-1", Status: "QUEUED", PresentationID: &presentationID,
		Input: json.RawMessage(`{"sourceType":"TEXT","content":"c","slideCount":1,"language":"en"}`),
	}
	llm := &reviewLLM{
		critiqueFeedback: "Add the missing key point",
		editContent:      json.RawMessage(`{"heading":"Revised","bullets":[{"text":"Fixed"}]}`),
	}
	service := NewService(repo, llm, new(recordingQueue))

	service.Process(context.Background(), "job-1")

	if llm.editCalls != 1 {
		t.Fatalf("edit calls = %d, want 1 when critique requests changes", llm.editCalls)
	}
	// Final whole-branch review: lock in the "never re-critique, never loop"
	// bound the plan promises -- Critique runs exactly once per slide.
	if llm.critiqueCalls != 1 {
		t.Fatalf("critique calls = %d, want exactly 1 (no re-critique of the revision)", llm.critiqueCalls)
	}
	if len(repo.slides) != 1 {
		t.Fatalf("persisted slides = %d, want 1", len(repo.slides))
	}
	heading, _ := rawObject(repo.slides[0].Content)["heading"].(string)
	if heading != "Revised" {
		t.Fatalf("expected the Edit result stored, got heading %q", heading)
	}
}

func TestProcessFallsBackToOriginalContentWhenEditFailsAfterCritiqueRejects(t *testing.T) {
	// Final whole-branch review: the critique-error fallback (tested above)
	// short-circuits before Edit is ever called; this covers the other
	// fallback path, where Edit itself is the one that fails.
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	presentationID := "presentation-1"
	repo.presentations[presentationID] = Presentation{ID: presentationID, Status: "GENERATING"}
	repo.jobs["job-1"] = Job{
		ID: "job-1", UserID: "user-1", Status: "QUEUED", PresentationID: &presentationID,
		Input: json.RawMessage(`{"sourceType":"TEXT","content":"c","slideCount":1,"language":"en"}`),
	}
	llm := &reviewLLM{
		critiqueFeedback: "Add the missing key point",
		editErr:          errors.New("edit network error"),
	}
	service := NewService(repo, llm, new(recordingQueue))

	service.Process(context.Background(), "job-1")

	if llm.editCalls != 1 {
		t.Fatalf("edit calls = %d, want 1 (edit is attempted even though it will fail)", llm.editCalls)
	}
	if len(repo.slides) != 1 {
		t.Fatalf("persisted slides = %d, want 1 (generation must not fail on an edit error)", len(repo.slides))
	}
	heading, _ := rawObject(repo.slides[0].Content)["heading"].(string)
	if heading != "Slide" {
		t.Fatalf("expected original content preserved when edit fails, got heading %q", heading)
	}
}

func TestProcessFallsBackToOriginalContentWhenCritiqueFails(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	presentationID := "presentation-1"
	repo.presentations[presentationID] = Presentation{ID: presentationID, Status: "GENERATING"}
	repo.jobs["job-1"] = Job{
		ID: "job-1", UserID: "user-1", Status: "QUEUED", PresentationID: &presentationID,
		Input: json.RawMessage(`{"sourceType":"TEXT","content":"c","slideCount":1,"language":"en"}`),
	}
	llm := &reviewLLM{critiqueErr: errors.New("network error")}
	service := NewService(repo, llm, new(recordingQueue))

	service.Process(context.Background(), "job-1")

	if llm.editCalls != 0 {
		t.Fatalf("edit calls = %d, want 0 when critique fails", llm.editCalls)
	}
	if len(repo.slides) != 1 {
		t.Fatalf("persisted slides = %d, want 1 (generation must not fail on a critique error)", len(repo.slides))
	}
	heading, _ := rawObject(repo.slides[0].Content)["heading"].(string)
	if heading != "Slide" {
		t.Fatalf("expected original content preserved on critique failure, got heading %q", heading)
	}
}

func TestStartQueuesTenSlideGenerationAndPersistsProgress(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	queue := new(recordingQueue)
	service := NewService(repo, nil, queue)

	result, err := service.Start(context.Background(), Principal{ID: "user-1"}, StartInput{
		Title: "Security", SourceType: "TEXT", Content: "AI security", SlideCount: 10, Language: "ko",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(queue.ids) != 1 || queue.ids[0] != result.JobID {
		t.Fatalf("queued IDs = %v, want %s", queue.ids, result.JobID)
	}
	job := repo.jobs[result.JobID]
	var input StartInput
	if err := json.Unmarshal(job.Input, &input); err != nil {
		t.Fatal(err)
	}
	if input.SlideCount != 10 || job.Status != "QUEUED" || job.Progress != 0 {
		t.Fatalf("job = %#v input = %#v", job, input)
	}

	if err := service.updateStatus(context.Background(), result.JobID, "GENERATING_CONTENT", 55); err != nil {
		t.Fatal(err)
	}
	status, err := service.Status(context.Background(), result.JobID, "user-1")
	if err != nil {
		t.Fatal(err)
	}
	if status.Status != "GENERATING_CONTENT" || status.Progress != 55 {
		t.Fatalf("status = %#v", status)
	}
}

func TestCancelPreventsFurtherProgress(t *testing.T) {
	repo := newMemoryRepository()
	queue := new(recordingQueue)
	service := NewService(repo, nil, queue)
	repo.jobs["job-1"] = Job{ID: "job-1", UserID: "user-1", Status: "QUEUED"}

	if err := service.Cancel(context.Background(), "job-1", "user-1"); err != nil {
		t.Fatal(err)
	}
	if err := service.updateStatus(context.Background(), "job-1", "GENERATING_CONTENT", 50); !errors.Is(err, ErrCancelled) {
		t.Fatalf("updateStatus error = %v, want ErrCancelled", err)
	}
	if repo.jobs["job-1"].Status != "CANCELLED" {
		t.Fatalf("job status = %s", repo.jobs["job-1"].Status)
	}
}

func TestStartMarksJobAndPresentationFailedWhenQueueAddFails(t *testing.T) {
	repo := newMemoryRepository()
	ctx, cancel := context.WithCancel(context.Background())
	queue := cancellingQueue{cancel: cancel}
	service := NewService(repo, nil, queue)

	_, err := service.Start(ctx, Principal{ID: "user-1"}, StartInput{
		SourceType: "TEXT", Content: "AI security", SlideCount: 1,
	})
	if err == nil {
		t.Fatal("Start() error = nil, want queue error")
	}
	for _, job := range repo.jobs {
		if job.Status != "FAILED" {
			t.Fatalf("job status = %s, want FAILED", job.Status)
		}
		if got := repo.presentations[*job.PresentationID].Status; got != "FAILED" {
			t.Fatalf("presentation status = %s, want FAILED", got)
		}
	}
}

func TestProcessIgnoresFailedJobLeftInRedis(t *testing.T) {
	repo := newMemoryRepository()
	presentationID := "presentation-1"
	repo.presentations[presentationID] = Presentation{ID: presentationID, Status: "FAILED"}
	repo.jobs["job-1"] = Job{
		ID: "job-1", UserID: "user-1", Status: "FAILED", PresentationID: &presentationID,
		Input: json.RawMessage(`{"sourceType":"TEXT","content":"AI security","slideCount":1,"language":"en"}`),
	}
	service := NewService(repo, new(maliciousHTMLLLM), new(recordingQueue))

	service.Process(context.Background(), "job-1")

	if got := repo.jobs["job-1"].Status; got != "FAILED" {
		t.Fatalf("job status = %s, want FAILED", got)
	}
	if len(repo.slides) != 0 {
		t.Fatalf("persisted slides = %d, want 0", len(repo.slides))
	}
}

func TestRunRecoversQueuedAndActiveJobs(t *testing.T) {
	repo := newMemoryRepository()
	recoverable := []string{
		"QUEUED", "PROCESSING", "GENERATING_OUTLINE", "GENERATING_CONTENT", "APPLYING_DESIGN", "RENDERING",
	}
	for index, status := range append(recoverable, "COMPLETED", "FAILED", "CANCELLED") {
		id := fmt.Sprintf("job-%d", index)
		repo.jobs[id] = Job{ID: id, Status: status}
	}
	queue := &recoveryQueue{added: make(chan string, len(repo.jobs))}
	service := NewService(repo, nil, queue)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		service.Run(ctx)
		close(done)
	}()

	got := map[string]bool{}
	for range recoverable {
		select {
		case id := <-queue.added:
			got[repo.jobs[id].Status] = true
		case <-time.After(time.Second):
			t.Fatal("Run() did not enqueue every recoverable job")
		}
	}
	cancel()
	<-done
	for _, status := range recoverable {
		if !got[status] {
			t.Errorf("status %s was not recovered", status)
		}
	}
	select {
	case id := <-queue.added:
		t.Fatalf("terminal job %s with status %s was recovered", id, repo.jobs[id].Status)
	default:
	}
}

func TestCancelStopsRunningJobContextAndFailsPresentation(t *testing.T) {
	repo := newMemoryRepository()
	presentationID := "presentation-1"
	repo.presentations[presentationID] = Presentation{ID: presentationID, Status: "GENERATING"}
	repo.jobs["job-1"] = Job{
		ID: "job-1", UserID: "user-1", Status: "QUEUED", PresentationID: &presentationID,
		Input: json.RawMessage(`{"sourceType":"TEXT","content":"AI security","slideCount":1,"language":"en"}`),
	}
	llm := &cancellableLLM{
		started: make(chan struct{}), cancelled: make(chan struct{}), release: make(chan struct{}),
	}
	service := NewService(repo, llm, new(recordingQueue))
	done := make(chan struct{})
	go func() {
		service.Process(context.Background(), "job-1")
		close(done)
	}()
	<-llm.started

	if err := service.Cancel(context.Background(), "job-1", "user-1"); err != nil {
		close(llm.release)
		t.Fatal(err)
	}
	select {
	case <-llm.cancelled:
	case <-time.After(time.Second):
		close(llm.release)
		<-done
		t.Fatal("running LLM context was not cancelled")
	}
	<-done
	if got := repo.jobs["job-1"].Status; got != "CANCELLED" {
		t.Fatalf("job status = %s, want CANCELLED", got)
	}
	if got := repo.presentations[presentationID].Status; got != "FAILED" {
		t.Fatalf("presentation status = %s, want FAILED", got)
	}
}

func TestStartAndOutlineRejectPrivateTemplateOutsideOrganization(t *testing.T) {
	repo := newMemoryRepository()
	userOrg, otherOrg := "org-1", "org-2"
	repo.users["user-1"] = db.User{ID: "user-1", OrganizationID: &userOrg}
	repo.templates["private-template"] = memoryTemplate{
		config: json.RawMessage(`{}`), organizationID: &otherOrg,
	}
	templateID := "private-template"
	service := NewService(repo, new(maliciousHTMLLLM), new(recordingQueue))

	if _, err := service.Start(context.Background(), Principal{ID: "user-1", OrganizationID: &userOrg}, StartInput{
		SourceType: "TEXT", Content: "AI security", SlideCount: 1, TemplateID: &templateID,
	}); !errors.Is(err, ErrBadInput) {
		t.Fatalf("Start() error = %v, want ErrBadInput", err)
	}
	if _, err := service.GenerateOutline(context.Background(), Principal{ID: "user-1", OrganizationID: &userOrg}, OutlineInput{
		Content: "AI security", SlideCount: pointerTo(1), TemplateID: &templateID,
	}); !errors.Is(err, ErrBadInput) {
		t.Fatalf("GenerateOutline() error = %v, want ErrBadInput", err)
	}
}

func TestGenerateOutlineAllowsOrganizationlessUserToSeeTheirOwnPrivateTemplate(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	repo.templates["own-template"] = memoryTemplate{
		config: json.RawMessage(`{}`), userID: "user-1",
	}
	templateID := "own-template"
	service := NewService(repo, new(maliciousHTMLLLM), new(recordingQueue))

	if _, err := service.GenerateOutline(context.Background(), Principal{ID: "user-1"}, OutlineInput{
		Content: "AI security", SlideCount: pointerTo(1), TemplateID: &templateID,
	}); err != nil {
		t.Fatalf("GenerateOutline() error = %v, want nil", err)
	}
}

func TestGenerateOutlineAllowsSameOrganizationColleagueToSeeASharedTemplate(t *testing.T) {
	repo := newMemoryRepository()
	sharedOrg := "org-1"
	repo.users["colleague"] = db.User{ID: "colleague", OrganizationID: &sharedOrg}
	repo.templates["team-template"] = memoryTemplate{
		config: json.RawMessage(`{}`), userID: "owner", organizationID: &sharedOrg,
	}
	templateID := "team-template"
	service := NewService(repo, new(maliciousHTMLLLM), new(recordingQueue))

	if _, err := service.GenerateOutline(context.Background(), Principal{ID: "colleague", OrganizationID: &sharedOrg}, OutlineInput{
		Content: "AI security", SlideCount: pointerTo(1), TemplateID: &templateID,
	}); err != nil {
		t.Fatalf("GenerateOutline() error = %v, want nil", err)
	}
}

func TestGenerateOutlineRejectsAnotherOrganizationlessUsersPrivateTemplate(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["stranger"] = db.User{ID: "stranger"}
	repo.templates["someone-elses-template"] = memoryTemplate{
		config: json.RawMessage(`{}`), userID: "owner",
	}
	templateID := "someone-elses-template"
	service := NewService(repo, new(maliciousHTMLLLM), new(recordingQueue))

	if _, err := service.GenerateOutline(context.Background(), Principal{ID: "stranger"}, OutlineInput{
		Content: "AI security", SlideCount: pointerTo(1), TemplateID: &templateID,
	}); !errors.Is(err, ErrBadInput) {
		t.Fatalf("GenerateOutline() error = %v, want ErrBadInput", err)
	}
}

func TestGenerateOutlineAllowsAnyoneToSeeAPublicTemplate(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["anyone"] = db.User{ID: "anyone"}
	repo.templates["public-template"] = memoryTemplate{
		config: json.RawMessage(`{}`), userID: "owner", public: true,
	}
	templateID := "public-template"
	service := NewService(repo, new(maliciousHTMLLLM), new(recordingQueue))

	if _, err := service.GenerateOutline(context.Background(), Principal{ID: "anyone"}, OutlineInput{
		Content: "AI security", SlideCount: pointerTo(1), TemplateID: &templateID,
	}); err != nil {
		t.Fatalf("GenerateOutline() error = %v, want nil", err)
	}
}

func TestProcessSanitizesTemplateAndGeneratedHTMLBeforePersistence(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	repo.templates["template-1"] = memoryTemplate{
		public: true,
		config: json.RawMessage(`{"htmlSlides":["<div data-object='true' onclick='steal()'>Template<script>steal()</script></div>"]}`),
	}
	presentationID := "presentation-1"
	repo.presentations[presentationID] = Presentation{ID: presentationID, Status: "GENERATING"}
	repo.jobs["job-1"] = Job{
		ID: "job-1", UserID: "user-1", Status: "QUEUED", PresentationID: &presentationID,
		Input: json.RawMessage(`{"sourceType":"TEXT","content":"AI security","slideCount":1,"language":"en","templateId":"template-1"}`),
	}
	llm := new(maliciousHTMLLLM)
	service := NewService(repo, llm, new(recordingQueue))

	service.Process(context.Background(), "job-1")

	for _, unsafe := range []string{"<script", "onclick"} {
		if strings.Contains(strings.ToLower(llm.seenTemplate), unsafe) {
			t.Fatalf("LLM received template HTML containing %q: %s", unsafe, llm.seenTemplate)
		}
	}
	if len(repo.slides) != 1 {
		t.Fatalf("persisted slides = %d, want 1", len(repo.slides))
	}
	html, _ := rawObject(repo.slides[0].Content)["html"].(string)
	for _, unsafe := range []string{"<script", "onclick", "onerror"} {
		if strings.Contains(strings.ToLower(html), unsafe) {
			t.Fatalf("persisted HTML contains %q: %s", unsafe, html)
		}
	}
	if !strings.Contains(html, `data-object="true"`) {
		t.Fatalf("persisted HTML lost template structure: %s", html)
	}
}

// The outline call already sees SkillGuidance (appended to its "content"
// input further up in Process) — this pins that the per-slide content call,
// which is what actually produces bullet levels, receives it too. Before
// this, a PPTX skill's auto-extracted bullet-hierarchy example only ever
// reached the outline, never the call that generates the bullets themselves.
func TestProcessPassesSkillGuidanceToSlideContentToo(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	presentationID := "presentation-1"
	repo.presentations[presentationID] = Presentation{ID: presentationID, Status: "GENERATING"}
	repo.jobs["job-1"] = Job{
		ID: "job-1", UserID: "user-1", Status: "QUEUED", PresentationID: &presentationID,
		Input: json.RawMessage(`{"sourceType":"TEXT","content":"AI security","slideCount":1,"language":"en",` +
			`"skillGuidance":"이 템플릿의 표는 최대 3단계 들여쓰기 구조를 사용합니다."}`),
	}
	llm := new(maliciousHTMLLLM)
	service := NewService(repo, llm, new(recordingQueue))

	service.Process(context.Background(), "job-1")

	if llm.seenSlideRequest.SkillGuidance != "이 템플릿의 표는 최대 3단계 들여쓰기 구조를 사용합니다." {
		t.Fatalf("SlideContent's SkillGuidance = %q, want the job's skillGuidance", llm.seenSlideRequest.SkillGuidance)
	}
}

// availableLevels is computed from the destination template slide's own
// paragraph levels (0 and 2 here, deliberately skipping 1) and threaded
// through Process() into the per-slide SlideContent call as
// SlideRequest.AvailableLevels — this pins that the wiring actually reaches
// the LLM call, not just that availableLevels() itself computes correctly
// (already covered by hierarchy_test.go).
func TestProcessGroundsBulletLevelGuidanceInTheTemplatesRealLevels(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	repo.templates["pptx-template"] = memoryTemplate{
		public: true,
		config: json.RawMessage(`{"source":{"kind":"pptx","slides":[{"objects":[{"kind":"text","paragraphs":[` +
			`{"text":"Top","level":0},{"text":"Nested","level":2}]}]}]}}`),
	}
	presentationID := "presentation-1"
	repo.presentations[presentationID] = Presentation{ID: presentationID, Status: "GENERATING"}
	repo.jobs["job-1"] = Job{
		ID: "job-1", UserID: "user-1", Status: "QUEUED", PresentationID: &presentationID,
		Input: json.RawMessage(`{"sourceType":"TEXT","content":"AI security","slideCount":1,"language":"en",` +
			`"templateId":"pptx-template"}`),
	}
	llm := new(maliciousHTMLLLM)
	service := NewService(repo, llm, new(recordingQueue))

	service.Process(context.Background(), "job-1")

	want := []int{0, 2}
	if !reflect.DeepEqual(llm.seenSlideRequest.AvailableLevels, want) {
		t.Fatalf("SlideContent's AvailableLevels = %v, want %v", llm.seenSlideRequest.AvailableLevels, want)
	}
}

// classifyingLLM adds ClassifyTemplateRoles on top of maliciousHTMLLLM's
// existing full LLM implementation, so it satisfies both LLM and (via the
// service.llm.(RoleClassifier) type assertion in template()) RoleClassifier.
type classifyingLLM struct {
	*maliciousHTMLLLM
	classifyCalls int
	roles         map[string]string
	classifyErr   error
}

func (llm *classifyingLLM) ClassifyTemplateRoles(_ context.Context, _ RoleClassificationRequest) (map[string]string, error) {
	llm.classifyCalls++
	if llm.classifyErr != nil {
		return nil, llm.classifyErr
	}
	return llm.roles, nil
}

func TestTemplateClassifiesAndPersistsRolesOnFirstUseThenReusesThem(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	repo.templates["pptx-template"] = memoryTemplate{
		public: true,
		config: json.RawMessage(`{"source":{"kind":"pptx","slides":[{"objects":[` +
			`{"id":"shape-1","kind":"text","fontSize":32,"text":"Heading"},` +
			`{"id":"shape-2","kind":"text","fontSize":14,"text":"Body"}` +
			`]}]}}`),
	}
	llm := &classifyingLLM{
		maliciousHTMLLLM: &maliciousHTMLLLM{},
		roles:            map[string]string{"shape-1": "title", "shape-2": "body"},
	}
	service := NewService(repo, llm, new(recordingQueue))
	templateID := "pptx-template"

	template, err := service.template(context.Background(), &templateID, "user-1")
	if err != nil {
		t.Fatalf("template() error = %v", err)
	}
	if llm.classifyCalls != 1 {
		t.Fatalf("classifyCalls = %d, want 1", llm.classifyCalls)
	}
	objects := template.objects(0)
	if objects[0]["role"] != "title" || objects[1]["role"] != "body" {
		t.Fatalf("objects roles = %v / %v, want title / body", objects[0]["role"], objects[1]["role"])
	}

	if _, err := service.template(context.Background(), &templateID, "user-1"); err != nil {
		t.Fatalf("template() second call error = %v", err)
	}
	if llm.classifyCalls != 1 {
		t.Fatalf("classifyCalls after second template() call = %d, want still 1 (persisted, not re-classified)", llm.classifyCalls)
	}
}

func TestTemplateLeavesTemplateUnclassifiedWhenClassificationFails(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	repo.templates["pptx-template"] = memoryTemplate{
		public: true,
		config: json.RawMessage(`{"source":{"kind":"pptx","slides":[{"objects":[` +
			`{"id":"shape-1","kind":"text","fontSize":32,"text":"Heading"}` +
			`]}]}}`),
	}
	llm := &classifyingLLM{maliciousHTMLLLM: &maliciousHTMLLLM{}, classifyErr: errors.New("LLM unavailable")}
	service := NewService(repo, llm, new(recordingQueue))
	templateID := "pptx-template"

	template, err := service.template(context.Background(), &templateID, "user-1")
	if err != nil {
		t.Fatalf("template() error = %v, want nil (classification failure must not fail template())", err)
	}
	if _, hasRole := template.objects(0)[0]["role"]; hasRole {
		t.Fatal("objects[0] has a role after a failed classification, want none")
	}
}

func TestProcessUsesOriginalOutlineWhenCritiqueOutlineApproves(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	presentationID := "presentation-1"
	repo.presentations[presentationID] = Presentation{ID: presentationID, Status: "GENERATING"}
	repo.jobs["job-1"] = Job{
		ID: "job-1", UserID: "user-1", Status: "QUEUED", PresentationID: &presentationID,
		Input: json.RawMessage(`{"sourceType":"TEXT","content":"c","slideCount":1,"language":"en"}`),
	}
	llm := &reviewLLM{}
	service := NewService(repo, llm, new(recordingQueue))

	service.Process(context.Background(), "job-1")

	if llm.critiqueOutlineCalls != 1 {
		t.Fatalf("critique outline calls = %d, want 1", llm.critiqueOutlineCalls)
	}
	if len(repo.slides) != 1 {
		t.Fatalf("persisted slides = %d, want 1", len(repo.slides))
	}
	title := repo.slides[0].Title
	if title == nil || *title != "Slide" {
		t.Fatalf("expected the original outline's slide title, got %v", title)
	}
}

func TestProcessUsesCorrectedOutlineWhenCritiqueOutlineRejects(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	presentationID := "presentation-1"
	repo.presentations[presentationID] = Presentation{ID: presentationID, Status: "GENERATING"}
	repo.jobs["job-1"] = Job{
		ID: "job-1", UserID: "user-1", Status: "QUEUED", PresentationID: &presentationID,
		Input: json.RawMessage(`{"sourceType":"TEXT","content":"c","slideCount":2,"language":"en"}`),
	}
	llm := &reviewLLM{critiqueOutline: Outline{Title: "Deck", Slides: []OutlineSlide{
		{Order: 1, Title: "Corrected One", Type: "CONTENT", KeyPoints: []string{"A"}},
		{Order: 2, Title: "Corrected Two", Type: "CONTENT", KeyPoints: []string{"B"}},
	}}}
	service := NewService(repo, llm, new(recordingQueue))

	service.Process(context.Background(), "job-1")

	if len(repo.slides) != 2 {
		t.Fatalf("persisted slides = %d, want 2 (the corrected outline)", len(repo.slides))
	}
	first := repo.slides[0].Title
	if first == nil || *first != "Corrected One" {
		t.Fatalf("expected the corrected outline's first slide title, got %v", first)
	}
}

func TestProcessFallsBackToOriginalOutlineWhenCritiqueOutlineFails(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	presentationID := "presentation-1"
	repo.presentations[presentationID] = Presentation{ID: presentationID, Status: "GENERATING"}
	repo.jobs["job-1"] = Job{
		ID: "job-1", UserID: "user-1", Status: "QUEUED", PresentationID: &presentationID,
		Input: json.RawMessage(`{"sourceType":"TEXT","content":"c","slideCount":1,"language":"en"}`),
	}
	llm := &reviewLLM{critiqueOutlineErr: errors.New("outline critique unavailable")}
	service := NewService(repo, llm, new(recordingQueue))

	service.Process(context.Background(), "job-1")

	if len(repo.slides) != 1 {
		t.Fatalf("persisted slides = %d, want 1 (fallback to the original outline)", len(repo.slides))
	}
	title := repo.slides[0].Title
	if title == nil || *title != "Slide" {
		t.Fatalf("expected the original outline's slide title after a critique failure, got %v", title)
	}
}

func TestProcessSkipsCritiqueOutlineForCallerSuppliedOutline(t *testing.T) {
	repo := newMemoryRepository()
	repo.users["user-1"] = db.User{ID: "user-1"}
	presentationID := "presentation-1"
	repo.presentations[presentationID] = Presentation{ID: presentationID, Status: "GENERATING"}
	repo.jobs["job-1"] = Job{
		ID: "job-1", UserID: "user-1", Status: "QUEUED", PresentationID: &presentationID,
		Input: json.RawMessage(`{"sourceType":"TEXT","content":"c","language":"en","outline":{"title":"Deck","slides":[{"order":1,"title":"Given","type":"CONTENT","keyPoints":["P"]}]}}`),
	}
	llm := &reviewLLM{}
	service := NewService(repo, llm, new(recordingQueue))

	service.Process(context.Background(), "job-1")

	if llm.critiqueOutlineCalls != 0 {
		t.Fatalf("critique outline calls = %d, want 0 for a caller-supplied outline", llm.critiqueOutlineCalls)
	}
	if len(repo.slides) != 1 {
		t.Fatalf("persisted slides = %d, want 1", len(repo.slides))
	}
}

func pointerTo(value int) *int { return &value }
