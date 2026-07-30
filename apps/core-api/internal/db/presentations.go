package db

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type Presentation struct {
	ID            string          `json:"id"`
	Title         string          `json:"title"`
	Description   *string         `json:"description"`
	UserID        string          `json:"userId"`
	TemplateID    *string         `json:"templateId"`
	SkillID       *string         `json:"skillId"`
	Status        string          `json:"status"`
	SourceType    string          `json:"sourceType"`
	SourceContent *string         `json:"sourceContent"`
	Metadata      json.RawMessage `json:"metadata"`
	IsPublic      bool            `json:"isPublic"`
	ShareToken    *string         `json:"shareToken"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}

type Slide struct {
	ID             string          `json:"id"`
	PresentationID string          `json:"presentationId"`
	Order          int             `json:"order"`
	Type           string          `json:"type"`
	Title          *string         `json:"title"`
	Content        json.RawMessage `json:"content"`
	Layout         string          `json:"layout"`
	Notes          *string         `json:"notes"`
	CreatedAt      time.Time       `json:"createdAt"`
	UpdatedAt      time.Time       `json:"updatedAt"`
}

type Template struct {
	ID             string          `json:"id"`
	Name           string          `json:"name"`
	Description    *string         `json:"description"`
	Thumbnail      *string         `json:"thumbnail"`
	Category       string          `json:"category"`
	Config         json.RawMessage `json:"config"`
	IsPublic       bool            `json:"isPublic"`
	OrganizationID *string         `json:"organizationId"`
	CreatedAt      time.Time       `json:"createdAt"`
	UpdatedAt      time.Time       `json:"updatedAt"`
}

type TemplateSummary struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Thumbnail *string `json:"thumbnail"`
}

type PresentationUser struct {
	ID    string  `json:"id,omitempty"`
	Name  *string `json:"name"`
	Email string  `json:"email,omitempty"`
}

type PresentationDetail struct {
	Presentation
	Slides   []Slide           `json:"slides"`
	Template *Template         `json:"template"`
	User     *PresentationUser `json:"user,omitempty"`
}

type PresentationListItem struct {
	Presentation
	Count struct {
		Slides int `json:"slides"`
	} `json:"_count"`
	Template *TemplateSummary `json:"template"`
}

type PresentationPage struct {
	Data       []PresentationListItem `json:"data"`
	Total      int                    `json:"total"`
	Page       int                    `json:"page"`
	Limit      int                    `json:"limit"`
	TotalPages int                    `json:"totalPages"`
}

type PresentationCreate struct {
	ID, Title, UserID, SourceType string
	Description, TemplateID       *string
	SourceContent                 string
}

type PresentationUpdate struct {
	Title, Description, TemplateID *string
	IsPublic                       *bool
	TitleSet, DescriptionSet       bool
	TemplateIDSet, IsPublicSet     bool
}

type SlideCreate struct {
	ID, PresentationID, Type string
	Title, Notes             *string
	Content                  json.RawMessage
	Layout                   string
	Order                    *int
}

type SlideOrder struct {
	ID    string
	Order int
}

type PresentationAccess struct {
	UserID   string
	IsPublic bool
}

type SlideContext struct {
	Slide
	OwnerID        string
	IsPublic       bool
	TemplateConfig json.RawMessage
}

const selectPresentation = `
	SELECT "id", "title", "description", "userId", "templateId", "skillId",
		"status"::text, "sourceType"::text, "sourceContent", "metadata",
		"isPublic", "shareToken", "createdAt", "updatedAt"
	FROM "Presentation"`

const selectSlide = `
	SELECT "id", "presentationId", "order", "type"::text, "title", "content",
		"layout", "notes", "createdAt", "updatedAt"
	FROM "Slide"`

func (store *Store) ListPresentations(ctx context.Context, userID string, page, limit int) (PresentationPage, error) {
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 10
	}
	var total int
	if err := store.pool.QueryRow(ctx, `SELECT COUNT(*) FROM "Presentation" WHERE "userId"=$1`, userID).Scan(&total); err != nil {
		return PresentationPage{}, err
	}
	rows, err := store.pool.Query(ctx, selectPresentation+`
		WHERE "userId"=$1 ORDER BY "updatedAt" DESC LIMIT $2 OFFSET $3`,
		userID, limit, (page-1)*limit)
	if err != nil {
		return PresentationPage{}, err
	}
	defer rows.Close()
	items := make([]PresentationListItem, 0)
	for rows.Next() {
		presentation, err := scanPresentation(rows)
		if err != nil {
			return PresentationPage{}, err
		}
		item := PresentationListItem{Presentation: presentation}
		if err := store.pool.QueryRow(ctx, `SELECT COUNT(*) FROM "Slide" WHERE "presentationId"=$1`, presentation.ID).Scan(&item.Count.Slides); err != nil {
			return PresentationPage{}, err
		}
		if presentation.TemplateID != nil {
			var summary TemplateSummary
			err := store.pool.QueryRow(ctx, `SELECT "id","name","thumbnail" FROM "Template" WHERE "id"=$1`, *presentation.TemplateID).
				Scan(&summary.ID, &summary.Name, &summary.Thumbnail)
			if err != nil && err != pgx.ErrNoRows {
				return PresentationPage{}, err
			}
			if err == nil {
				item.Template = &summary
			}
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return PresentationPage{}, err
	}
	return PresentationPage{
		Data: items, Total: total, Page: page, Limit: limit,
		TotalPages: (total + limit - 1) / limit,
	}, nil
}

func (store *Store) GetPresentation(ctx context.Context, id string) (Presentation, error) {
	return scanPresentation(store.pool.QueryRow(ctx, selectPresentation+` WHERE "id"=$1`, id))
}

func (store *Store) GetPresentationDetail(ctx context.Context, id string, includeUser bool) (PresentationDetail, error) {
	presentation, err := store.GetPresentation(ctx, id)
	if err != nil {
		return PresentationDetail{}, err
	}
	slides, err := store.ListSlides(ctx, id)
	if err != nil {
		return PresentationDetail{}, err
	}
	detail := PresentationDetail{Presentation: presentation, Slides: slides}
	if presentation.TemplateID != nil {
		template, err := store.GetTemplate(ctx, *presentation.TemplateID)
		if err != nil && err != pgx.ErrNoRows {
			return PresentationDetail{}, err
		}
		if err == nil {
			detail.Template = &template
		}
	}
	if includeUser {
		var user PresentationUser
		if err := store.pool.QueryRow(ctx, `SELECT "id","name","email" FROM "User" WHERE "id"=$1`, presentation.UserID).
			Scan(&user.ID, &user.Name, &user.Email); err != nil {
			return PresentationDetail{}, err
		}
		detail.User = &user
	}
	return detail, nil
}

func (store *Store) CreatePresentation(ctx context.Context, input PresentationCreate) (PresentationDetail, error) {
	_, err := store.pool.Exec(ctx, `
		INSERT INTO "Presentation"
			("id","title","description","userId","templateId","sourceType","sourceContent","status","updatedAt")
		VALUES ($1,$2,$3,$4,$5,$6,$7,'DRAFT',NOW())`,
		input.ID, input.Title, input.Description, input.UserID, input.TemplateID,
		input.SourceType, input.SourceContent)
	if err != nil {
		return PresentationDetail{}, err
	}
	return store.GetPresentationDetail(ctx, input.ID, false)
}

func (store *Store) UpdatePresentation(ctx context.Context, id string, input PresentationUpdate) (PresentationDetail, error) {
	parts := []string{`"updatedAt"=NOW()`}
	args := []any{id}
	add := func(column string, value any) {
		args = append(args, value)
		parts = append(parts, fmt.Sprintf(`"%s"=$%d`, column, len(args)))
	}
	if input.TitleSet {
		add("title", nullableString(input.Title))
	}
	if input.DescriptionSet {
		add("description", nullableString(input.Description))
	}
	if input.TemplateIDSet {
		add("templateId", nullableString(input.TemplateID))
	}
	if input.IsPublicSet {
		if input.IsPublic == nil {
			add("isPublic", nil)
		} else {
			add("isPublic", *input.IsPublic)
		}
	}
	tag, err := store.pool.Exec(ctx, `UPDATE "Presentation" SET `+strings.Join(parts, ",")+` WHERE "id"=$1`, args...)
	if err != nil {
		return PresentationDetail{}, err
	}
	if tag.RowsAffected() == 0 {
		return PresentationDetail{}, pgx.ErrNoRows
	}
	return store.GetPresentationDetail(ctx, id, false)
}

func nullableString(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func (store *Store) DeletePresentation(ctx context.Context, id string) error {
	tag, err := store.pool.Exec(ctx, `DELETE FROM "Presentation" WHERE "id"=$1`, id)
	if err == nil && tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return err
}

func (store *Store) SharePresentation(ctx context.Context, id, token string) error {
	tag, err := store.pool.Exec(ctx, `
		UPDATE "Presentation" SET "shareToken"=$2,"isPublic"=true,"updatedAt"=NOW() WHERE "id"=$1`, id, token)
	if err == nil && tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return err
}

func (store *Store) GetPresentationByShareToken(ctx context.Context, token string) (PresentationDetail, error) {
	var id string
	if err := store.pool.QueryRow(ctx, `
		SELECT "id" FROM "Presentation" WHERE "shareToken"=$1 AND "isPublic"=true`, token).Scan(&id); err != nil {
		return PresentationDetail{}, err
	}
	detail, err := store.GetPresentationDetail(ctx, id, true)
	if err == nil && detail.User != nil {
		detail.User.ID, detail.User.Email = "", ""
	}
	return detail, err
}

func (store *Store) DuplicatePresentation(ctx context.Context, sourceID, newID, userID string, slideIDs []string) (PresentationDetail, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return PresentationDetail{}, err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `
		INSERT INTO "Presentation"
			("id","title","description","userId","templateId","status","sourceType","sourceContent","updatedAt")
		SELECT $2,"title" || ' (Copy)',"description",$3,"templateId",'DRAFT',"sourceType","sourceContent",NOW()
		FROM "Presentation" WHERE "id"=$1`, sourceID, newID, userID)
	if err != nil {
		return PresentationDetail{}, err
	}
	if tag.RowsAffected() == 0 {
		return PresentationDetail{}, pgx.ErrNoRows
	}
	rows, err := tx.Query(ctx, selectSlide+` WHERE "presentationId"=$1 ORDER BY "order"`, sourceID)
	if err != nil {
		return PresentationDetail{}, err
	}
	var slides []Slide
	for rows.Next() {
		slide, err := scanSlide(rows)
		if err != nil {
			rows.Close()
			return PresentationDetail{}, err
		}
		slides = append(slides, slide)
	}
	rows.Close()
	if len(slides) != len(slideIDs) {
		return PresentationDetail{}, fmt.Errorf("slide id count mismatch")
	}
	for index, slide := range slides {
		if _, err := tx.Exec(ctx, `
			INSERT INTO "Slide" ("id","presentationId","order","type","title","content","layout","notes","updatedAt")
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
			slideIDs[index], newID, slide.Order, slide.Type, slide.Title, slide.Content, slide.Layout, slide.Notes); err != nil {
			return PresentationDetail{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return PresentationDetail{}, err
	}
	return store.GetPresentationDetail(ctx, newID, false)
}

