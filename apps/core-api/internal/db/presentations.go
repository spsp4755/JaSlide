package db

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
)

type Presentation struct {
	ID            string
	Title         string
	Description   *string
	UserID        string
	TemplateID    *string
	SkillID       *string
	Status        string
	SourceType    string
	SourceContent *string
	Metadata      json.RawMessage
	IsPublic      bool
	ShareToken    *string
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type PresentationPage struct {
	Data       []Presentation
	Total      int
	Page       int
	Limit      int
	TotalPages int
}

const selectPresentation = `
	SELECT "id", "title", "description", "userId", "templateId", "skillId",
		"status"::text, "sourceType"::text, "sourceContent", "metadata",
		"isPublic", "shareToken", "createdAt", "updatedAt"
	FROM "Presentation"`

func (store *Store) ListPresentations(ctx context.Context, userID string, page, limit int) (PresentationPage, error) {
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 10
	}

	var total int
	if err := store.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM "Presentation" WHERE "userId" = $1`, userID,
	).Scan(&total); err != nil {
		return PresentationPage{}, err
	}

	rows, err := store.pool.Query(ctx, selectPresentation+`
		WHERE "userId" = $1
		ORDER BY "updatedAt" DESC
		LIMIT $2 OFFSET $3`, userID, limit, (page-1)*limit)
	if err != nil {
		return PresentationPage{}, err
	}
	defer rows.Close()

	presentations := make([]Presentation, 0)
	for rows.Next() {
		presentation, err := scanPresentation(rows)
		if err != nil {
			return PresentationPage{}, err
		}
		presentations = append(presentations, presentation)
	}
	if err := rows.Err(); err != nil {
		return PresentationPage{}, err
	}

	return PresentationPage{
		Data:       presentations,
		Total:      total,
		Page:       page,
		Limit:      limit,
		TotalPages: (total + limit - 1) / limit,
	}, nil
}

func (store *Store) GetPresentation(ctx context.Context, id string) (Presentation, error) {
	return scanPresentation(store.pool.QueryRow(ctx, selectPresentation+` WHERE "id" = $1`, id))
}

func scanPresentation(row pgx.Row) (Presentation, error) {
	var presentation Presentation
	err := row.Scan(
		&presentation.ID, &presentation.Title, &presentation.Description,
		&presentation.UserID, &presentation.TemplateID, &presentation.SkillID,
		&presentation.Status, &presentation.SourceType, &presentation.SourceContent,
		&presentation.Metadata, &presentation.IsPublic, &presentation.ShareToken,
		&presentation.CreatedAt, &presentation.UpdatedAt,
	)
	return presentation, err
}
