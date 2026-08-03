package skills

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/auth"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/config"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
)

func TestScopeColumnsMapsEachScopeToItsColumns(t *testing.T) {
	orgID := "org-1"

	isPublic, organizationID, err := scopeColumns("private", &orgID)
	if err != nil || isPublic || organizationID != nil {
		t.Fatalf("private = %v, %v, %v; want false, nil, nil", isPublic, organizationID, err)
	}

	isPublic, organizationID, err = scopeColumns("organization", &orgID)
	if err != nil || isPublic || organizationID == nil || *organizationID != orgID {
		t.Fatalf("organization = %v, %v, %v; want false, %q, nil", isPublic, organizationID, err, orgID)
	}

	isPublic, organizationID, err = scopeColumns("organization", nil)
	if err == nil {
		t.Fatal("organization with no user org = nil error, want an error")
	}

	isPublic, organizationID, err = scopeColumns("public", &orgID)
	if err != nil || !isPublic || organizationID != nil {
		t.Fatalf("public = %v, %v, %v; want true, nil, nil", isPublic, organizationID, err)
	}

	if _, _, err := scopeColumns("bogus", &orgID); err == nil {
		t.Fatal("bogus scope = nil error, want an error")
	}
}

func TestUpdateRenamesAndChangesScopeCascadingToTemplate(t *testing.T) {
	store, authService, sessions := newTestStore(t)
	ctx := context.Background()
	suffix := fmt.Sprint(time.Now().UnixNano())

	ownerID := createTestUser(t, ctx, store, "owner-"+suffix, "owner-"+suffix+"@example.com", nil)
	otherID := createTestUser(t, ctx, store, "other-"+suffix, "other-"+suffix+"@example.com", nil)
	orgID := createTestOrg(t, ctx, store, "org-"+suffix)
	orgUserID := createTestUser(t, ctx, store, "orguser-"+suffix, "orguser-"+suffix+"@example.com", &orgID)

	templateID, skillID := createTestSkillWithTemplate(t, ctx, store, "tpl-"+suffix, "skill-"+suffix, ownerID, nil)

	router := chi.NewRouter()
	router.Mount("/api/skills", NewHandlers(store, nil, "", authService))
	server := httptest.NewServer(router)
	defer server.Close()
	client := server.Client()

	ownerToken := issueTestToken(t, sessions, ownerID, "owner-"+suffix+"@example.com")
	otherToken := issueTestToken(t, sessions, otherID, "other-"+suffix+"@example.com")
	orgUserToken := issueTestToken(t, sessions, orgUserID, "orguser-"+suffix+"@example.com")

	// A non-owner cannot rename or re-scope another user's skill.
	requestJSON(t, client, otherToken, http.MethodPatch, server.URL+"/api/skills/"+skillID,
		`{"name":"Hijacked"}`, http.StatusNotFound)

	// Empty name is rejected.
	requestJSON(t, client, ownerToken, http.MethodPatch, server.URL+"/api/skills/"+skillID,
		`{"name":"  "}`, http.StatusBadRequest)

	// An organization-less owner cannot pick the "organization" scope.
	requestJSON(t, client, ownerToken, http.MethodPatch, server.URL+"/api/skills/"+skillID,
		`{"scope":"organization"}`, http.StatusBadRequest)

	// Rename + go public, in one call, cascades to the linked Template.
	updated := requestJSON(t, client, ownerToken, http.MethodPatch, server.URL+"/api/skills/"+skillID,
		`{"name":"Renamed Skill","scope":"public"}`, http.StatusOK)
	if updated["name"] != "Renamed Skill" || updated["isPublic"] != true {
		t.Fatalf("updated skill = %#v", updated)
	}
	var templateName string
	var templateIsPublic bool
	if err := store.Pool().QueryRow(ctx,
		`SELECT "name","isPublic" FROM "Template" WHERE "id"=$1`, templateID,
	).Scan(&templateName, &templateIsPublic); err != nil {
		t.Fatal(err)
	}
	if templateName != "Renamed Skill" || !templateIsPublic {
		t.Fatalf("template after cascade = %q, %v; want Renamed Skill, true", templateName, templateIsPublic)
	}

	// An org member with an organization can use the "organization" scope.
	_, orgSkillID := createTestSkillWithTemplate(t, ctx, store, "orgtpl-"+suffix, "orgskill-"+suffix, orgUserID, &orgID)
	orgUpdated := requestJSON(t, client, orgUserToken, http.MethodPatch, server.URL+"/api/skills/"+orgSkillID,
		`{"scope":"organization"}`, http.StatusOK)
	if orgUpdated["organizationId"] != orgID || orgUpdated["isPublic"] != false {
		t.Fatalf("org-scoped skill = %#v", orgUpdated)
	}
}