func (store *Store) PresentationAccess(ctx context.Context, id string) (PresentationAccess, error) {
	var access PresentationAccess
	err := store.pool.QueryRow(ctx, `SELECT "userId","isPublic" FROM "Presentation" WHERE "id"=$1`, id).
		Scan(&access.UserID, &access.IsPublic)
	return access, err
}

func (store *Store) ListSlides(ctx context.Context, presentationID string) ([]Slide, error) {
	rows, err := store.pool.Query(ctx, selectSlide+` WHERE "presentationId"=$1 ORDER BY "order" ASC`, presentationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	slides := make([]Slide, 0)
	for rows.Next() {
		slide, err := scanSlide(rows)
		if err != nil {
			return nil, err
		}
		slides = append(slides, slide)
	}
	return slides, rows.Err()
}

func (store *Store) GetSlide(ctx context.Context, id string) (Slide, error) {
	return scanSlide(store.pool.QueryRow(ctx, selectSlide+` WHERE "id"=$1`, id))
}

func (store *Store) GetSlideContext(ctx context.Context, id string) (SlideContext, error) {
	slide, err := store.GetSlide(ctx, id)
	if err != nil {
		return SlideContext{}, err
	}
	var result SlideContext
	result.Slide = slide
	err = store.pool.QueryRow(ctx, `
		SELECT p."userId",p."isPublic",COALESCE(t."config",'{}'::jsonb)
		FROM "Presentation" p
		LEFT JOIN "Template" t ON t."id"=p."templateId"
		WHERE p."id"=$1`, slide.PresentationID).
		Scan(&result.OwnerID, &result.IsPublic, &result.TemplateConfig)
	return result, err
}

func (store *Store) CreateSlide(ctx context.Context, input SlideCreate) (Slide, error) {
	order := 0
	if input.Order != nil {
		order = *input.Order
	} else if err := store.pool.QueryRow(ctx, `
		SELECT COALESCE(MAX("order")+1,0) FROM "Slide" WHERE "presentationId"=$1`, input.PresentationID).Scan(&order); err != nil {
		return Slide{}, err
	}
	_, err := store.pool.Exec(ctx, `
		INSERT INTO "Slide" ("id","presentationId","order","type","title","content","layout","notes","updatedAt")
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
		input.ID, input.PresentationID, order, input.Type, input.Title, input.Content, input.Layout, input.Notes)
	if err != nil {
		return Slide{}, err
	}
	return store.GetSlide(ctx, input.ID)
}

func (store *Store) UpdateSlide(ctx context.Context, id string, fields map[string]any) (Slide, error) {
	allowed := map[string]string{
		"type": "type", "title": "title", "content": "content",
		"layout": "layout", "notes": "notes", "order": "order",
	}
	parts := []string{`"updatedAt"=NOW()`}
	args := []any{id}
	for _, field := range []string{"type", "title", "content", "layout", "notes", "order"} {
		value, ok := fields[field]
		if !ok {
			continue
		}
		args = append(args, value)
		parts = append(parts, fmt.Sprintf(`"%s"=$%d`, allowed[field], len(args)))
	}
	tag, err := store.pool.Exec(ctx, `UPDATE "Slide" SET `+strings.Join(parts, ",")+` WHERE "id"=$1`, args...)
	if err != nil {
		return Slide{}, err
	}
	if tag.RowsAffected() == 0 {
		return Slide{}, pgx.ErrNoRows
	}
	return store.GetSlide(ctx, id)
}

func (store *Store) UpdateSlideContent(ctx context.Context, id string, content json.RawMessage) (Slide, error) {
	return store.UpdateSlide(ctx, id, map[string]any{"content": content})
}

func (store *Store) DeleteSlide(ctx context.Context, id string) error {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var presentationID string
	var order int
	if err := tx.QueryRow(ctx, `DELETE FROM "Slide" WHERE "id"=$1 RETURNING "presentationId","order"`, id).
		Scan(&presentationID, &order); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE "Slide" SET "order"="order"-1,"updatedAt"=NOW()
		WHERE "presentationId"=$1 AND "order">$2`, presentationID, order); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (store *Store) ReorderSlides(ctx context.Context, presentationID string, orders []SlideOrder) error {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	for _, item := range orders {
		tag, err := tx.Exec(ctx, `
			UPDATE "Slide" SET "order"=$3,"updatedAt"=NOW()
			WHERE "id"=$1 AND "presentationId"=$2`, item.ID, presentationID, item.Order)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return pgx.ErrNoRows
		}
	}
	return tx.Commit(ctx)
}

func (store *Store) DuplicateSlide(ctx context.Context, id, newID string) (Slide, error) {
	tag, err := store.pool.Exec(ctx, `
		INSERT INTO "Slide" ("id","presentationId","order","type","title","content","layout","notes","updatedAt")
		SELECT $2,"presentationId",
			(SELECT COALESCE(MAX(s2."order")+1,0) FROM "Slide" s2 WHERE s2."presentationId"=s."presentationId"),
			"type",CASE WHEN "title" IS NULL THEN NULL ELSE "title" || ' (Copy)' END,
			"content","layout","notes",NOW()
		FROM "Slide" s WHERE "id"=$1`, id, newID)
	if err != nil {
		return Slide{}, err
	}
	if tag.RowsAffected() == 0 {
		return Slide{}, pgx.ErrNoRows
	}
	return store.GetSlide(ctx, newID)
}

func (store *Store) GetTemplate(ctx context.Context, id string) (Template, error) {
	var template Template
	err := store.pool.QueryRow(ctx, `
		SELECT "id","name","description","thumbnail","category"::text,"config",
			"isPublic","organizationId","createdAt","updatedAt"
		FROM "Template" WHERE "id"=$1`, id).
		Scan(&template.ID, &template.Name, &template.Description, &template.Thumbnail,
			&template.Category, &template.Config, &template.IsPublic, &template.OrganizationID,
			&template.CreatedAt, &template.UpdatedAt)
	return template, err
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

func scanSlide(row pgx.Row) (Slide, error) {
	var slide Slide
	err := row.Scan(
		&slide.ID, &slide.PresentationID, &slide.Order, &slide.Type, &slide.Title,
		&slide.Content, &slide.Layout, &slide.Notes, &slide.CreatedAt, &slide.UpdatedAt,
	)
	return slide, err
}
