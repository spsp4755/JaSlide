package generation

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/auth"
	rendererclient "github.com/spsp4755/JaSlide/apps/core-api/internal/renderer"
)

const maxSourceBytes = 50 << 20

type handlers struct {
	service  *Service
	renderer *rendererclient.Client
}

func NewHandlers(service *Service, authService *auth.Service, renderer *rendererclient.Client) http.Handler {
	handler := &handlers{service: service, renderer: renderer}
	router := chi.NewRouter()
	router.Use(auth.RequireUser(authService))
	router.Post("/source/extract", handler.extractSource)
	router.Post("/outline", handler.outline)
	router.Post("/start", handler.start)
	router.Get("/{jobId}/status", handler.status)
	router.Post("/{jobId}/cancel", handler.cancel)
	router.Post("/edit", handler.edit)
	return router
}

func (handler *handlers) extractSource(writer http.ResponseWriter, request *http.Request) {
	file, header, err := sourceFile(writer, request)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	defer file.Close()
	content, err := io.ReadAll(io.LimitReader(file, maxSourceBytes+1))
	if err != nil || len(content) == 0 || len(content) > maxSourceBytes {
		writeError(writer, http.StatusBadRequest, "Invalid source file size")
		return
	}
	extension := strings.ToLower(filepath.Ext(header.Filename))
	var result extractedSource
	switch extension {
	case ".pptx":
		var extracted struct {
			Content string `json:"content"`
			Slides  []struct {
				Number  int    `json:"number"`
				Title   string `json:"title"`
				Content string `json:"content"`
			} `json:"slides"`
		}
		if err := handler.renderer.PostFile(
			request.Context(), "/api/extract/content", header.Filename,
			rendererclient.PPTXContentType, content, &extracted,
		); err != nil {
			writeError(writer, rendererStatus(err), err.Error())
			return
		}
		result.Content = extracted.Content
		for _, slide := range extracted.Slides {
			if strings.TrimSpace(slide.Content) != "" && slide.Number > 0 {
				locator := fmt.Sprintf("%s:slide:%d", header.Filename, slide.Number)
				if strings.TrimSpace(slide.Title) != "" {
					locator += ":" + strings.TrimSpace(slide.Title)
				}
				result.Chunks = append(result.Chunks, sourceChunk{Locator: locator, Content: strings.TrimSpace(slide.Content)})
			}
		}
	case ".txt", ".csv", ".md", ".markdown":
		if !utf8.Valid(content) {
			writeError(writer, http.StatusBadRequest, "Source file must be UTF-8")
			return
		}
		text := strings.TrimSpace(string(content))
		result = sourceFromText(header.Filename, text)
	case ".docx":
		text, err := extractDOCX(content)
		if err != nil {
			writeError(writer, http.StatusBadRequest, "Invalid DOCX file")
			return
		}
		result = sourceFromText(header.Filename, text)
	case ".xlsx":
		text, err := extractXLSX(content)
		if err != nil {
			writeError(writer, http.StatusBadRequest, "Invalid XLSX file")
			return
		}
		result = sourceFromText(header.Filename, text)
	default:
		writeError(writer, http.StatusBadRequest, "Unsupported source file")
		return
	}
	if strings.TrimSpace(result.Content) == "" || len(result.Chunks) == 0 {
		writeError(writer, http.StatusBadRequest, "Source file has no extractable content")
		return
	}
	writeJSON(writer, http.StatusCreated, result)
}

func (handler *handlers) outline(writer http.ResponseWriter, request *http.Request) {
	var input OutlineInput
	if err := decode(writer, request, &input); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	result, err := handler.service.GenerateOutline(request.Context(), principal(request), input)
	writeServiceResult(writer, http.StatusCreated, result, err)
}

func (handler *handlers) start(writer http.ResponseWriter, request *http.Request) {
	var input StartInput
	if err := decode(writer, request, &input); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	result, err := handler.service.Start(request.Context(), principal(request), input)
	writeServiceResult(writer, http.StatusCreated, result, err)
}

func (handler *handlers) status(writer http.ResponseWriter, request *http.Request) {
	user, _ := auth.PrincipalFromContext(request.Context())
	job, err := handler.service.Status(request.Context(), chi.URLParam(request, "jobId"), user.ID)
	if err != nil {
		writeServiceResult(writer, 0, nil, err)
		return
	}
	var errorValue any
	if len(job.Error) > 0 {
		_ = json.Unmarshal(job.Error, &errorValue)
	}
	var presentation any
	if job.Status == "COMPLETED" && len(job.Presentation) > 0 {
		_ = json.Unmarshal(job.Presentation, &presentation)
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"id": job.ID, "status": job.Status, "progress": job.Progress,
		"error": errorValue, "presentation": presentation,
	})
}

func (handler *handlers) cancel(writer http.ResponseWriter, request *http.Request) {
	user, _ := auth.PrincipalFromContext(request.Context())
	err := handler.service.Cancel(request.Context(), chi.URLParam(request, "jobId"), user.ID)
	writeServiceResult(writer, http.StatusCreated, map[string]bool{"success": true}, err)
}

