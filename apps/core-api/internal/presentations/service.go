package presentations

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/storagepath"
)

var (
	ErrNotFound   = errors.New("not found")
	ErrForbidden  = errors.New("forbidden")
	ErrBadRequest = errors.New("bad request")
)

type Repository interface {
	ListPresentations(context.Context, string, int, int) (db.PresentationPage, error)
	GetPresentation(context.Context, string) (db.Presentation, error)
	GetPresentationDetail(context.Context, string, bool) (db.PresentationDetail, error)
	CreatePresentation(context.Context, db.PresentationCreate) (db.PresentationDetail, error)
	UpdatePresentation(context.Context, string, db.PresentationUpdate) (db.PresentationDetail, error)
	DeletePresentation(context.Context, string) error
	SharePresentation(context.Context, string, string) error
	GetPresentationByShareToken(context.Context, string) (db.PresentationDetail, error)
	DuplicatePresentation(context.Context, string, string, string, []string) (db.PresentationDetail, error)
	PresentationAccess(context.Context, string) (db.PresentationAccess, error)
	ListSlides(context.Context, string) ([]db.Slide, error)
	GetSlide(context.Context, string) (db.Slide, error)
	GetSlideContext(context.Context, string) (db.SlideContext, error)
	CreateSlide(context.Context, db.SlideCreate) (db.Slide, error)
	UpdateSlide(context.Context, string, map[string]any) (db.Slide, error)
	UpdateSlideContent(context.Context, string, json.RawMessage) (db.Slide, error)
	DeleteSlide(context.Context, string) error
	ReorderSlides(context.Context, string, []db.SlideOrder) error
	DuplicateSlide(context.Context, string, string) (db.Slide, error)
}

type Service struct {
	store       Repository
	rendererURL string
	uploadsRoot string
	client      *http.Client
}

type CreatePresentationInput struct {
	Title, Description, TemplateID *string
	SourceType, Content            string
}

type UpdatePresentationInput struct {
	Title, Description, TemplateID OptionalString
	IsPublic                       OptionalBool
}

type OptionalString struct {
	Present bool
	Value   *string
}

type OptionalBool struct {
	Present bool
	Value   *bool
}

type CreateSlideInput struct {
	Type, Layout string
	Title, Notes *string
	Content      json.RawMessage
	Order        *int
}

type UpdateSlideInput struct {
	Fields map[string]any
}

func NewService(store Repository, rendererURL, uploadsRoot string, client *http.Client) *Service {
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	return &Service{
		store: store, rendererURL: strings.TrimRight(rendererURL, "/"),
		uploadsRoot: filepath.Clean(uploadsRoot), client: client,
	}
}

func (service *Service) CreatePresentation(ctx context.Context, userID string, input CreatePresentationInput) (db.PresentationDetail, error) {
	title := "Untitled Presentation"
	if input.Title != nil && *input.Title != "" {
		title = *input.Title
	}
	id, err := newID()
	if err != nil {
		return db.PresentationDetail{}, err
	}
	result, err := service.store.CreatePresentation(ctx, db.PresentationCreate{
		ID: id, Title: title, Description: input.Description, UserID: userID,
		TemplateID: input.TemplateID, SourceType: input.SourceType, SourceContent: input.Content,
	})
	return result, mapStoreError(err)
}

func (service *Service) ListPresentations(ctx context.Context, userID string, page, limit int) (db.PresentationPage, error) {
	result, err := service.store.ListPresentations(ctx, userID, page, limit)
	return result, mapStoreError(err)
}

func (service *Service) GetPresentation(ctx context.Context, id, userID string) (db.PresentationDetail, error) {
	result, err := service.store.GetPresentationDetail(ctx, id, true)
	if err != nil {
		return db.PresentationDetail{}, mapStoreError(err)
	}
	if result.UserID != userID && !result.IsPublic {
		return db.PresentationDetail{}, ErrForbidden
	}
	return result, nil
}

