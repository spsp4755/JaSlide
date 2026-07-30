package presentations

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/auth"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
)

type handlers struct {
	service *Service
}

func NewHandlers(service *Service, authService *auth.Service) http.Handler {
	handler := &handlers{service: service}
	router := chi.NewRouter()
	router.Get("/shared/{token}", handler.getShared)
	router.Group(func(protected chi.Router) {
		protected.Use(auth.RequireUser(authService))
		protected.Post("/", handler.createPresentation)
		protected.Get("/", handler.listPresentations)
		protected.Get("/{id}", handler.getPresentation)
		protected.Put("/{id}", handler.updatePresentation)
		protected.Delete("/{id}", handler.deletePresentation)
		protected.Get("/{id}/slides/{order}/template-html", handler.slideTemplateHTML)
		protected.Post("/{id}/share", handler.sharePresentation)
		protected.Post("/{id}/duplicate", handler.duplicatePresentation)
		protected.Post("/{presentationId}/slides", handler.createSlide)
		protected.Get("/{presentationId}/slides", handler.listSlides)
		protected.Post("/{presentationId}/slides/reorder", handler.reorderSlides)
		protected.Get("/{presentationId}/slides/{slideId}", handler.getSlide)
		protected.Put("/{presentationId}/slides/{slideId}", handler.updateSlide)
		protected.Delete("/{presentationId}/slides/{slideId}", handler.deleteSlide)
		protected.Post("/{presentationId}/slides/{slideId}/duplicate", handler.duplicateSlide)
		protected.Get("/{presentationId}/slides/{slideId}/scene", handler.getScene)
		protected.Patch("/{presentationId}/slides/{slideId}/scene", handler.saveScene)
	})
	return router
}

func NewSlideHandlers(service *Service, authService *auth.Service) http.Handler {
	handler := &handlers{service: service}
	router := chi.NewRouter()
	router.Use(auth.RequireUser(authService))
	router.Post("/{slideId}/duplicate", handler.duplicateSlide)
	return router
}

func (handler *handlers) createPresentation(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		Title, Description, TemplateID *string
		SourceType                     string
		Content                        *string
	}
	if err := decodeStrict(writer, request, &input); err != nil {
		writeBadRequest(writer, err.Error())
		return
	}
	if !presentationSourceTypes[input.SourceType] || input.Content == nil {
		writeBadRequest(writer, "sourceType must be a valid enum value")
		return
	}
	result, err := handler.service.CreatePresentation(request.Context(), userID(request), CreatePresentationInput{
		Title: input.Title, Description: input.Description, TemplateID: input.TemplateID,
		SourceType: input.SourceType, Content: *input.Content,
	})
	writeResult(writer, http.StatusCreated, result, err)
}

func (handler *handlers) listPresentations(writer http.ResponseWriter, request *http.Request) {
	page, err := positiveQuery(request, "page", 1)
	if err != nil {
		writeBadRequest(writer, err.Error())
		return
	}
	limit, err := positiveQuery(request, "limit", 10)
	if err != nil {
		writeBadRequest(writer, err.Error())
		return
	}
	result, err := handler.service.ListPresentations(request.Context(), userID(request), page, limit)
	writeResult(writer, http.StatusOK, result, err)
}

func (handler *handlers) getPresentation(writer http.ResponseWriter, request *http.Request) {
	result, err := handler.service.GetPresentation(request.Context(), chi.URLParam(request, "id"), userID(request))
	writeResult(writer, http.StatusOK, result, err)
}

func (handler *handlers) getShared(writer http.ResponseWriter, request *http.Request) {
	result, err := handler.service.GetSharedPresentation(request.Context(), chi.URLParam(request, "token"))
	writeResult(writer, http.StatusOK, result, err)
}

func (handler *handlers) updatePresentation(writer http.ResponseWriter, request *http.Request) {
	var raw map[string]json.RawMessage
	if err := decodeStrict(writer, request, &raw); err != nil {
		writeBadRequest(writer, err.Error())
		return
	}
	allowed := map[string]bool{"title": true, "description": true, "templateId": true, "isPublic": true}
	var input UpdatePresentationInput
	for name, value := range raw {
		if !allowed[name] {
			writeBadRequest(writer, "property "+name+" should not exist")
			return
		}
		switch name {
		case "title", "description", "templateId":
			field := OptionalString{Present: true}
			if string(value) != "null" {
				var text string
				if json.Unmarshal(value, &text) != nil {
					writeBadRequest(writer, name+" must be a string")
					return
				}
				field.Value = &text
			}
			switch name {
			case "title":
				input.Title = field
			case "description":
				input.Description = field
			case "templateId":
				input.TemplateID = field
			}
		case "isPublic":
			field := OptionalBool{Present: true}
			if string(value) != "null" {
				var boolean bool
				if json.Unmarshal(value, &boolean) != nil {
					writeBadRequest(writer, "isPublic must be a boolean value")
					return
				}
				field.Value = &boolean
			}
			input.IsPublic = field
		}
	}
	result, err := handler.service.UpdatePresentation(
		request.Context(), chi.URLParam(request, "id"), userID(request), input,
	)
	writeResult(writer, http.StatusOK, result, err)
}

