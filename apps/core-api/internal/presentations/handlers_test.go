package presentations_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/assets"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/auth"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/config"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/httpserver"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/presentations"
)

type endpoint struct {
	Method string `json:"method"`
	Path   string `json:"path"`
	Auth   string `json:"auth"`
}

func TestEndpointInventoryIncludesEveryNestPresentationSlideAndAssetRoute(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "endpoints.json"))
	if err != nil {
		t.Fatal(err)
	}
	var endpoints []endpoint
	if err := json.Unmarshal(raw, &endpoints); err != nil {
		t.Fatal(err)
	}
	if len(endpoints) != 27 {
		t.Fatalf("endpoint inventory has %d routes, want 27", len(endpoints))
	}
	required := map[string]bool{
		"GET /api/presentations/{id}/slides/{order}/template-html":    false,
		"PATCH /api/presentations/{presentationId}/slides/{id}/scene": false,
		"POST /api/assets/upload":                                     false,
		"GET /uploads/{key...}":                                       false,
	}
	for _, route := range endpoints {
		key := route.Method + " " + route.Path
		if _, ok := required[key]; ok {
			required[key] = true
		}
	}
	for route, found := range required {
		if !found {
			t.Errorf("missing endpoint %s", route)
		}
	}

	apiRoutes := chi.NewRouter()
	apiRoutes.Mount("/presentations", presentations.NewHandlers(nil, nil))
	apiRoutes.Mount("/assets", assets.NewHandlers(nil, nil))
	productionRouter := httpserver.New(nil, nil, apiRoutes, assets.NewDownloadHandler(t.TempDir()))
	routes, ok := productionRouter.(chi.Routes)
	if !ok {
		t.Fatalf("production router type %T does not expose registered routes", productionRouter)
	}
	actual := map[string]bool{}
	if err := chi.Walk(routes, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if strings.HasPrefix(route, "/api/presentations") ||
			strings.HasPrefix(route, "/api/assets") ||
			strings.HasPrefix(route, "/uploads") {
			actual[canonicalRoute(method+" "+route)] = true
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	expected := make(map[string]bool, len(endpoints))
	for _, route := range endpoints {
		expected[canonicalRoute(route.Method+" "+route.Path)] = true
	}
	if len(actual) != len(expected) {
		t.Fatalf("registered route count = %d, want %d; actual=%v", len(actual), len(expected), actual)
	}
	for route := range expected {
		if !actual[route] {
			t.Errorf("fixture route is not registered: %s", route)
		}
	}
	for route := range actual {
		if !expected[route] {
			t.Errorf("registered route is missing from fixture: %s", route)
		}
	}
}

func TestGlobalSlideDuplicateAliasRoute(t *testing.T) {
	router := chi.NewRouter()
	router.Mount("/slides", presentations.NewSlideHandlers(nil, nil))
	var routes []string
	if err := chi.Walk(router, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if method != http.MethodOptions {
			routes = append(routes, method+" "+route)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	want := []string{"POST /slides/{slideId}/duplicate"}
	if fmt.Sprint(routes) != fmt.Sprint(want) {
		t.Fatalf("routes = %v, want %v", routes, want)
	}
}

func TestPresentationSlideSceneAndAssetContracts(t *testing.T) {
	databaseURL := os.Getenv("JASLIDE_TEST_DATABASE_URL")
	redisURL := os.Getenv("JASLIDE_TEST_REDIS_URL")
	if databaseURL == "" || redisURL == "" {
		t.Skip("set JASLIDE_TEST_DATABASE_URL and JASLIDE_TEST_REDIS_URL")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	store, err := db.Open(ctx, config.Config{DatabaseURL: databaseURL, RedisURL: redisURL})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	sqlURL, err := prismaURL(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	connection, err := pgx.Connect(ctx, sqlURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close(context.Background()) })

	suffix := fmt.Sprint(time.Now().UnixNano())
	ownerID, otherID := "go-owner-"+suffix, "go-other-"+suffix
	for _, user := range []struct{ id, email string }{
		{ownerID, "owner-" + suffix + "@example.com"},
		{otherID, "other-" + suffix + "@example.com"},
	} {
		if _, err := connection.Exec(ctx, `INSERT INTO "User" ("id","email","updatedAt") VALUES ($1,$2,NOW())`, user.id, user.email); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		_, _ = connection.Exec(context.Background(), `DELETE FROM "User" WHERE "id" = ANY($1)`, []string{ownerID, otherID})
	})

	renderer := newSceneRenderer()
	defer renderer.Close()
	uploadRoot := t.TempDir()
	sessions, err := auth.NewSessions("contract-test-secret", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	authService := auth.NewService(store, sessions)
	presentationService := presentations.NewService(store, renderer.URL, uploadRoot, renderer.Client())
	assetService := assets.NewService(store, uploadRoot)
	router := chi.NewRouter()
	router.Mount("/api/presentations", presentations.NewHandlers(presentationService, authService))
	router.Mount("/api/assets", assets.NewHandlers(assetService, authService))
	router.Mount("/uploads", assets.NewDownloadHandler(uploadRoot))
	server := httptest.NewServer(router)
	defer server.Close()

	ownerToken, _ := sessions.Issue(auth.Principal{ID: ownerID, Email: "owner-" + suffix + "@example.com", Role: "USER"})
	otherToken, _ := sessions.Issue(auth.Principal{ID: otherID, Email: "other-" + suffix + "@example.com", Role: "USER"})
	client := server.Client()

	t.Run("presentation CRUD and ownership", func(t *testing.T) {
		created := requestJSON(t, client, ownerToken, http.MethodPost, server.URL+"/api/presentations",
			`{"title":"Weekly report","description":"clear me","sourceType":"TEXT","content":"0730 report"}`, http.StatusCreated)
		presentationID := stringField(t, created, "id")
		t.Cleanup(func() {
			requestJSON(t, client, ownerToken, http.MethodDelete, server.URL+"/api/presentations/"+presentationID, "", http.StatusOK)
		})

		requestJSON(t, client, ownerToken, http.MethodGet, server.URL+"/api/presentations/"+presentationID, "", http.StatusOK)
		requestJSON(t, client, otherToken, http.MethodGet, server.URL+"/api/presentations/"+presentationID, "", http.StatusForbidden)
		page := requestJSON(t, client, ownerToken, http.MethodGet, server.URL+"/api/presentations?page=1&limit=10", "", http.StatusOK)
		if page["total"].(float64) < 1 {
			t.Fatalf("presentation list total = %#v", page["total"])
		}
		updated := requestJSON(t, client, ownerToken, http.MethodPut, server.URL+"/api/presentations/"+presentationID,
			`{"title":"0730 weekly report"}`, http.StatusOK)
		if updated["title"] != "0730 weekly report" {
			t.Fatalf("updated title = %#v", updated["title"])
		}
		templateID := "go-template-" + suffix
		if _, err := connection.Exec(ctx, `
			INSERT INTO "Template" ("id","name","config","updatedAt")
			VALUES ($1,'Nullable contract','{}'::jsonb,NOW())`, templateID); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			_, _ = connection.Exec(context.Background(), `DELETE FROM "Template" WHERE "id"=$1`, templateID)
		})
		if _, err := connection.Exec(ctx, `
			UPDATE "Presentation" SET "templateId"=$2 WHERE "id"=$1`, presentationID, templateID); err != nil {
			t.Fatal(err)
		}
		cleared := requestJSON(t, client, ownerToken, http.MethodPut, server.URL+"/api/presentations/"+presentationID,
			`{"description":null,"templateId":null}`, http.StatusOK)
		if cleared["description"] != nil || cleared["templateId"] != nil {
			t.Fatalf("nullable fields after explicit null = description:%#v templateId:%#v, want nil",
				cleared["description"], cleared["templateId"])
		}
		if cleared["title"] != "0730 weekly report" {
			t.Fatalf("omitted title changed to %#v", cleared["title"])
		}
		share := requestJSON(t, client, ownerToken, http.MethodPost, server.URL+"/api/presentations/"+presentationID+"/share", `{}`, http.StatusCreated)
		token := stringField(t, share, "shareToken")
		requestJSON(t, client, "", http.MethodGet, server.URL+"/api/presentations/shared/"+token, "", http.StatusOK)
		skillID := "go-skill-" + suffix
		if _, err := connection.Exec(ctx, `
			INSERT INTO "PresentationSkill"
				("id","name","category","audience","tone","purpose","outlineGuidance","recommendedSlideCount","updatedAt")
			VALUES ($1,'Contract skill','test','test','test','test','test',1,NOW())`, skillID); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			_, _ = connection.Exec(context.Background(), `UPDATE "Presentation" SET "skillId"=NULL WHERE "skillId"=$1`, skillID)
			_, _ = connection.Exec(context.Background(), `DELETE FROM "PresentationSkill" WHERE "id"=$1`, skillID)
		})
		if _, err := connection.Exec(ctx, `
			UPDATE "Presentation" SET "skillId"=$2,"metadata"='{"private":9007199254740993123456789}'::jsonb
			WHERE "id"=$1`, presentationID, skillID); err != nil {
			t.Fatal(err)
		}
		duplicatePresentation := requestJSON(t, client, ownerToken, http.MethodPost, server.URL+"/api/presentations/"+presentationID+"/duplicate", `{}`, http.StatusCreated)
		if duplicatePresentation["skillId"] != nil || duplicatePresentation["metadata"] != nil {
			t.Fatalf("duplicate copied skillId/metadata: %#v", duplicatePresentation)
		}

		first := requestJSON(t, client, ownerToken, http.MethodPost, server.URL+"/api/presentations/"+presentationID+"/slides",
			`{"type":"CONTENT","title":"first","content":{"html":"<div>first</div>","unrelated":{"large":9007199254740993123456789}},"order":0}`, http.StatusCreated)
		second := requestJSON(t, client, ownerToken, http.MethodPost, server.URL+"/api/presentations/"+presentationID+"/slides",
			`{"type":"CONTENT","title":"second","content":{"html":"<div>second</div>"},"order":1}`, http.StatusCreated)
		firstID, secondID := stringField(t, first, "id"), stringField(t, second, "id")
		html := requestJSON(t, client, ownerToken, http.MethodGet,
			server.URL+"/api/presentations/"+presentationID+"/slides/0/template-html", "", http.StatusOK)
		if html["html"] != "<div>first</div>" {
			t.Fatalf("template html = %#v", html)
		}
		requestJSON(t, client, ownerToken, http.MethodGet,
			server.URL+"/api/presentations/"+presentationID+"/slides/"+firstID, "", http.StatusOK)
		requestJSON(t, client, ownerToken, http.MethodPut,
			server.URL+"/api/presentations/"+presentationID+"/slides/"+firstID,
			`{"title":"first updated","content":{"html":"<div>first</div>","unrelated":{"large":9007199254740993123456789}}}`, http.StatusOK)
		requestJSONArray(t, client, ownerToken, http.MethodPost, server.URL+"/api/presentations/"+presentationID+"/slides/reorder",
			fmt.Sprintf(`{"slideOrders":[{"slideId":%q,"order":1},{"slideId":%q,"order":0}]}`, firstID, secondID), http.StatusCreated)
		slides := requestJSONArray(t, client, ownerToken, http.MethodGet, server.URL+"/api/presentations/"+presentationID+"/slides", "", http.StatusOK)
		if stringField(t, slides[0], "id") != secondID || stringField(t, slides[1], "id") != firstID {
			t.Fatalf("reordered slides = %#v", slides)
		}
		requestJSON(t, client, otherToken, http.MethodPut, server.URL+"/api/presentations/"+presentationID+"/slides/"+firstID,
			`{"title":"stolen"}`, http.StatusForbidden)
		duplicate := requestJSON(t, client, ownerToken, http.MethodPost, server.URL+"/api/presentations/"+presentationID+"/slides/"+firstID+"/duplicate", `{}`, http.StatusCreated)
		requestJSON(t, client, ownerToken, http.MethodDelete,
			server.URL+"/api/presentations/"+presentationID+"/slides/"+stringField(t, duplicate, "id"), "", http.StatusOK)

		scene := `{"version":1,"width":1920,"height":1080,"objects":[{"id":"manual-text","type":"text","x":10,"y":20,"width":300,"height":80,"paragraphs":[]}]}`
		requestJSON(t, client, ownerToken, http.MethodPatch, server.URL+"/api/presentations/"+presentationID+"/slides/"+firstID+"/scene",
			`{"scene":`+scene+`}`, http.StatusOK)
		loaded := requestJSON(t, client, ownerToken, http.MethodGet, server.URL+"/api/presentations/"+presentationID+"/slides/"+firstID+"/scene", "", http.StatusOK)
		loadedScene := loaded["scene"].(map[string]any)
		if loadedScene["version"] != float64(1) || loadedScene["width"] != float64(1920) {
			t.Fatalf("scene did not survive reload: %#v", loadedScene)
		}
		var persisted json.RawMessage
		if err := connection.QueryRow(ctx, `SELECT "content" FROM "Slide" WHERE "id"=$1`, firstID).Scan(&persisted); err != nil {
			t.Fatal(err)
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(persisted, &fields); err != nil {
			t.Fatal(err)
		}
		var unrelated map[string]json.RawMessage
		if err := json.Unmarshal(fields["unrelated"], &unrelated); err != nil {
			t.Fatal(err)
		}
		if got := string(unrelated["large"]); got != "9007199254740993123456789" {
			t.Fatalf("unrelated large integer = %s, want exact digits", got)
		}
	})

	t.Run("multipart upload, download, ownership, and traversal rejection", func(t *testing.T) {
		png := validPNG()
		uploaded := upload(t, client, ownerToken, server.URL+"/api/assets/upload?type=IMAGE", "chart.png", png, http.StatusCreated)
		assetID, assetURL := stringField(t, uploaded, "id"), stringField(t, uploaded, "url")
		requestJSON(t, client, ownerToken, http.MethodGet, server.URL+"/api/assets/"+assetID, "", http.StatusOK)
		requestJSONArray(t, client, ownerToken, http.MethodGet, server.URL+"/api/assets?type=IMAGE", "", http.StatusOK)
		requestJSON(t, client, ownerToken, http.MethodGet, server.URL+"/api/assets/stock?q=office", "", http.StatusOK)
		requestJSON(t, client, ownerToken, http.MethodGet, server.URL+"/api/assets/icons?q=check", "", http.StatusOK)
		chart := requestJSON(t, client, ownerToken, http.MethodPost, server.URL+"/api/assets/chart",
			`{"data":{"type":"bar","title":"Progress","labels":["A"],"datasets":[{"label":"Done","data":[1]}]}}`,
			http.StatusCreated)
		if svg, _ := chart["svgCode"].(string); !strings.Contains(svg, "<rect") {
			t.Fatalf("bar chart has no bars: %q", svg)
		}
		response := request(t, client, "", http.MethodGet, server.URL+assetURL, "", "", http.StatusOK)
		if body, _ := io.ReadAll(response.Body); !bytes.Equal(body, png) {
			t.Fatalf("download body = %x", body)
		}
		if got := response.Header.Get("X-Content-Type-Options"); got != "nosniff" {
			t.Fatalf("download X-Content-Type-Options = %q, want nosniff", got)
		}
		_ = response.Body.Close()
		requestJSON(t, client, otherToken, http.MethodDelete, server.URL+"/api/assets/"+assetID, "", http.StatusNotFound)
		requestJSON(t, client, ownerToken, http.MethodDelete, server.URL+"/api/assets/"+assetID, "", http.StatusOK)
		upload(t, client, ownerToken, server.URL+"/api/assets/upload", "../escape.png", []byte("bad"), http.StatusBadRequest)
		upload(t, client, ownerToken, server.URL+"/api/assets/upload", "report:secret.png", []byte("bad"), http.StatusBadRequest)
		upload(t, client, ownerToken, server.URL+"/api/assets/upload?type=IMAGE", "script.png",
			[]byte("<!doctype html><script>alert(document.domain)</script>"), http.StatusBadRequest)

		darkChart := requestJSON(t, client, ownerToken, http.MethodPost, server.URL+"/api/assets/chart",
			`{"data":{"type":"bar","labels":["A"],"datasets":[{"label":"Done","data":[1]}]},"config":{"theme":"dark"}}`,
			http.StatusCreated)
		if svg := stringField(t, darkChart, "svgCode"); !strings.Contains(svg, `fill="#1F2937"`) {
			t.Fatalf("dark chart has no dark theme background: %q", svg)
		}
		pieChart := requestJSON(t, client, ownerToken, http.MethodPost, server.URL+"/api/assets/chart",
			`{"data":{"type":"pie","labels":["Pass","Fail"],"datasets":[{"label":"Series","data":[3,1]}]}}`,
			http.StatusCreated)
		pieSVG := stringField(t, pieChart, "svgCode")
		if !strings.Contains(pieSVG, ">Pass</text>") || !strings.Contains(pieSVG, ">Fail</text>") {
			t.Fatalf("pie chart legend does not use labels: %q", pieSVG)
		}
	})
}

func TestExistingWeeklyReportOpensWithoutChangingStoredContent(t *testing.T) {
	databaseURL := os.Getenv("JASLIDE_WEEKLY_DATABASE_URL")
	redisURL := os.Getenv("JASLIDE_WEEKLY_REDIS_URL")
	presentationID := os.Getenv("JASLIDE_WEEKLY_PRESENTATION_ID")
	rendererURL := os.Getenv("JASLIDE_WEEKLY_RENDERER_URL")
	storageRoot := os.Getenv("JASLIDE_WEEKLY_STORAGE_PATH")
	if databaseURL == "" || redisURL == "" || presentationID == "" || rendererURL == "" || storageRoot == "" {
		t.Skip("set JASLIDE_WEEKLY_* to verify an existing weekly report")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	store, err := db.Open(ctx, config.Config{DatabaseURL: databaseURL, RedisURL: redisURL})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	sqlURL, err := prismaURL(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	connection, err := pgx.Connect(ctx, sqlURL)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close(context.Background())
	var userID string
	var before json.RawMessage
	if err := connection.QueryRow(ctx, `
		SELECT p."userId",s."content"
		FROM "Presentation" p JOIN "Slide" s ON s."presentationId"=p."id"
		WHERE p."id"=$1 ORDER BY s."order" LIMIT 1`, presentationID).Scan(&userID, &before); err != nil {
		t.Fatal(err)
	}
	service := presentations.NewService(store, rendererURL, storageRoot, &http.Client{Timeout: 45 * time.Second})
	presentation, err := service.GetPresentation(ctx, presentationID, userID)
	if err != nil {
		t.Fatal(err)
	}
	if len(presentation.Slides) == 0 || !bytes.Equal(before, presentation.Slides[0].Content) {
		t.Fatalf("weekly report content changed while opening")
	}
	raw, err := service.GetScene(ctx, presentation.Slides[0].ID, userID)
	if err != nil {
		t.Fatal(err)
	}
	var scene struct {
		Scene struct {
			Width   float64           `json:"width"`
			Objects []json.RawMessage `json:"objects"`
		} `json:"scene"`
	}
	if err := json.Unmarshal(raw, &scene); err != nil {
		t.Fatal(err)
	}
	if scene.Scene.Width == 0 || len(scene.Scene.Objects) == 0 {
		t.Fatalf("weekly report scene is empty: %s", raw)
	}
	var after json.RawMessage
	if err := connection.QueryRow(ctx, `
		SELECT s."content" FROM "Slide" s
		WHERE s."presentationId"=$1 ORDER BY s."order" LIMIT 1`, presentationID).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("opening the weekly report mutated stored content")
	}
}

func newSceneRenderer() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var body map[string]json.RawMessage
		_ = json.NewDecoder(request.Body).Decode(&body)
		switch request.URL.Path {
		case "/api/scene/html/save":
			encoded := base64.StdEncoding.EncodeToString(body["scene"])
			_ = json.NewEncoder(writer).Encode(map[string]string{"html": "scene:" + encoded})
		case "/api/scene/html/load":
			var html string
			_ = json.Unmarshal(body["html"], &html)
			if strings.HasPrefix(html, "scene:") {
				raw, _ := base64.StdEncoding.DecodeString(strings.TrimPrefix(html, "scene:"))
				writer.Header().Set("Content-Type", "application/json")
				_, _ = writer.Write([]byte(`{"scene":` + string(raw) + `}`))
				return
			}
			_, _ = writer.Write([]byte(`{"scene":{"version":1,"width":1920,"height":1080,"objects":[]}}`))
		default:
			http.NotFound(writer, request)
		}
	}))
}

