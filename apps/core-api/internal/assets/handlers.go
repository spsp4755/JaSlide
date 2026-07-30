package assets

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/auth"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/storagepath"
)

const maxUploadBytes = 64 << 20

type handlers struct {
	service *Service
}

type chartData struct {
	Type     string   `json:"type"`
	Title    string   `json:"title,omitempty"`
	Labels   []string `json:"labels"`
	Datasets []struct {
		Label           string    `json:"label"`
		Data            []float64 `json:"data"`
		BackgroundColor any       `json:"backgroundColor,omitempty"`
		BorderColor     string    `json:"borderColor,omitempty"`
	} `json:"datasets"`
}

func NewHandlers(service *Service, authService *auth.Service) http.Handler {
	handler := &handlers{service: service}
	router := chi.NewRouter()
	router.Use(auth.RequireUser(authService))
	router.Post("/upload", handler.upload)
	router.Get("/", handler.list)
	router.Get("/stock", handler.stock)
	router.Get("/icons", handler.icons)
	router.Post("/chart", handler.chart)
	router.Get("/{id}", handler.get)
	router.Delete("/{id}", handler.delete)
	return router
}

func NewDownloadHandler(root string) http.Handler {
	root = filepath.Clean(root)
	handler := http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("X-Content-Type-Options", "nosniff")
		key := chi.URLParam(request, "*")
		if key == "" {
			key = strings.TrimPrefix(request.URL.Path, "/uploads/")
		}
		target, err := storagepath.Existing(root, strings.TrimPrefix(key, "/"))
		if err != nil {
			http.NotFound(writer, request)
			return
		}
		info, err := os.Stat(target)
		if err != nil || info.IsDir() {
			http.NotFound(writer, request)
			return
		}
		head, err := readHead(target)
		if err != nil {
			http.NotFound(writer, request)
			return
		}
		mimeType, renderable := renderableStoredType(filepath.Base(target), head)
		if renderable {
			writer.Header().Set("Content-Type", mimeType)
		} else {
			writer.Header().Set("Content-Type", "application/octet-stream")
			writer.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{
				"filename": filepath.Base(target),
			}))
		}
		http.ServeFile(writer, request, target)
	})
	router := chi.NewRouter()
	router.Get("/*", handler.ServeHTTP)
	router.Head("/*", handler.ServeHTTP)
	return router
}

func (handler *handlers) upload(writer http.ResponseWriter, request *http.Request) {
	request.Body = http.MaxBytesReader(writer, request.Body, maxUploadBytes+(1<<20))
	reader, err := request.MultipartReader()
	if err != nil {
		writeError(writer, http.StatusBadRequest, "file is required", "Bad Request")
		return
	}
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			writeError(writer, http.StatusBadRequest, "invalid multipart upload", "Bad Request")
			return
		}
		if part.FormName() != "file" {
			_ = part.Close()
			continue
		}
		filename := rawFilename(part.Header.Get("Content-Disposition"))
		if !safeFilename(filename) {
			_ = part.Close()
			writeError(writer, http.StatusBadRequest, "unsafe filename", "Bad Request")
			return
		}
		data, err := io.ReadAll(io.LimitReader(part, maxUploadBytes+1))
		_ = part.Close()
		if err != nil || len(data) > maxUploadBytes {
			writeError(writer, http.StatusBadRequest, "file is too large", "Bad Request")
			return
		}
		assetType := request.URL.Query().Get("type")
		if assetType == "" {
			assetType = "IMAGE"
		}
		mimeType := part.Header.Get("Content-Type")
		if mimeType == "" {
			mimeType = http.DetectContentType(data)
		}
		principal, _ := auth.PrincipalFromContext(request.Context())
		result, err := handler.service.Upload(request.Context(), principal.ID, filename, mimeType, assetType, data)
		writeResult(writer, http.StatusCreated, result, err)
		return
	}
	writeError(writer, http.StatusBadRequest, "file is required", "Bad Request")
}

