package generation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	user := repo.users[userID]
	if !ok || (!template.public &&
		(template.organizationID == nil || user.OrganizationID == nil || *template.organizationID != *user.OrganizationID)) {
		return nil, errors.New("not found")
	}
	return template.config, nil
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

type maliciousHTMLLLM struct{ seenTemplate string }

func (*maliciousHTMLLLM) Outline(context.Context, OutlineRequest) (Outline, error) {
	return Outline{Title: "Deck", Slides: []OutlineSlide{{
		Order: 1, Title: "Slide", Type: "CONTENT", KeyPoints: []string{"Point"},
	}}}, nil
}

func (*maliciousHTMLLLM) SlideContent(context.Context, SlideRequest) (json.RawMessage, error) {
	return json.RawMessage(`{"heading":"Slide","bullets":[{"text":"Point"}]}`), nil
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

func (*cancellableLLM) Edit(context.Context, json.RawMessage, string, string) (json.RawMessage, error) {
	return nil, errors.New("unexpected edit call")
}

func (*cancellableLLM) SlideHTML(context.Context, string, SlideRequest) (string, error) {
	return "", errors.New("unexpected slide HTML call")
}

func (*cancellableLLM) EditHTML(context.Context, string, string) (string, error) {
	return "", errors.New("unexpected edit HTML call")
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

func pointerTo(value int) *int { return &value }