func (service *Service) GetSharedPresentation(ctx context.Context, token string) (db.PresentationDetail, error) {
	result, err := service.store.GetPresentationByShareToken(ctx, token)
	return result, mapStoreError(err)
}

func (service *Service) UpdatePresentation(ctx context.Context, id, userID string, input UpdatePresentationInput) (db.PresentationDetail, error) {
	if err := service.requirePresentationOwner(ctx, id, userID); err != nil {
		return db.PresentationDetail{}, err
	}
	result, err := service.store.UpdatePresentation(ctx, id, db.PresentationUpdate{
		TitleSet: input.Title.Present, Title: input.Title.Value,
		DescriptionSet: input.Description.Present, Description: input.Description.Value,
		TemplateIDSet: input.TemplateID.Present, TemplateID: input.TemplateID.Value,
		IsPublicSet: input.IsPublic.Present, IsPublic: input.IsPublic.Value,
	})
	return result, mapStoreError(err)
}

func (service *Service) DeletePresentation(ctx context.Context, id, userID string) error {
	if err := service.requirePresentationOwner(ctx, id, userID); err != nil {
		return err
	}
	return mapStoreError(service.store.DeletePresentation(ctx, id))
}

func (service *Service) SharePresentation(ctx context.Context, id, userID string) (map[string]string, error) {
	if err := service.requirePresentationOwner(ctx, id, userID); err != nil {
		return nil, err
	}
	token, err := newID()
	if err != nil {
		return nil, err
	}
	if err := service.store.SharePresentation(ctx, id, token); err != nil {
		return nil, mapStoreError(err)
	}
	return map[string]string{"shareToken": token}, nil
}

func (service *Service) DuplicatePresentation(ctx context.Context, id, userID string) (db.PresentationDetail, error) {
	original, err := service.store.GetPresentationDetail(ctx, id, false)
	if err != nil {
		return db.PresentationDetail{}, mapStoreError(err)
	}
	if original.UserID != userID && !original.IsPublic {
		return db.PresentationDetail{}, ErrForbidden
	}
	slideIDs := make([]string, len(original.Slides))
	for index := range slideIDs {
		slideIDs[index], err = newID()
		if err != nil {
			return db.PresentationDetail{}, err
		}
	}
	duplicateID, err := newID()
	if err != nil {
		return db.PresentationDetail{}, err
	}
	result, err := service.store.DuplicatePresentation(ctx, id, duplicateID, userID, slideIDs)
	return result, mapStoreError(err)
}

func (service *Service) SlideTemplateHTML(ctx context.Context, presentationID, userID string, order int) (map[string]string, error) {
	presentation, err := service.GetPresentation(ctx, presentationID, userID)
	if err != nil {
		return nil, err
	}
	var selected *db.Slide
	for index := range presentation.Slides {
		if presentation.Slides[index].Order == order {
			selected = &presentation.Slides[index]
			break
		}
	}
	if selected == nil {
		return nil, ErrNotFound
	}
	content := rawFields(selected.Content)
	if html, ok := rawString(content["html"]); ok && strings.TrimSpace(html) != "" {
		return map[string]string{"html": html}, nil
	}
	if presentation.Template != nil {
		config := rawFields(presentation.Template.Config)
		index, validIndex := rawInteger(content["templateIndex"])
		if slides, ok := rawArray(config["htmlSlides"]); ok && validIndex && index >= 0 && index < len(slides) {
			if html, ok := rawString(slides[index]); ok {
				return map[string]string{"html": html}, nil
			}
		}
	}
	return map[string]string{"html": ""}, nil
}

func (service *Service) CreateSlide(ctx context.Context, presentationID, userID string, input CreateSlideInput) (db.Slide, error) {
	if err := service.requirePresentationOwner(ctx, presentationID, userID); err != nil {
		return db.Slide{}, err
	}
	layout := input.Layout
	if layout == "" {
		layout = "center"
	}
	id, err := newID()
	if err != nil {
		return db.Slide{}, err
	}
	result, err := service.store.CreateSlide(ctx, db.SlideCreate{
		ID: id, PresentationID: presentationID, Type: input.Type, Title: input.Title,
		Content: input.Content, Layout: layout, Notes: input.Notes, Order: input.Order,
	})
	return result, mapStoreError(err)
}

