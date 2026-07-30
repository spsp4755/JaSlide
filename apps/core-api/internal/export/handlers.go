package export

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/auth"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/renderer"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/storagepath"
)

type handlers struct {
	db       *db.Store
	renderer *renderer.Client
	root     string
}

func NewHandlers(
	store *db.Store, renderer *renderer.Client, root string, authService *auth.Service,
) http.Handler {
	handler := &handlers{db: store, renderer: renderer, root: root}
	router := chi.NewRouter()
	router.Use(auth.RequireUser(authService))
	router.Post("/{presentationId}/pptx", handler.pptx)
	router.Post("/{presentationId}/pdf", handler.pdf)
	router.Post("/{presentationId}/google-slides", handler.googleSlides)
	router.Get("/{presentationId}/preview", handler.preview)
	return router
}

func (handler *handlers) pptx(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		Editable bool `json:"editable"`
	}
	if request.Body != nil {
		_ = json.NewDecoder(http.MaxBytesReader(writer, request.Body, 1<<20)).Decode(&input)
	}
	handler.render(writer, request, "/api/render/pptx", renderer.PPTXContentType, ".pptx",
		map[string]any{"editable": input.Editable})
}

func (handler *handlers) pdf(writer http.ResponseWriter, request *http.Request) {
	handler.render(writer, request, "/api/render/pdf", renderer.PDFContentType, ".pdf", nil)
}

func (handler *handlers) render(
	writer http.ResponseWriter, request *http.Request, path, contentType, extension string,
	extra map[string]any,
) {
	presentation, err := handler.presentation(request)
	if err != nil {
		writeError(writer, err)
		return
	}
	payload := map[string]any{"presentation": presentation}
	for key, value := range extra {
		payload[key] = value
	}
	stream, err := handler.renderer.StreamJSON(request.Context(), path, payload)
	if err != nil {
		writeJSONError(writer, http.StatusServiceUnavailable, "Presentation renderer is unavailable")
		return
	}
	defer stream.Body.Close()
	kind := strings.TrimPrefix(extension, ".")
	raw, err := readValidatedStream(stream, kind)
	if err != nil {
		writeJSONError(writer, http.StatusBadGateway, "Presentation renderer returned an invalid file")
		return
	}
	writer.Header().Set("Content-Type", contentType)
	writer.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{
		"filename": presentation["title"].(string) + extension,
	}))
	writer.Header().Set("Content-Length", strconv.Itoa(len(raw)))
	writer.WriteHeader(http.StatusOK)
	_, _ = writer.Write(raw)
}

func (handler *handlers) preview(writer http.ResponseWriter, request *http.Request) {
	presentation, err := handler.presentation(request)
	if err != nil {
		writeError(writer, err)
		return
	}
	index, err := strconv.Atoi(defaultString(request.URL.Query().Get("slide"), "0"))
	slides, _ := presentation["slides"].([]db.Slide)
	if err != nil || index < 0 || index >= len(slides) {
		writeJSONError(writer, http.StatusBadRequest, "Invalid slide index")
		return
	}
	stream, err := handler.renderer.StreamJSON(request.Context(), "/api/render/preview", map[string]any{
		"presentation": presentation, "slideIndex": index,
	})
	if err != nil {
		writeJSONError(writer, http.StatusBadRequest, "Failed to generate preview")
		return
	}
	defer stream.Body.Close()
	raw, err := readValidatedStream(stream, "png")
	if err != nil {
		writeJSONError(writer, http.StatusBadGateway, "Presentation renderer returned an invalid preview")
		return
	}
	writer.Header().Set("Content-Type", "image/png")
	writer.Header().Set("Content-Length", strconv.Itoa(len(raw)))
	writer.WriteHeader(http.StatusOK)
	_, _ = writer.Write(raw)
}

const maxRenderedFileBytes = 256 << 20

func readValidatedStream(stream renderer.Stream, kind string) ([]byte, error) {
	expectedType := map[string]string{
		"pptx": renderer.PPTXContentType,
		"pdf":  renderer.PDFContentType,
		"png":  "image/png",
	}[kind]
	actualType, _, err := mime.ParseMediaType(stream.ContentType)
	if err != nil || actualType != expectedType {
		return nil, errors.New("renderer returned an unexpected content type")
	}
	raw, err := io.ReadAll(io.LimitReader(stream.Body, maxRenderedFileBytes+1))
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 || len(raw) > maxRenderedFileBytes {
		return nil, errors.New("renderer file has an invalid size")
	}
	valid := false
	switch kind {
	case "pptx":
		valid = bytes.HasPrefix(raw, []byte{'P', 'K', 3, 4}) ||
			bytes.HasPrefix(raw, []byte{'P', 'K', 5, 6}) ||
			bytes.HasPrefix(raw, []byte{'P', 'K', 7, 8})
	case "pdf":
		valid = bytes.HasPrefix(raw, []byte("%PDF-"))
	case "png":
		valid = bytes.HasPrefix(raw, []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'})
	}
	if !valid {
		return nil, errors.New("renderer file signature is invalid")
	}
	return raw, nil
}

func (handler *handlers) googleSlides(writer http.ResponseWriter, request *http.Request) {
	if _, err := handler.presentation(request); err != nil {
		writeError(writer, err)
		return
	}
	writeJSON(writer, http.StatusCreated, map[string]any{
		"success":         true,
		"googleSlidesUrl": "https://docs.google.com/presentation/d/placeholder",
		"message":         "Google Slides export would be created here",
	})
}

func (handler *handlers) presentation(request *http.Request) (map[string]any, error) {
	user, _ := auth.PrincipalFromContext(request.Context())
	presentation, err := handler.db.GetPresentationDetail(
		request.Context(), chi.URLParam(request, "presentationId"), false,
	)
	if err != nil {
		return nil, err
	}
	if presentation.UserID != user.ID {
		return nil, pgx.ErrNoRows
	}
	result := map[string]any{
		"id": presentation.ID, "title": presentation.Title, "slides": presentation.Slides,
		"template": presentation.Template,
	}
	if presentation.Template == nil {
		return result, nil
	}
	var config map[string]any
	if json.Unmarshal(presentation.Template.Config, &config) != nil {
		return nil, errors.New("invalid template config")
	}
	key := storageKey(config)
	source, _ := config["source"].(map[string]any)
	if key != "" && (source["kind"] == "pptx" || config["pptxTemplate"] != nil) {
		target, err := storagepath.Existing(handler.root, key)
		if err != nil {
			return nil, errors.New("PPTX source file is unavailable")
		}
		raw, err := osReadFile(target)
		if err != nil {
			return nil, err
		}
		config["sourcePptx"] = base64.StdEncoding.EncodeToString(raw)
	}
	template := *presentation.Template
	template.Config, _ = json.Marshal(config)
	result["template"] = template
	return result, nil
}

func storageKey(config map[string]any) string {
	for _, name := range []string{"source", "pptxTemplate"} {
		if value, ok := config[name].(map[string]any); ok {
			if key, ok := value["storageKey"].(string); ok {
				return key
			}
		}
	}
	return ""
}

func writeError(writer http.ResponseWriter, err error) {
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSONError(writer, http.StatusNotFound, "Presentation not found")
		return
	}
	writeJSONError(writer, http.StatusInternalServerError, "Internal server error")
}

func writeJSONError(writer http.ResponseWriter, status int, message string) {
	writeJSON(writer, status, map[string]any{
		"message": message, "error": http.StatusText(status), "statusCode": status,
	})
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

var osReadFile = func(path string) ([]byte, error) {
	return os.ReadFile(path)
}
