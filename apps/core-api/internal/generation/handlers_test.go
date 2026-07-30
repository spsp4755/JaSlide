package generation

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
)

type memoryRepository struct {
	users         map[string]db.User
	presentations map[string]Presentation
	jobs          map[string]Job
	skills        map[string]Skill
}

func newMemoryRepository() *memoryRepository {
	return &memoryRepository{
		users: map[string]db.User{}, presentations: map[string]Presentation{},
		jobs: map[string]Job{}, skills: map[string]Skill{},
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

func (repo *memoryRepository) TemplateConfig(_ context.Context, _ string) (json.RawMessage, error) {
	return json.RawMessage(`{}`), nil
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

func (repo *memoryRepository) FailGeneration(_ context.Context, id string, raw json.RawMessage) error {
	job := repo.jobs[id]
	job.Status, job.Error = "FAILED", raw
	repo.jobs[id] = job
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
	return true, nil
}

func (repo *memoryRepository) CompleteGeneration(context.Context, string, string, []Slide) error {
	return nil
}

func (repo *memoryRepository) SlideForEdit(context.Context, string, string) (Slide, error) {
	return Slide{}, errors.New("not found")
}

func (repo *memoryRepository) UpdateSlideContent(context.Context, string, json.RawMessage) (Slide, error) {
	return Slide{}, errors.New("not found")
}

func (repo *memoryRepository) QueuedGenerationIDs(context.Context) ([]string, error) { return nil, nil }

type recordingQueue struct{ ids []string }

func (queue *recordingQueue) Add(_ context.Context, id string) error {
	queue.ids = append(queue.ids, id)
	return nil
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