func (service *Service) ListSlides(ctx context.Context, presentationID, userID string) ([]db.Slide, error) {
	access, err := service.store.PresentationAccess(ctx, presentationID)
	if err != nil {
		return nil, mapStoreError(err)
	}
	if access.UserID != userID && !access.IsPublic {
		return nil, ErrForbidden
	}
	result, err := service.store.ListSlides(ctx, presentationID)
	return result, mapStoreError(err)
}

func (service *Service) GetSlide(ctx context.Context, id, userID string) (db.Slide, error) {
	context, err := service.store.GetSlideContext(ctx, id)
	if err != nil {
		return db.Slide{}, mapStoreError(err)
	}
	if context.OwnerID != userID && !context.IsPublic {
		return db.Slide{}, ErrForbidden
	}
	return context.Slide, nil
}

func (service *Service) UpdateSlide(ctx context.Context, id, userID string, input UpdateSlideInput) (db.Slide, error) {
	if err := service.requireSlideOwner(ctx, id, userID); err != nil {
		return db.Slide{}, err
	}
	result, err := service.store.UpdateSlide(ctx, id, input.Fields)
	return result, mapStoreError(err)
}

func (service *Service) DeleteSlide(ctx context.Context, id, userID string) error {
	if err := service.requireSlideOwner(ctx, id, userID); err != nil {
		return err
	}
	return mapStoreError(service.store.DeleteSlide(ctx, id))
}

func (service *Service) ReorderSlides(ctx context.Context, presentationID, userID string, orders []db.SlideOrder) ([]db.Slide, error) {
	if err := service.requirePresentationOwner(ctx, presentationID, userID); err != nil {
		return nil, err
	}
	if err := service.store.ReorderSlides(ctx, presentationID, orders); err != nil {
		return nil, mapStoreError(err)
	}
	return service.ListSlides(ctx, presentationID, userID)
}

func (service *Service) DuplicateSlide(ctx context.Context, id, userID string) (db.Slide, error) {
	if err := service.requireSlideOwner(ctx, id, userID); err != nil {
		return db.Slide{}, err
	}
	duplicateID, err := newID()
	if err != nil {
		return db.Slide{}, err
	}
	result, err := service.store.DuplicateSlide(ctx, id, duplicateID)
	return result, mapStoreError(err)
}

func (service *Service) GetScene(ctx context.Context, id, userID string) (json.RawMessage, error) {
	slide, err := service.store.GetSlideContext(ctx, id)
	if err != nil {
		return nil, mapStoreError(err)
	}
	if slide.OwnerID != userID && !slide.IsPublic {
		return nil, ErrForbidden
	}
	content, config := rawFields(slide.Content), rawFields(slide.TemplateConfig)
	source := rawFields(config["source"])
	sourceKind, _ := rawString(source["kind"])
	if sourceKind == "pptx" {
		key, _ := rawString(source["storageKey"])
		if key == "" {
			key, _ = rawString(rawFields(config["pptxTemplate"])["storageKey"])
		}
		sourcePPTX, err := service.readUpload(key)
		if err != nil {
			return nil, fmt.Errorf("%w: PPTX source file is unavailable", ErrBadRequest)
		}
		index, _ := rawInteger(content["templateIndex"])
		return service.renderer(ctx, "/api/scene/pptx/load", map[string]any{
			"sourcePptx": base64.StdEncoding.EncodeToString(sourcePPTX), "templateIndex": index,
			"objectEdits": rawOrEmptyArray(content["objectEdits"]),
		})
	}
	html, _ := rawString(content["html"])
	if strings.TrimSpace(html) == "" {
		index, ok := rawInteger(content["templateIndex"])
		slides, _ := rawArray(config["htmlSlides"])
		if ok && index >= 0 && index < len(slides) {
			html, _ = rawString(slides[index])
		}
	}
	if strings.TrimSpace(html) == "" {
		return nil, fmt.Errorf("%w: slide has no editable content", ErrBadRequest)
	}
	return service.renderer(ctx, "/api/scene/html/load", map[string]any{"html": html})
}