func (handler *handlers) list(writer http.ResponseWriter, request *http.Request) {
	var assetType *string
	if value := request.URL.Query().Get("type"); value != "" {
		assetType = &value
	}
	principal, _ := auth.PrincipalFromContext(request.Context())
	result, err := handler.service.List(request.Context(), principal.ID, assetType)
	writeResult(writer, http.StatusOK, result, err)
}

func (handler *handlers) get(writer http.ResponseWriter, request *http.Request) {
	result, err := handler.service.Get(request.Context(), chi.URLParam(request, "id"))
	writeResult(writer, http.StatusOK, result, err)
}

func (handler *handlers) delete(writer http.ResponseWriter, request *http.Request) {
	principal, _ := auth.PrincipalFromContext(request.Context())
	err := handler.service.Delete(request.Context(), chi.URLParam(request, "id"), principal.ID)
	writeResult(writer, http.StatusOK, map[string]bool{"success": true}, err)
}

func (handler *handlers) stock(writer http.ResponseWriter, request *http.Request) {
	query := request.URL.Query().Get("q")
	writeJSON(writer, http.StatusOK, map[string]any{
		"images": []map[string]string{{
			"id":           "stock-1",
			"url":          "https://images.unsplash.com/photo-1499750310107-5fef28a66643",
			"thumbnailUrl": "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=200",
			"author":       "Unsplash", "license": "Unsplash License",
		}},
		"query": query, "source": "unsplash",
	})
}

func (handler *handlers) icons(writer http.ResponseWriter, request *http.Request) {
	writeJSON(writer, http.StatusOK, map[string]any{
		"icons": []map[string]string{{
			"id": "icon-1", "name": "check", "url": "/icons/check.svg", "category": "actions",
		}},
		"query": request.URL.Query().Get("q"),
	})
}