func (handler *handlers) deletePresentation(writer http.ResponseWriter, request *http.Request) {
	err := handler.service.DeletePresentation(request.Context(), chi.URLParam(request, "id"), userID(request))
	writeResult(writer, http.StatusOK, map[string]bool{"success": true}, err)
}

func (handler *handlers) sharePresentation(writer http.ResponseWriter, request *http.Request) {
	result, err := handler.service.SharePresentation(request.Context(), chi.URLParam(request, "id"), userID(request))
	writeResult(writer, http.StatusCreated, result, err)
}

func (handler *handlers) duplicatePresentation(writer http.ResponseWriter, request *http.Request) {
	result, err := handler.service.DuplicatePresentation(request.Context(), chi.URLParam(request, "id"), userID(request))
	writeResult(writer, http.StatusCreated, result, err)
}

func (handler *handlers) slideTemplateHTML(writer http.ResponseWriter, request *http.Request) {
	order, err := strconv.Atoi(chi.URLParam(request, "order"))
	if err != nil {
		writeBadRequest(writer, "order must be an integer number")
		return
	}
	result, err := handler.service.SlideTemplateHTML(
		request.Context(), chi.URLParam(request, "id"), userID(request), order,
	)
	writeResult(writer, http.StatusOK, result, err)
}

func (handler *handlers) createSlide(writer http.ResponseWriter, request *http.Request) {
	var input CreateSlideInput
	if err := decodeStrict(writer, request, &input); err != nil {
		writeBadRequest(writer, err.Error())
		return
	}
	if !slideTypes[input.Type] || !jsonObject(input.Content) {
		writeBadRequest(writer, "type and object content are required")
		return
	}
	result, err := handler.service.CreateSlide(
		request.Context(), chi.URLParam(request, "presentationId"), userID(request), input,
	)
	writeResult(writer, http.StatusCreated, result, err)
}

func (handler *handlers) listSlides(writer http.ResponseWriter, request *http.Request) {
	result, err := handler.service.ListSlides(
		request.Context(), chi.URLParam(request, "presentationId"), userID(request),
	)
	writeResult(writer, http.StatusOK, result, err)
}

func (handler *handlers) getSlide(writer http.ResponseWriter, request *http.Request) {
	result, err := handler.service.GetSlide(request.Context(), chi.URLParam(request, "slideId"), userID(request))
	writeResult(writer, http.StatusOK, result, err)
}

func (handler *handlers) updateSlide(writer http.ResponseWriter, request *http.Request) {
	var raw map[string]json.RawMessage
	if err := decodeStrict(writer, request, &raw); err != nil {
		writeBadRequest(writer, err.Error())
		return
	}
	allowed := map[string]bool{"type": true, "title": true, "content": true, "layout": true, "notes": true, "order": true}
	fields := make(map[string]any, len(raw))
	for name, value := range raw {
		if !allowed[name] {
			writeBadRequest(writer, "property "+name+" should not exist")
			return
		}
		switch name {
		case "type":
			var text string
			if json.Unmarshal(value, &text) != nil || !slideTypes[text] {
				writeBadRequest(writer, "type must be a valid enum value")
				return
			}
			fields[name] = text
		case "title", "layout", "notes":
			if string(value) == "null" && (name == "title" || name == "notes") {
				fields[name] = nil
				continue
			}
			var text string
			if json.Unmarshal(value, &text) != nil {
				writeBadRequest(writer, name+" must be a string")
				return
			}
			fields[name] = text
		case "content":
			if !jsonObject(value) {
				writeBadRequest(writer, "content must be an object")
				return
			}
			fields[name] = value
		case "order":
			var number int
			if json.Unmarshal(value, &number) != nil {
				writeBadRequest(writer, "order must be an integer number")
				return
			}
			fields[name] = number
		}
	}
	result, err := handler.service.UpdateSlide(
		request.Context(), chi.URLParam(request, "slideId"), userID(request), UpdateSlideInput{Fields: fields},
	)
	writeResult(writer, http.StatusOK, result, err)
}