func newTestStore(t *testing.T) (*db.Store, *auth.Service, *auth.Sessions) {
	t.Helper()
	databaseURL := os.Getenv("JASLIDE_TEST_DATABASE_URL")
	redisURL := os.Getenv("JASLIDE_TEST_REDIS_URL")
	if databaseURL == "" || redisURL == "" {
		t.Skip("set JASLIDE_TEST_DATABASE_URL and JASLIDE_TEST_REDIS_URL to run integration test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	store, err := db.Open(ctx, config.Config{DatabaseURL: databaseURL, RedisURL: redisURL})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	sessions, err := auth.NewSessions("skills-handlers-test-secret", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	return store, auth.NewService(store, sessions), sessions
}

func createTestUser(t *testing.T, ctx context.Context, store *db.Store, id, email string, organizationID *string) string {
	t.Helper()
	if _, err := store.Pool().Exec(ctx,
		`INSERT INTO "User" (id,email,role,"organizationId","updatedAt") VALUES ($1,$2,'USER',$3,NOW())`,
		id, email, organizationID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = store.Pool().Exec(context.Background(), `DELETE FROM "User" WHERE id=$1`, id)
	})
	return id
}

func createTestOrg(t *testing.T, ctx context.Context, store *db.Store, id string) string {
	t.Helper()
	if _, err := store.Pool().Exec(ctx,
		`INSERT INTO "Organization" (id,name,slug,"updatedAt") VALUES ($1,$1,$1,NOW())`, id); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = store.Pool().Exec(context.Background(), `DELETE FROM "Organization" WHERE id=$1`, id)
	})
	return id
}

func createTestSkillWithTemplate(
	t *testing.T, ctx context.Context, store *db.Store, templateID, skillID, userID string, organizationID *string,
) (string, string) {
	t.Helper()
	if _, err := store.Pool().Exec(ctx, `
		INSERT INTO "Template" (id,name,category,config,"isPublic","userId","organizationId","updatedAt")
		VALUES ($1,$1,'BUSINESS','{"htmlSlides":["<html><body>Hello</body></html>"]}'::jsonb,FALSE,$2,$3,NOW())`,
		templateID, userID, organizationID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = store.Pool().Exec(context.Background(), `DELETE FROM "Template" WHERE id=$1`, templateID)
	})
	if _, err := store.Pool().Exec(ctx, `
		INSERT INTO "PresentationSkill"
			(id,name,category,audience,tone,purpose,"outlineGuidance","recommendedSlideCount",
			 "userId","organizationId","templateId","updatedAt")
		VALUES ($1,$1,'CUSTOM','General','Clear','Test',$2,10,$3,$4,$5,NOW())`,
		skillID, "test guidance", userID, organizationID, templateID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = store.Pool().Exec(context.Background(), `DELETE FROM "PresentationSkill" WHERE id=$1`, skillID)
	})
	return templateID, skillID
}

