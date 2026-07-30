package generation

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
)

type SQLStore struct{ db *db.Store }

func NewSQLStore(store *db.Store) *SQLStore { return &SQLStore{db: store} }

func (store *SQLStore) DefaultModel(ctx context.Context) (Model, error) {
	var model Model
	var endpoint, apiKey, apiKeyEnvVar *string
	err := store.db.Pool().QueryRow(ctx, `
		SELECT "id","name","provider","modelId","endpoint","apiKey","apiKeyEnvVar","maxTokens","isActive"
		FROM "LlmModel" WHERE "isActive"
		ORDER BY "isDefault" DESC,"createdAt" ASC LIMIT 1`,
	).Scan(
		&model.ID, &model.Name, &model.Provider, &model.ModelID, &endpoint,
		&apiKey, &apiKeyEnvVar, &model.MaxTokens, &model.IsActive,
	)
	if endpoint != nil {
		model.Endpoint = *endpoint
	}
	if apiKey != nil {
		model.APIKey = *apiKey
	}
	if apiKeyEnvVar != nil {
		model.APIKeyEnvVar = *apiKeyEnvVar
	}
	return model, err
}

func (store *SQLStore) VisibleSkill(ctx context.Context, id, userID string, organizationID *string) (Skill, error) {
	var skill Skill
	err := store.db.Pool().QueryRow(ctx, `
		SELECT "id",COALESCE("userId",''),"organizationId","templateId","outlineGuidance","isPublic"
		FROM "PresentationSkill"
		WHERE "id"=$1 AND ("isPublic" OR "userId"=$2 OR ($3::text IS NOT NULL AND "organizationId"=$3))`,
		id, userID, organizationID).Scan(
		&skill.ID, &skill.UserID, &skill.OrganizationID, &skill.TemplateID,
		&skill.OutlineGuidance, &skill.IsPublic,
	)
	return skill, err
}

func (store *SQLStore) TemplateConfig(ctx context.Context, id string) (json.RawMessage, error) {
	var raw json.RawMessage
	err := store.db.Pool().QueryRow(ctx, `SELECT "config" FROM "Template" WHERE "id"=$1`, id).Scan(&raw)
	return raw, err
}

