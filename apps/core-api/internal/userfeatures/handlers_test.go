package userfeatures_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/auth"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/config"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/userfeatures"
)

func TestUserFeatureRoutes(t *testing.T) {
	router := chi.NewRouter()
	userfeatures.RegisterRoutes(router, nil, nil)

	var got []string
	if err := chi.Walk(router, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if method != http.MethodOptions {
			got = append(got, method+" "+route)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	sort.Strings(got)
	want := []string{
		"DELETE /blocks/{id}",
		"DELETE /collaborators/{id}",
		"DELETE /export-presets/{id}",
		"DELETE /favorites/{id}",
		"DELETE /input-prompts/{id}",
		"DELETE /organizations/{organizationId}/color-palettes/{id}",
		"DELETE /organizations/{organizationId}/font-sets/{id}",
		"DELETE /recent-works/",
		"DELETE /recent-works/{presentationId}",
		"GET /blocks/{id}",
		"GET /export-presets/",
		"GET /export-presets/default",
		"GET /export-presets/{id}",
		"GET /favorites/",
		"GET /input-prompts/",
		"GET /input-prompts/recent",
		"GET /input-prompts/{id}",
		"GET /organizations/{organizationId}/color-palettes/",
		"GET /organizations/{organizationId}/color-palettes/{id}",
		"GET /organizations/{organizationId}/font-sets/",
		"GET /organizations/{organizationId}/font-sets/{id}",
		"GET /presentations/{presentationId}/collaborators",
		"GET /recent-works/",
		"GET /slides/{slideId}/blocks",
		"PATCH /blocks/{id}",
		"PATCH /collaborators/{id}",
		"PATCH /export-presets/{id}",
		"PATCH /favorites/{id}",
		"PATCH /input-prompts/{id}",
		"PATCH /organizations/{organizationId}/color-palettes/{id}",
		"PATCH /organizations/{organizationId}/font-sets/{id}",
		"POST /blocks/{id}/duplicate",
		"POST /export-presets/",
		"POST /favorites/",
		"POST /favorites/reorder",
		"POST /input-prompts/",
		"POST /organizations/{organizationId}/color-palettes/",
		"POST /organizations/{organizationId}/font-sets/",
		"POST /presentations/{presentationId}/collaborators",
		"POST /recent-works/{presentationId}",
		"POST /slides/{slideId}/blocks",
		"POST /slides/{slideId}/blocks/reorder",
	}
	sort.Strings(want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("routes = %#v, want %#v", got, want)
	}
}

func TestUserFeatureRoutesRequireAuthentication(t *testing.T) {
	sessions, err := auth.NewSessions("test-secret", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	router := chi.NewRouter()
	userfeatures.RegisterRoutes(router, nil, auth.NewService(nil, sessions))

	for _, target := range []string{
		"/favorites",
		"/slides/slide-1/blocks",
		"/presentations/presentation-1/collaborators",
		"/export-presets",
		"/input-prompts",
		"/recent-works",
		"/organizations/org-1/color-palettes",
		"/organizations/org-1/font-sets",
	} {
		request := httptest.NewRequest(http.MethodGet, target, nil)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized {
			t.Errorf("GET %s status = %d, want %d", target, response.Code, http.StatusUnauthorized)
		}
	}
}

func TestUserFeatureContractsAndOwnership(t *testing.T) {
	databaseURL := os.Getenv("JASLIDE_TEST_DATABASE_URL")
	redisURL := os.Getenv("JASLIDE_TEST_REDIS_URL")
	if databaseURL == "" || redisURL == "" {
		t.Skip("set JASLIDE_TEST_DATABASE_URL and JASLIDE_TEST_REDIS_URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	store, err := db.Open(ctx, config.Config{DatabaseURL: databaseURL, RedisURL: redisURL})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	suffix := fmt.Sprint(time.Now().UnixNano())
	orgID, ownerID, otherID, viewerID := "routes-org-"+suffix, "routes-owner-"+suffix, "routes-other-"+suffix, "routes-viewer-"+suffix
	presentationID, slideID := "routes-presentation-"+suffix, "routes-slide-"+suffix
	for _, setup := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO "Organization"(id,name,slug,"updatedAt") VALUES($1,'Routes',$2,now())`, []any{orgID, "routes-" + suffix}},
		{`INSERT INTO "User"(id,email,"organizationId","updatedAt") VALUES($1,$2,$3,now()),($4,$5,NULL,now()),($6,$7,NULL,now())`,
			[]any{ownerID, "routes-owner-" + suffix + "@example.com", orgID, otherID, "routes-other-" + suffix + "@example.com",
				viewerID, "routes-viewer-" + suffix + "@example.com"}},
		{`INSERT INTO "Presentation"(id,title,"userId","sourceType","updatedAt") VALUES($1,'Routes',$2,'TEXT',now())`,
			[]any{presentationID, ownerID}},
		{`INSERT INTO "Slide"(id,"presentationId","order",type,content,"updatedAt") VALUES($1,$2,0,'CONTENT','{}'::jsonb,now())`,
			[]any{slideID, presentationID}},
	} {
		if _, err := store.Pool().Exec(ctx, setup.query, setup.args...); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		_, _ = store.Pool().Exec(context.Background(), `DELETE FROM "User" WHERE id=ANY($1)`, []string{ownerID, otherID, viewerID})
		_, _ = store.Pool().Exec(context.Background(), `DELETE FROM "Organization" WHERE id=$1`, orgID)
	})

	sessions, _ := auth.NewSessions("routes-contract-secret", time.Hour)
	authService := auth.NewService(store, sessions)
	router := chi.NewRouter()
	router.Route("/api", func(r chi.Router) { userfeatures.RegisterRoutes(r, store, authService) })
	server := httptest.NewServer(router)
	defer server.Close()
	ownerToken, _ := sessions.Issue(auth.Principal{ID: ownerID, Email: "owner@example.com", Role: "USER"})
	otherToken, _ := sessions.Issue(auth.Principal{ID: otherID, Email: "other@example.com", Role: "USER"})
	viewerToken, _ := sessions.Issue(auth.Principal{ID: viewerID, Email: "viewer@example.com", Role: "USER"})

	block := contractJSON(t, server.Client(), ownerToken, http.MethodPost, server.URL+"/api/slides/"+slideID+"/blocks",
		`{"type":"TEXT","content":{"text":"hello"},"style":{"x":10}}`, http.StatusCreated)
	blockID := block["id"].(string)
	contractJSON(t, server.Client(), otherToken, http.MethodPatch, server.URL+"/api/blocks/"+blockID,
		`{"content":{"text":"stolen"}}`, http.StatusForbidden)
	contractJSON(t, server.Client(), otherToken, http.MethodGet, server.URL+"/api/slides/"+slideID+"/blocks",
		"", http.StatusForbidden)

	invited := contractJSON(t, server.Client(), ownerToken, http.MethodPost,
		server.URL+"/api/presentations/"+presentationID+"/collaborators",
		fmt.Sprintf(`{"email":"routes-other-%s@example.com","role":"EDITOR"}`, suffix), http.StatusCreated)
	if invited["role"] != "EDITOR" {
		t.Fatalf("collaborator role = %#v", invited["role"])
	}
	collaboratorID := invited["id"].(string)
	contractJSON(t, server.Client(), otherToken, http.MethodPatch,
		server.URL+"/api/collaborators/"+collaboratorID, `{"role":"VIEWER"}`, http.StatusForbidden)
	updatedCollaborator := contractJSON(t, server.Client(), ownerToken, http.MethodPatch,
		server.URL+"/api/collaborators/"+collaboratorID, `{"role":"COMMENTER"}`, http.StatusOK)
	if updatedCollaborator["role"] != "COMMENTER" {
		t.Fatalf("updated collaborator role = %#v", updatedCollaborator["role"])
	}
	contractJSON(t, server.Client(), otherToken, http.MethodGet,
		server.URL+"/api/presentations/"+presentationID+"/collaborators", "", http.StatusOK)
	if _, err := store.Pool().Exec(ctx, `UPDATE "Presentation" SET "isPublic"=true WHERE id=$1`, presentationID); err != nil {
		t.Fatal(err)
	}
	publicRoster := contractJSON(t, server.Client(), viewerToken, http.MethodGet,
		server.URL+"/api/presentations/"+presentationID+"/collaborators", "", http.StatusOK)
	publicRaw, _ := json.Marshal(publicRoster)
	for _, secret := range []string{ownerID, otherID, "routes-owner-" + suffix + "@example.com", "routes-other-" + suffix + "@example.com"} {
		if bytes.Contains(publicRaw, []byte(secret)) {
			t.Fatalf("public collaborator roster leaked %q: %s", secret, publicRaw)
		}
	}
	if _, err := store.Pool().Exec(ctx, `UPDATE "Presentation" SET "isPublic"=false WHERE id=$1`, presentationID); err != nil {
		t.Fatal(err)
	}

	favorite := contractJSON(t, server.Client(), ownerToken, http.MethodPost, server.URL+"/api/favorites",
		`{"resourceType":"template","resourceId":"template-1"}`, http.StatusCreated)
	contractJSON(t, server.Client(), otherToken, http.MethodDelete,
		server.URL+"/api/favorites/"+favorite["id"].(string), "", http.StatusNotFound)

	contractJSON(t, server.Client(), ownerToken, http.MethodPost, server.URL+"/api/export-presets",
		`{"name":"First","format":"pptx","isDefault":true}`, http.StatusCreated)
	second := contractJSON(t, server.Client(), ownerToken, http.MethodPost, server.URL+"/api/export-presets",
		`{"name":"Second","format":"pptx","isDefault":true}`, http.StatusCreated)
	defaultPreset := contractJSON(t, server.Client(), ownerToken, http.MethodGet,
		server.URL+"/api/export-presets/default?format=pptx", "", http.StatusOK)
	if defaultPreset["id"] != second["id"] {
		t.Fatalf("default preset = %#v, want %#v", defaultPreset["id"], second["id"])
	}

	contractJSON(t, server.Client(), ownerToken, http.MethodPost, server.URL+"/api/input-prompts",
		`{"text":"weekly report","category":"report"}`, http.StatusCreated)
	recentPrompts := contractJSONArray(t, server.Client(), ownerToken, http.MethodGet,
		server.URL+"/api/input-prompts/recent?limit=1", "", http.StatusOK)
	if len(recentPrompts) != 1 || recentPrompts[0]["content"] != "weekly report" {
		t.Fatalf("recent prompts = %#v", recentPrompts)
	}
	contractJSON(t, server.Client(), otherToken, http.MethodPost,
		server.URL+"/api/recent-works/"+presentationID, "", http.StatusCreated)
	contractJSON(t, server.Client(), ownerToken, http.MethodDelete,
		server.URL+"/api/collaborators/"+collaboratorID, "", http.StatusOK)
	if recent := contractJSONArray(t, server.Client(), otherToken, http.MethodGet,
		server.URL+"/api/recent-works", "", http.StatusOK); len(recent) != 0 {
		t.Fatalf("revoked recent work remained visible: %#v", recent)
	}
	var recentCount int
	if err := store.Pool().QueryRow(ctx, `SELECT COUNT(*) FROM "RecentWork" WHERE "userId"=$1`, otherID).Scan(&recentCount); err != nil {
		t.Fatal(err)
	}
	if recentCount != 0 {
		t.Fatalf("revoked recent work rows = %d, want 0", recentCount)
	}
	contractJSON(t, server.Client(), ownerToken, http.MethodPost,
		server.URL+"/api/organizations/"+orgID+"/color-palettes",
		`{"name":"Brand","colors":["#112233"],"isDefault":true}`, http.StatusCreated)
	contractJSON(t, server.Client(), otherToken, http.MethodGet,
		server.URL+"/api/organizations/"+orgID+"/color-palettes", "", http.StatusForbidden)
	contractJSON(t, server.Client(), ownerToken, http.MethodPost,
		server.URL+"/api/organizations/"+orgID+"/font-sets",
		`{"name":"Korean","headingFont":"HY헤드라인M","bodyFont":"나눔고딕"}`, http.StatusCreated)

	t.Run("concurrent automatic order and default allocation", func(t *testing.T) {
		const parallel = 16
		runConcurrentRequests := func(target string, bodies []string) {
			t.Helper()
			start := make(chan struct{})
			results := make(chan error, len(bodies))
			for _, body := range bodies {
				go func(body string) {
					<-start
					request, _ := http.NewRequest(http.MethodPost, target, strings.NewReader(body))
					request.Header.Set("Content-Type", "application/json")
					request.AddCookie(&http.Cookie{Name: "jaslide_session", Value: ownerToken})
					response, err := server.Client().Do(request)
					if err == nil {
						raw, readErr := io.ReadAll(response.Body)
						response.Body.Close()
						if readErr != nil {
							err = readErr
						} else if response.StatusCode != http.StatusCreated {
							err = fmt.Errorf("status %d: %s", response.StatusCode, raw)
						}
					}
					results <- err
				}(body)
			}
			close(start)
			for range bodies {
				if err := <-results; err != nil {
					t.Fatal(err)
				}
			}
		}

		blockBodies := make([]string, parallel)
		favoriteBodies := make([]string, parallel)
		presetBodies := make([]string, parallel)
		for index := 0; index < parallel; index++ {
			blockBodies[index] = `{"type":"TEXT","content":{"text":"parallel"}}`
			favoriteBodies[index] = fmt.Sprintf(`{"resourceType":"template","resourceId":"parallel-%d"}`, index)
			presetBodies[index] = fmt.Sprintf(`{"name":"Parallel %d","format":"pdf","isDefault":true}`, index)
		}
		runConcurrentRequests(server.URL+"/api/slides/"+slideID+"/blocks", blockBodies)
		assertUniqueOrders(t, store, `"Block"`, `"slideId"`, slideID)
		runConcurrentRequests(server.URL+"/api/favorites", favoriteBodies)
		assertUniqueOrders(t, store, `"Favorite"`, `"userId"`, ownerID)
		runConcurrentRequests(server.URL+"/api/export-presets", presetBodies)
		var defaults int
		if err := store.Pool().QueryRow(ctx, `
			SELECT COUNT(*) FROM "ExportPreset" WHERE "userId"=$1 AND format='pdf' AND "isDefault"`, ownerID).Scan(&defaults); err != nil {
			t.Fatal(err)
		}
		if defaults != 1 {
			t.Fatalf("concurrent default presets = %d, want 1", defaults)
		}

		start := make(chan struct{})
		slideErrors := make(chan error, parallel)
		for index := 0; index < parallel; index++ {
			go func(index int) {
				<-start
				_, err := store.CreateSlide(ctx, db.SlideCreate{
					ID: fmt.Sprintf("parallel-slide-%s-%d", suffix, index), PresentationID: presentationID,
					Type: "CONTENT", Content: json.RawMessage(`{}`), Layout: "center",
				})
				slideErrors <- err
			}(index)
		}
		close(start)
		for index := 0; index < parallel; index++ {
			if err := <-slideErrors; err != nil {
				t.Fatal(err)
			}
		}
		assertUniqueOrders(t, store, `"Slide"`, `"presentationId"`, presentationID)
	})
}

func assertUniqueOrders(t *testing.T, store *db.Store, table, parentColumn, parentID string) {
	t.Helper()
	var rows, orders int
	query := `SELECT COUNT(*),COUNT(DISTINCT "order") FROM ` + table + ` WHERE ` + parentColumn + `=$1`
	if err := store.Pool().QueryRow(context.Background(), query, parentID).Scan(&rows, &orders); err != nil {
		t.Fatal(err)
	}
	if rows != orders {
		t.Fatalf("%s rows = %d, distinct orders = %d", table, rows, orders)
	}
}

func contractJSON(t *testing.T, client *http.Client, token, method, target, body string, want int) map[string]any {
	t.Helper()
	response := contractRequest(t, client, token, method, target, body, want)
	defer response.Body.Close()
	var value map[string]any
	if err := json.NewDecoder(response.Body).Decode(&value); err != nil {
		t.Fatalf("%s %s response: %v", method, target, err)
	}
	return value
}

func contractJSONArray(t *testing.T, client *http.Client, token, method, target, body string, want int) []map[string]any {
	t.Helper()
	response := contractRequest(t, client, token, method, target, body, want)
	defer response.Body.Close()
	var value []map[string]any
	if err := json.NewDecoder(response.Body).Decode(&value); err != nil {
		t.Fatalf("%s %s response: %v", method, target, err)
	}
	return value
}

func contractRequest(t *testing.T, client *http.Client, token, method, target, body string, want int) *http.Response {
	t.Helper()
	request, _ := http.NewRequest(method, target, bytes.NewBufferString(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	request.AddCookie(&http.Cookie{Name: "jaslide_session", Value: token})
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != want {
		raw, _ := io.ReadAll(response.Body)
		response.Body.Close()
		t.Fatalf("%s %s status = %d, want %d; body=%s", method, target, response.StatusCode, want, strings.TrimSpace(string(raw)))
	}
	return response
}