func (handler *handlers) chart(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		Data   chartData `json:"data"`
		Config struct {
			Width         int    `json:"width"`
			Height        int    `json:"height"`
			Theme         string `json:"theme"`
			ShowLegend    *bool  `json:"showLegend"`
			ShowGridLines *bool  `json:"showGridLines"`
		} `json:"config"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 1<<20))
	if err := decoder.Decode(&input); err != nil || !chartTypes[input.Data.Type] ||
		len(input.Data.Labels) == 0 || len(input.Data.Datasets) == 0 {
		writeError(writer, http.StatusBadRequest, "data is required", "Bad Request")
		return
	}
	width, height := input.Config.Width, input.Config.Height
	if width <= 0 {
		width = 600
	}
	if height <= 0 {
		height = 400
	}
	for index := range input.Data.Datasets {
		color := chartPalette[index%len(chartPalette)]
		if input.Data.Datasets[index].BackgroundColor == nil {
			input.Data.Datasets[index].BackgroundColor = color
		}
		if input.Data.Datasets[index].BorderColor == "" {
			input.Data.Datasets[index].BorderColor = color
		}
	}
	showLegend := input.Config.ShowLegend == nil || *input.Config.ShowLegend
	showGrid := input.Config.ShowGridLines == nil || *input.Config.ShowGridLines
	svg := chartSVG(input.Data, width, height, input.Config.Theme, showLegend, showGrid)
	writeJSON(writer, http.StatusCreated, map[string]any{"svgCode": svg, "config": input.Data})
}

func chartSVG(data chartData, width, height int, theme string, showLegend, showGrid bool) string {
	var svg strings.Builder
	fmt.Fprintf(&svg, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d">`, width, height, width, height)
	if theme == "dark" {
		svg.WriteString(`<rect width="100%" height="100%" fill="#1F2937"/>`)
	}
	if data.Title != "" {
		fmt.Fprintf(&svg, `<text x="%d" y="24" text-anchor="middle" fill="#111827" font-size="16" font-weight="600">%s</text>`, width/2, escapeXML(data.Title))
	}
	left, top, right, bottom := 60, 40, width-20, height-60
	chartWidth, chartHeight := max(1, right-left), max(1, bottom-top)
	maxValue := 0.0
	for _, dataset := range data.Datasets {
		for _, value := range dataset.Data {
			if value > maxValue {
				maxValue = value
			}
		}
	}
	if maxValue <= 0 {
		maxValue = 1
	}
	if showGrid && data.Type != "pie" && data.Type != "doughnut" {
		for index := 0; index <= 5; index++ {
			y := top + chartHeight*index/5
			fmt.Fprintf(&svg, `<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="#E5E7EB" stroke-width="1"/>`, left, y, right, y)
		}
	}
	switch data.Type {
	case "bar":
		groupWidth := float64(chartWidth) / float64(len(data.Labels))
		barWidth := groupWidth * .8 / float64(len(data.Datasets))
		for datasetIndex, dataset := range data.Datasets {
			for valueIndex, value := range dataset.Data {
				barHeight := value / maxValue * float64(chartHeight)
				x := float64(left) + float64(valueIndex)*groupWidth + groupWidth*.1 + float64(datasetIndex)*barWidth
				y := float64(bottom) - barHeight
				fmt.Fprintf(&svg, `<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="%s" rx="2"/>`,
					x, y, math.Max(1, barWidth-2), math.Max(0, barHeight), escapeXML(colorAt(dataset.BackgroundColor, valueIndex, dataset.BorderColor)))
			}
		}
	case "line", "area":
		for _, dataset := range data.Datasets {
			var points []string
			for index, value := range dataset.Data {
				x := float64(left)
				if len(data.Labels) > 1 {
					x += float64(chartWidth*index) / float64(len(data.Labels)-1)
				}
				y := float64(bottom) - value/maxValue*float64(chartHeight)
				points = append(points, fmt.Sprintf("%.2f,%.2f", x, y))
			}
			if data.Type == "area" && len(points) > 0 {
				fmt.Fprintf(&svg, `<polygon points="%d,%d %s %d,%d" fill="%s" fill-opacity=".35"/>`,
					left, bottom, strings.Join(points, " "), right, bottom, escapeXML(colorAt(dataset.BackgroundColor, 0, dataset.BorderColor)))
			}
			fmt.Fprintf(&svg, `<polyline points="%s" fill="none" stroke="%s" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
				strings.Join(points, " "), escapeXML(dataset.BorderColor))
		}
	case "pie", "doughnut":
		values := data.Datasets[0].Data
		total := 0.0
		for _, value := range values {
			total += math.Max(0, value)
		}
		if total == 0 {
			total = 1
		}
		centerX, centerY := float64(width)/2, float64(height)/2
		radius := float64(min(width, height))/2 - 40
		inner := 0.0
		if data.Type == "doughnut" {
			inner = radius * .6
		}
		angle := -math.Pi / 2
		for index, value := range values {
			slice := math.Max(0, value) / total * 2 * math.Pi
			next := angle + slice
			x1, y1 := centerX+radius*math.Cos(angle), centerY+radius*math.Sin(angle)
			x2, y2 := centerX+radius*math.Cos(next), centerY+radius*math.Sin(next)
			large := 0
			if slice > math.Pi {
				large = 1
			}
			if inner > 0 {
				ix1, iy1 := centerX+inner*math.Cos(angle), centerY+inner*math.Sin(angle)
				ix2, iy2 := centerX+inner*math.Cos(next), centerY+inner*math.Sin(next)
				fmt.Fprintf(&svg, `<path d="M %.2f %.2f A %.2f %.2f 0 %d 1 %.2f %.2f L %.2f %.2f A %.2f %.2f 0 %d 0 %.2f %.2f Z" fill="%s"/>`,
					x1, y1, radius, radius, large, x2, y2, ix2, iy2, inner, inner, large, ix1, iy1,
					escapeXML(pieColor(data.Datasets[0].BackgroundColor, index)))
			} else {
				fmt.Fprintf(&svg, `<path d="M %.2f %.2f L %.2f %.2f A %.2f %.2f 0 %d 1 %.2f %.2f Z" fill="%s"/>`,
					centerX, centerY, x1, y1, radius, radius, large, x2, y2,
					escapeXML(pieColor(data.Datasets[0].BackgroundColor, index)))
			}
			angle = next
		}
	}
	if data.Type != "pie" && data.Type != "doughnut" {
		for index, label := range data.Labels {
			x := left + chartWidth*(2*index+1)/(2*len(data.Labels))
			fmt.Fprintf(&svg, `<text x="%d" y="%d" text-anchor="middle" fill="#6B7280" font-size="12">%s</text>`,
				x, height-20, escapeXML(label))
		}
	}
	if showLegend {
		if data.Type == "pie" || data.Type == "doughnut" {
			for index, label := range data.Labels {
				y := 50 + index*20
				fmt.Fprintf(&svg, `<rect x="20" y="%d" width="12" height="12" fill="%s" rx="2"/><text x="38" y="%d" fill="#6B7280" font-size="11">%s</text>`,
					y, escapeXML(pieColor(data.Datasets[0].BackgroundColor, index)), y+10, escapeXML(label))
			}
		} else {
			for index, dataset := range data.Datasets {
				y := 50 + index*20
				fmt.Fprintf(&svg, `<rect x="%d" y="%d" width="12" height="12" fill="%s" rx="2"/><text x="%d" y="%d" fill="#6B7280" font-size="11">%s</text>`,
					width-120, y, escapeXML(colorAt(dataset.BackgroundColor, 0, dataset.BorderColor)),
					width-102, y+10, escapeXML(dataset.Label))
			}
		}
	}
	svg.WriteString(`</svg>`)
	return svg.String()
}

func colorAt(value any, index int, fallback string) string {
	switch colors := value.(type) {
	case string:
		if colors != "" {
			return colors
		}
	case []any:
		if index < len(colors) {
			if color, ok := colors[index].(string); ok && color != "" {
				return color
			}
		}
	}
	return fallback
}

func pieColor(value any, index int) string {
	if colors, ok := value.([]any); ok && index < len(colors) {
		if color, ok := colors[index].(string); ok && color != "" {
			return color
		}
	}
	return chartPalette[index%len(chartPalette)]
}

func rawFilename(disposition string) string {
	_, params, err := mime.ParseMediaType(disposition)
	if err != nil {
		return ""
	}
	return params["filename"]
}

func readHead(path string) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	head := make([]byte, 512)
	count, err := file.Read(head)
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, err
	}
	return head[:count], nil
}

func renderableStoredType(filename string, head []byte) (string, bool) {
	mimeType := detectedMediaType(head)
	extension := strings.ToLower(filepath.Ext(filename))
	for _, policy := range uploadMediaPolicy {
		allowed, exists := policy[mimeType]
		if !exists {
			continue
		}
		for _, candidate := range allowed {
			if extension == candidate {
				return mimeType, true
			}
		}
	}
	return "", false
}

func escapeXML(value string) string {
	replacer := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&apos;")
	return replacer.Replace(value)
}

var chartTypes = map[string]bool{"bar": true, "line": true, "pie": true, "doughnut": true, "area": true}

var chartPalette = []string{"#8B5CF6", "#06B6D4", "#F59E0B", "#EF4444", "#10B981", "#6366F1", "#EC4899", "#14B8A6"}

func writeResult(writer http.ResponseWriter, status int, value any, err error) {
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			writeError(writer, http.StatusNotFound, "Asset not found", "Not Found")
		case errors.Is(err, ErrBadRequest):
			writeError(writer, http.StatusBadRequest, "Bad Request", "Bad Request")
		default:
			writeError(writer, http.StatusInternalServerError, "Internal server error", "Internal Server Error")
		}
		return
	}
	writeJSON(writer, status, value)
}

func writeError(writer http.ResponseWriter, status int, message, kind string) {
	writeJSON(writer, status, map[string]any{"message": message, "error": kind, "statusCode": status})
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}