func (service *Service) SaveScene(ctx context.Context, id, userID string, scene json.RawMessage) (db.Slide, error) {
	slide, err := service.store.GetSlideContext(ctx, id)
	if err != nil {
		return db.Slide{}, mapStoreError(err)
	}
	if slide.OwnerID != userID {
		return db.Slide{}, ErrForbidden
	}
	content, config := rawFields(slide.Content), rawFields(slide.TemplateConfig)
	source := rawFields(config["source"])
	sourceKind, _ := rawString(source["kind"])
	if sourceKind == "pptx" {
		response, err := service.renderer(ctx, "/api/scene/pptx/save", map[string]any{"scene": scene})
		if err != nil {
			return db.Slide{}, err
		}
		var result struct {
			ObjectEdits json.RawMessage `json:"objectEdits"`
		}
		if err := json.Unmarshal(response, &result); err != nil || len(result.ObjectEdits) == 0 {
			return db.Slide{}, fmt.Errorf("invalid renderer response")
		}
		content["objectEdits"] = result.ObjectEdits
	} else {
		response, err := service.renderer(ctx, "/api/scene/html/save", map[string]any{"scene": scene})
		if err != nil {
			return db.Slide{}, err
		}
		var result struct {
			HTML string `json:"html"`
		}
		if err := json.Unmarshal(response, &result); err != nil || result.HTML == "" {
			return db.Slide{}, fmt.Errorf("invalid renderer response")
		}
		content["html"], _ = json.Marshal(result.HTML)
	}
	updated, err := json.Marshal(content)
	if err != nil {
		return db.Slide{}, err
	}
	result, err := service.store.UpdateSlideContent(ctx, id, updated)
	return result, mapStoreError(err)
}

func (service *Service) renderer(ctx context.Context, path string, body any) (json.RawMessage, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, service.rendererURL+path, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := service.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("renderer unavailable: %w", err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 64<<20))
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("renderer status %d", response.StatusCode)
	}
	return raw, nil
}

func (service *Service) readUpload(key string) ([]byte, error) {
	target, err := storagepath.Existing(service.uploadsRoot, key)
	if err != nil {
		return nil, ErrBadRequest
	}
	return os.ReadFile(target)
}

func (service *Service) requirePresentationOwner(ctx context.Context, id, userID string) error {
	access, err := service.store.PresentationAccess(ctx, id)
	if err != nil {
		return mapStoreError(err)
	}
	if access.UserID != userID {
		return ErrForbidden
	}
	return nil
}

func (service *Service) requireSlideOwner(ctx context.Context, id, userID string) error {
	slide, err := service.store.GetSlideContext(ctx, id)
	if err != nil {
		return mapStoreError(err)
	}
	if slide.OwnerID != userID {
		return ErrForbidden
	}
	return nil
}

func mapStoreError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func newID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return "go-" + hex.EncodeToString(value[:]), nil
}

func rawFields(raw json.RawMessage) map[string]json.RawMessage {
	result := map[string]json.RawMessage{}
	_ = json.Unmarshal(raw, &result)
	return result
}

func rawString(raw json.RawMessage) (string, bool) {
	var result string
	err := json.Unmarshal(raw, &result)
	return result, err == nil
}

func rawInteger(raw json.RawMessage) (int, bool) {
	var result int
	err := json.Unmarshal(raw, &result)
	return result, err == nil
}

func rawArray(raw json.RawMessage) ([]json.RawMessage, bool) {
	var result []json.RawMessage
	err := json.Unmarshal(raw, &result)
	return result, err == nil
}

func rawOrEmptyArray(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 || strings.TrimSpace(string(raw)) == "null" {
		return json.RawMessage("[]")
	}
	return raw
}