func (store *SQLStore) CreateGeneration(ctx context.Context, presentation Presentation, job Job) error {
	tx, err := store.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `
		INSERT INTO "Presentation"
			("id","title","userId","templateId","skillId","status","sourceType","sourceContent","updatedAt")
		VALUES ($1,$2,$3,$4,$5,$6::"PresentationStatus",$7::"SourceType",$8,NOW())`,
		presentation.ID, presentation.Title, presentation.UserID, presentation.TemplateID,
		presentation.SkillID, presentation.Status, presentation.SourceType, presentation.Content,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO "GenerationJob"
			("id","userId","presentationId","skillId","status","input","progress","updatedAt")
		VALUES ($1,$2,$3,$4,$5::"GenerationStatus",$6,$7,NOW())`,
		job.ID, job.UserID, job.PresentationID, job.SkillID, job.Status, job.Input, job.Progress,
	); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (store *SQLStore) GenerationJob(ctx context.Context, id, userID string) (Job, error) {
	var job Job
	err := store.db.Pool().QueryRow(ctx, `
		SELECT j."id",j."userId",j."presentationId",j."skillId",j."status"::text,
			j."input",j."progress",j."error",
			CASE WHEN j."status"='COMPLETED' THEN (
				SELECT jsonb_build_object(
					'id',p."id",'title',p."title",'description',p."description",
					'userId',p."userId",'templateId',p."templateId",'skillId',p."skillId",
					'status',p."status",'sourceType',p."sourceType",'sourceContent',p."sourceContent",
					'metadata',p."metadata",'isPublic',p."isPublic",'shareToken',p."shareToken",
					'createdAt',p."createdAt",'updatedAt',p."updatedAt",
					'slides',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s."order") FROM "Slide" s WHERE s."presentationId"=p."id"),'[]'::jsonb)
				) FROM "Presentation" p WHERE p."id"=j."presentationId"
			) END
		FROM "GenerationJob" j WHERE j."id"=$1 AND ($2='' OR j."userId"=$2)`,
		id, userID,
	).Scan(
		&job.ID, &job.UserID, &job.PresentationID, &job.SkillID, &job.Status,
		&job.Input, &job.Progress, &job.Error, &job.Presentation,
	)
	return job, err
}

func (store *SQLStore) FailGeneration(ctx context.Context, id string, errorValue json.RawMessage) error {
	_, err := store.db.Pool().Exec(ctx, `
		WITH failed AS (
			UPDATE "GenerationJob"
			SET "status"='FAILED',"error"=$2,"completedAt"=NOW(),"updatedAt"=NOW()
			WHERE "id"=$1 AND "status"<>'CANCELLED'
			RETURNING "presentationId"
		)
		UPDATE "Presentation" SET "status"='FAILED',"updatedAt"=NOW()
		WHERE "id"=(SELECT "presentationId" FROM failed)`, id, errorValue)
	return err
}

func (store *SQLStore) SetGenerationStatus(
	ctx context.Context, id, status string, progress int, errorValue json.RawMessage,
) (bool, error) {
	result, err := store.db.Pool().Exec(ctx, `
		UPDATE "GenerationJob"
		SET "status"=$2::"GenerationStatus","progress"=$3,"error"=$4,
			"startedAt"=CASE WHEN $2 IN ('GENERATING_OUTLINE','PROCESSING') THEN COALESCE("startedAt",NOW()) ELSE "startedAt" END,
			"completedAt"=CASE WHEN $2 IN ('COMPLETED','FAILED','CANCELLED') THEN NOW() ELSE NULL END,
			"updatedAt"=NOW()
		WHERE "id"=$1 AND "status"<>'CANCELLED'`,
		id, status, progress, nullableJSON(errorValue),
	)
	return result.RowsAffected() == 1, err
}

func (store *SQLStore) CancelGeneration(ctx context.Context, id, userID string) (bool, error) {
	result, err := store.db.Pool().Exec(ctx, `
		UPDATE "GenerationJob" SET "status"='CANCELLED',"completedAt"=NOW(),"updatedAt"=NOW()
		WHERE "id"=$1 AND "userId"=$2 AND "status" NOT IN ('COMPLETED','FAILED','CANCELLED')`,
		id, userID,
	)
	return result.RowsAffected() == 1, err
}

func (store *SQLStore) CompleteGeneration(ctx context.Context, jobID, title string, slides []Slide) error {
	tx, err := store.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var presentationID string
	if err := tx.QueryRow(ctx, `
		SELECT "presentationId" FROM "GenerationJob"
		WHERE "id"=$1 AND "status"<>'CANCELLED' FOR UPDATE`, jobID).Scan(&presentationID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrCancelled
		}
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM "Slide" WHERE "presentationId"=$1`, presentationID); err != nil {
		return err
	}
	for _, slide := range slides {
		if _, err := tx.Exec(ctx, `
			INSERT INTO "Slide"
				("id","presentationId","order","type","title","content","layout","notes","updatedAt")
			VALUES ($1,$2,$3,$4::"SlideType",$5,$6,$7,$8,NOW())`,
			slide.ID, presentationID, slide.Order, slide.Type, slide.Title,
			slide.Content, slide.Layout, slide.Notes,
		); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `
		UPDATE "Presentation" SET "title"=$2,"status"='COMPLETED',"updatedAt"=NOW() WHERE "id"=$1`,
		presentationID, title,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE "GenerationJob" SET "status"='COMPLETED',"progress"=100,
			"completedAt"=NOW(),"updatedAt"=NOW() WHERE "id"=$1 AND "status"<>'CANCELLED'`,
		jobID,
	); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (store *SQLStore) SlideForEdit(ctx context.Context, id, userID string) (Slide, error) {
	var slide Slide
	err := store.db.Pool().QueryRow(ctx, `
		SELECT s."id",s."presentationId",s."order",s."type"::text,s."title",
			s."content",s."layout",s."notes"
		FROM "Slide" s JOIN "Presentation" p ON p."id"=s."presentationId"
		WHERE s."id"=$1 AND p."userId"=$2`, id, userID,
	).Scan(
		&slide.ID, &slide.PresentationID, &slide.Order, &slide.Type, &slide.Title,
		&slide.Content, &slide.Layout, &slide.Notes,
	)
	return slide, err
}

func (store *SQLStore) UpdateSlideContent(ctx context.Context, id string, content json.RawMessage) (Slide, error) {
	var slide Slide
	err := store.db.Pool().QueryRow(ctx, `
		UPDATE "Slide" SET "content"=$2,"updatedAt"=NOW() WHERE "id"=$1
		RETURNING "id","presentationId","order","type"::text,"title","content","layout","notes"`,
		id, content,
	).Scan(
		&slide.ID, &slide.PresentationID, &slide.Order, &slide.Type, &slide.Title,
		&slide.Content, &slide.Layout, &slide.Notes,
	)
	return slide, err
}

func (store *SQLStore) QueuedGenerationIDs(ctx context.Context) ([]string, error) {
	rows, err := store.db.Pool().Query(ctx, `SELECT "id" FROM "GenerationJob" WHERE "status"='QUEUED' ORDER BY "createdAt"`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		result = append(result, id)
	}
	return result, rows.Err()
}

func nullableJSON(value json.RawMessage) any {
	if len(value) == 0 {
		return nil
	}
	return value
}