func prismaURL(raw string) (string, error) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	query := parsed.Query()
	if schema := query.Get("schema"); schema != "" {
		query.Del("schema")
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
	}
	return parsed.String(), nil
}

func requestJSON(t *testing.T, client *http.Client, token, method, target, body string, want int) map[string]any {
	t.Helper()
	response := request(t, client, token, method, target, "application/json", body, want)
	defer response.Body.Close()
	var value map[string]any
	if err := json.NewDecoder(response.Body).Decode(&value); err != nil {
		t.Fatalf("%s %s response: %v", method, target, err)
	}
	return value
}

func requestJSONArray(t *testing.T, client *http.Client, token, method, target, body string, want int) []map[string]any {
	t.Helper()
	response := request(t, client, token, method, target, "application/json", body, want)
	defer response.Body.Close()
	var value []map[string]any
	if err := json.NewDecoder(response.Body).Decode(&value); err != nil {
		t.Fatal(err)
	}
	return value
}

func request(t *testing.T, client *http.Client, token, method, target, contentType, body string, want int) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, target, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.AddCookie(&http.Cookie{Name: "jaslide_session", Value: token})
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	response, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != want {
		data, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		t.Fatalf("%s %s status = %d, want %d; body=%s", method, target, response.StatusCode, want, data)
	}
	return response
}