func (handler *handlers) deleteSlide(writer http.ResponseWriter, request *http.Request) {
	err := handler.service.DeleteSlide(request.Context(), chi.URLParam(request, "slideId"), userID(request))
	writeResult(writer, http.StatusOK, map[string]bool{"success": true}, err)
}

func (handler *handlers) reorderSlides(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		SlideOrders []struct {
			SlideID string `json:"slideId"`
			Order   int    `json:"order"`
		} `json:"slideOrders"`
	}
	if err := decodeStrict(writer, request, &input); err != nil {
		writeBadRequest(writer, err.Error())
		return
	}
	if input.SlideOrders == nil {
		writeBadRequest(writer, "slideOrders must be an array")
		return
	}
	orders := make([]db.SlideOrder, len(input.SlideOrders))
	for index, item := range input.SlideOrders {
		if item.SlideID == "" {
			writeBadRequest(writer, "slideId must be a string")
			return
		}
		orders[index] = db.SlideOrder{ID: item.SlideID, Order: item.Order}
	}
	result, err := handler.service.ReorderSlides(
		request.Context(), chi.URLParam(request, "presentationId"), userID(request), orders,
	)
	writeResult(writer, http.StatusCreated, result, err)
}

func (handler *handlers) duplicateSlide(writer http.ResponseWriter, request *http.Request) {
	result, err := handler.service.DuplicateSlide(request.Context(), chi.URLParam(request, "slideId"), userID(request))
	writeResult(writer, http.StatusCreated, result, err)
}

func (handler *handlers) getScene(writer http.ResponseWriter, request *http.Request) {
	result, err := handler.service.GetScene(request.Context(), chi.URLParam(request, "slideId"), userID(request))
	if err != nil {
		writeServiceError(writer, err)
		return
	}
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(http.StatusOK)
	_, _ = writer.Write(result)
}

func (handler *handlers) saveScene(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		Scene json.RawMessage `json:"scene"`
	}
	if err := decodeStrict(writer, request, &input); err != nil {
		writeBadRequest(writer, err.Error())
		return
	}
	if !jsonObject(input.Scene) {
		writeBadRequest(writer, "scene must be an object")
		return
	}
	result, err := handler.service.SaveScene(request.Context(), chi.URLParam(request, "slideId"), userID(request), input.Scene)
	writeResult(writer, http.StatusOK, result, err)
}

func userID(request *http.Request) string {
	principal, _ := auth.PrincipalFromContext(request.Context())
	return principal.ID
}

func decodeStrict(writer http.ResponseWriter, request *http.Request, target any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 64<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("multiple JSON values")
	}
	return nil
}

func writeResult(writer http.ResponseWriter, status int, value any, err error) {
	if err != nil {
		writeServiceError(writer, err)
		return
	}
	writeJSON(writer, status, value)
}

func writeServiceError(writer http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		writeError(writer, http.StatusNotFound, "Not found", "Not Found")
	case errors.Is(err, ErrForbidden):
		writeError(writer, http.StatusForbidden, "Access denied", "Forbidden")
	case errors.Is(err, ErrBadRequest):
		writeError(writer, http.StatusBadRequest, strings.TrimPrefix(err.Error(), ErrBadRequest.Error()+": "), "Bad Request")
	default:
		writeError(writer, http.StatusInternalServerError, "Internal server error", "Internal Server Error")
	}
}

func writeBadRequest(writer http.ResponseWriter, message string) {
	writeError(writer, http.StatusBadRequest, message, "Bad Request")
}

func writeError(writer http.ResponseWriter, status int, message, kind string) {
	writeJSON(writer, status, map[string]any{"message": message, "error": kind, "statusCode": status})
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func positiveQuery(request *http.Request, name string, fallback int) (int, error) {
	raw := request.URL.Query().Get(name)
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return 0, errors.New(name + " must be a number")
	}
	return value, nil
}

func jsonObject(raw json.RawMessage) bool {
	var value map[string]any
	return len(raw) > 0 && json.Unmarshal(raw, &value) == nil && value != nil
}

var presentationSourceTypes = map[string]bool{
	"TEXT": true, "DOCX": true, "PDF": true, "MARKDOWN": true,
	"CSV": true, "URL": true,
}

var slideTypes = map[string]bool{
	"TITLE": true, "CONTENT": true, "TWO_COLUMN": true, "IMAGE": true,
	"CHART": true, "QUOTE": true, "BULLET_LIST": true, "COMPARISON": true,
	"TIMELINE": true, "SECTION_HEADER": true, "BLANK": true,
}