func (handler *handlers) edit(writer http.ResponseWriter, request *http.Request) {
	var input AIEditInput
	if err := decode(writer, request, &input); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	user, _ := auth.PrincipalFromContext(request.Context())
	slides, err := handler.service.AIEdit(request.Context(), user.ID, input)
	if err != nil {
		writeServiceResult(writer, 0, nil, err)
		return
	}
	result := map[string]any{"success": true, "slides": slides}
	if len(slides) > 0 {
		result["slide"] = slides[0]
	}
	writeJSON(writer, http.StatusCreated, result)
}

type extractedSource struct {
	Content string        `json:"content"`
	Chunks  []sourceChunk `json:"chunks"`
}

type sourceChunk struct {
	Locator string `json:"locator"`
	Content string `json:"content"`
}

func sourceFromText(filename, content string) extractedSource {
	var chunks []sourceChunk
	for index, section := range splitSections(content) {
		chunks = append(chunks, sourceChunk{
			Locator: fmt.Sprintf("%s:section:%d", filename, index+1), Content: section,
		})
	}
	return extractedSource{Content: content, Chunks: chunks}
}

func splitSections(content string) []string {
	var result []string
	for _, value := range strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n\n") {
		if value = strings.TrimSpace(value); value != "" {
			result = append(result, value)
		}
	}
	if len(result) == 0 && strings.TrimSpace(content) != "" {
		result = []string{strings.TrimSpace(content)}
	}
	return result
}

func extractDOCX(content []byte) (string, error) {
	archive, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		return "", err
	}
	for _, entry := range archive.File {
		if entry.Name != "word/document.xml" {
			continue
		}
		return xmlText(entry, map[string]bool{"t": true}, map[string]bool{"p": true})
	}
	return "", errors.New("document.xml missing")
}

func extractXLSX(content []byte) (string, error) {
	archive, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		return "", err
	}
	var sections []string
	for _, entry := range archive.File {
		if strings.HasPrefix(entry.Name, "xl/worksheets/sheet") && strings.HasSuffix(entry.Name, ".xml") {
			text, err := xmlText(entry, map[string]bool{"v": true, "t": true}, map[string]bool{"row": true})
			if err != nil {
				return "", err
			}
			if text != "" {
				sections = append(sections, text)
			}
		}
	}
	if len(sections) == 0 {
		return "", errors.New("worksheets missing")
	}
	return strings.Join(sections, "\n\n"), nil
}

func xmlText(entry *zip.File, textElements, newlineElements map[string]bool) (string, error) {
	file, err := entry.Open()
	if err != nil {
		return "", err
	}
	defer file.Close()
	decoder := xml.NewDecoder(io.LimitReader(file, 20<<20))
	var result strings.Builder
	var capture bool
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", err
		}
		switch value := token.(type) {
		case xml.StartElement:
			capture = textElements[value.Name.Local]
		case xml.CharData:
			if capture {
				result.Write(value)
				result.WriteByte(' ')
			}
		case xml.EndElement:
			capture = false
			if newlineElements[value.Name.Local] {
				result.WriteByte('\n')
			}
		}
	}
	return strings.TrimSpace(result.String()), nil
}

func sourceFile(writer http.ResponseWriter, request *http.Request) (multipart.File, *multipart.FileHeader, error) {
	request.Body = http.MaxBytesReader(writer, request.Body, maxSourceBytes+(1<<20))
	if err := request.ParseMultipartForm(maxSourceBytes); err != nil {
		return nil, nil, errors.New("source file is required")
	}
	return request.FormFile("file")
}

func principal(request *http.Request) Principal {
	user, _ := auth.PrincipalFromContext(request.Context())
	return Principal{ID: user.ID, OrganizationID: user.OrganizationID}
}

func decode(writer http.ResponseWriter, request *http.Request, target any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 16<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("multiple JSON values")
	}
	return nil
}

func writeServiceResult(writer http.ResponseWriter, status int, value any, err error) {
	if err == nil {
		writeJSON(writer, status, value)
		return
	}
	switch {
	case errors.Is(err, ErrBadInput):
		writeError(writer, http.StatusBadRequest, strings.TrimPrefix(err.Error(), ErrBadInput.Error()+": "))
	case errors.Is(err, ErrNotFound):
		writeError(writer, http.StatusBadRequest, "Job not found")
	case errors.Is(err, ErrCancelled):
		writeError(writer, http.StatusConflict, "Generation cancelled")
	default:
		writeError(writer, http.StatusServiceUnavailable, err.Error())
	}
}

func rendererStatus(err error) int {
	if strings.Contains(err.Error(), "status 4") {
		return http.StatusBadRequest
	}
	return http.StatusServiceUnavailable
}

func writeError(writer http.ResponseWriter, status int, message string) {
	writeJSON(writer, status, map[string]any{
		"message": message, "error": http.StatusText(status), "statusCode": status,
	})
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}