func upload(t *testing.T, client *http.Client, token, target, filename string, data []byte, want int) map[string]any {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	header := make(map[string][]string)
	header["Content-Disposition"] = []string{fmt.Sprintf(`form-data; name="file"; filename="%s"`, filename)}
	header["Content-Type"] = []string{"image/png"}
	part, err := writer.CreatePart(header)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write(data)
	_ = writer.Close()
	req, _ := http.NewRequest(http.MethodPost, target, &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.AddCookie(&http.Cookie{Name: "jaslide_session", Value: token})
	response, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != want {
		raw, _ := io.ReadAll(response.Body)
		t.Fatalf("upload %q status = %d, want %d; body=%s", filename, response.StatusCode, want, raw)
	}
	var value map[string]any
	_ = json.NewDecoder(response.Body).Decode(&value)
	return value
}

func stringField(t *testing.T, value map[string]any, key string) string {
	t.Helper()
	result, ok := value[key].(string)
	if !ok || result == "" {
		t.Fatalf("%s = %#v, want non-empty string", key, value[key])
	}
	return result
}

func canonicalRoute(route string) string {
	route = strings.ReplaceAll(route, "/*", "/{}")
	var result strings.Builder
	for {
		start := strings.Index(route, "{")
		if start < 0 {
			result.WriteString(route)
			return strings.TrimSuffix(result.String(), "/")
		}
		end := strings.Index(route[start:], "}")
		if end < 0 {
			result.WriteString(route)
			return strings.TrimSuffix(result.String(), "/")
		}
		result.WriteString(route[:start])
		result.WriteString("{}")
		route = route[start+end+1:]
	}
}

func validPNG() []byte {
	return []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	}
}