func issueTestToken(t *testing.T, sessions *auth.Sessions, userID, email string) string {
	t.Helper()
	token, err := sessions.Issue(auth.Principal{ID: userID, Email: email, Role: "USER"})
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func requestJSON(t *testing.T, client *http.Client, token, method, target, body string, want int) map[string]any {
	t.Helper()
	req, err := http.NewRequest(method, target, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.AddCookie(&http.Cookie{Name: "jaslide_session", Value: token})
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	response, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != want {
		data, _ := io.ReadAll(response.Body)
		t.Fatalf("%s %s = %d %s, want %d", method, target, response.StatusCode, data, want)
	}
	var value map[string]any
	if response.ContentLength == 0 {
		return value
	}
	if err := json.NewDecoder(response.Body).Decode(&value); err != nil {
		t.Fatal(err)
	}
	return value
}

func TestDeleteRemovesSkillAndCascadesToTemplateLeavingPresentationsIntact(t *testing.T) {
	store, authService, sessions := newTestStore(t)
	ctx := context.Background()
	suffix := fmt.Sprint(time.Now().UnixNano())

	ownerID := createTestUser(t, ctx, store, "del-owner-"+suffix, "del-owner-"+suffix+"@example.com", nil)
	otherID := createTestUser(t, ctx, store, "del-other-"+suffix, "del-other-"+suffix+"@example.com", nil)
	templateID, skillID := createTestSkillWithTemplate(t, ctx, store, "del-tpl-"+suffix, "del-skill-"+suffix, ownerID, nil)

	presentationID := "del-pres-" + suffix
	if _, err := store.Pool().Exec(ctx, `
		INSERT INTO "Presentation" (id,title,"userId","templateId","sourceType","updatedAt")
		VALUES ($1,'Uses the template',$2,$3,'TEXT',NOW())`,
		presentationID, ownerID, templateID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = store.Pool().Exec(context.Background(), `DELETE FROM "Presentation" WHERE id=$1`, presentationID)
	})

	router := chi.NewRouter()
	router.Mount("/api/skills", NewHandlers(store, nil, "", authService))
	server := httptest.NewServer(router)
	defer server.Close()
	client := server.Client()

	otherToken := issueTestToken(t, sessions, otherID, "del-other-"+suffix+"@example.com")
	ownerToken := issueTestToken(t, sessions, ownerID, "del-owner-"+suffix+"@example.com")

	requestJSON(t, client, otherToken, http.MethodDelete, server.URL+"/api/skills/"+skillID, "", http.StatusNotFound)
	requestJSON(t, client, ownerToken, http.MethodDelete, server.URL+"/api/skills/"+skillID, "", http.StatusOK)

	var skillCount, templateCount int
	if err := store.Pool().QueryRow(ctx, `SELECT COUNT(*) FROM "PresentationSkill" WHERE id=$1`, skillID).Scan(&skillCount); err != nil {
		t.Fatal(err)
	}
	if err := store.Pool().QueryRow(ctx, `SELECT COUNT(*) FROM "Template" WHERE id=$1`, templateID).Scan(&templateCount); err != nil {
		t.Fatal(err)
	}
	if skillCount != 0 || templateCount != 0 {
		t.Fatalf("after delete: skillCount=%d templateCount=%d, want 0, 0", skillCount, templateCount)
	}
	var presentationTemplateID *string
	if err := store.Pool().QueryRow(ctx, `SELECT "templateId" FROM "Presentation" WHERE id=$1`, presentationID).Scan(&presentationTemplateID); err != nil {
		t.Fatal(err)
	}
	if presentationTemplateID != nil {
		t.Fatalf("presentation templateId after delete = %v, want nil (SET NULL)", *presentationTemplateID)
	}
}

func TestPreviewHTMLReturnsTheTemplatesFirstSlideOnlyWhenVisible(t *testing.T) {
	store, authService, sessions := newTestStore(t)
	ctx := context.Background()
	suffix := fmt.Sprint(time.Now().UnixNano())

	ownerID := createTestUser(t, ctx, store, "pv-owner-"+suffix, "pv-owner-"+suffix+"@example.com", nil)
	strangerID := createTestUser(t, ctx, store, "pv-stranger-"+suffix, "pv-stranger-"+suffix+"@example.com", nil)
	_, skillID := createTestSkillWithTemplate(t, ctx, store, "pv-tpl-"+suffix, "pv-skill-"+suffix, ownerID, nil)

	router := chi.NewRouter()
	router.Mount("/api/skills", NewHandlers(store, nil, "", authService))
	server := httptest.NewServer(router)
	defer server.Close()
	client := server.Client()

	ownerToken := issueTestToken(t, sessions, ownerID, "pv-owner-"+suffix+"@example.com")
	strangerToken := issueTestToken(t, sessions, strangerID, "pv-stranger-"+suffix+"@example.com")

	// A stranger cannot preview a private skill's template.
	requestJSON(t, client, strangerToken, http.MethodGet, server.URL+"/api/skills/"+skillID+"/preview-html", "", http.StatusNotFound)

	// The owner gets the first extracted slide.
	preview := requestJSON(t, client, ownerToken, http.MethodGet, server.URL+"/api/skills/"+skillID+"/preview-html", "", http.StatusOK)
	if preview["html"] != "<html><body>Hello</body></html>" {
		t.Fatalf("preview html = %#v", preview["html"])
	}

	// Once public, a stranger can preview it too.
	requestJSON(t, client, ownerToken, http.MethodPatch, server.URL+"/api/skills/"+skillID, `{"scope":"public"}`, http.StatusOK)
	strangerPreview := requestJSON(t, client, strangerToken, http.MethodGet, server.URL+"/api/skills/"+skillID+"/preview-html", "", http.StatusOK)
	if strangerPreview["html"] != "<html><body>Hello</body></html>" {
		t.Fatalf("stranger preview html after going public = %#v", strangerPreview["html"])
	}
}
