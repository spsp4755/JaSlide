package admin_test

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
	"github.com/spsp4755/JaSlide/apps/core-api/internal/admin"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/auth"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/config"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
)

// The admin console needs to create, edit and deactivate user accounts the same
// way the retired NestJS AdminUsersController did.
func TestAdminCanCreateUpdateAndDeactivateUsers(t *testing.T) {
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

	suffix := fmt.Sprint(time.Now().UnixNano())
	adminID := "go-admin-" + suffix
	adminEmail := "admin-" + suffix + "@example.com"
	if _, err := store.Pool().Exec(ctx,
		`INSERT INTO "User" (id,email,role,"updatedAt") VALUES ($1,$2,'SYSTEM_ADMIN',NOW())`, adminID, adminEmail); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = store.Pool().Exec(context.Background(), `DELETE FROM "User" WHERE id=$1`, adminID)
	})
	sessions, err := auth.NewSessions("admin-users-test-secret", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	authService := auth.NewService(store, sessions)
	adminToken, err := sessions.Issue(auth.Principal{ID: adminID, Email: adminEmail, Role: "SYSTEM_ADMIN"})
	if err != nil {
		t.Fatal(err)
	}

	router := chi.NewRouter()
	router.Mount("/api/admin", admin.NewHandlers(store, authService, nil, "", nil, nil))
	server := httptest.NewServer(router)
	defer server.Close()
	client := server.Client()

	email := "created-" + suffix + "@example.com"
	created := requestJSON(t, client, adminToken, http.MethodPost, server.URL+"/api/admin/users",
		`{"email":"`+email+`","password":"Sup3rSecret!","name":"Created User"}`, http.StatusCreated)
	userID, _ := created["id"].(string)
	if userID == "" {
		t.Fatalf("created user id = %#v", created["id"])
	}
	t.Cleanup(func() {
		_, _ = store.Pool().Exec(context.Background(), `DELETE FROM "User" WHERE id=$1`, userID)
	})
	if created["role"] != "USER" {
		t.Fatalf("default role = %#v, want USER", created["role"])
	}

	dup := requestJSON(t, client, adminToken, http.MethodPost, server.URL+"/api/admin/users",
		`{"email":"`+email+`"}`, http.StatusBadRequest)
	if dup["message"] != "Email already exists" {
		t.Fatalf("duplicate email message = %#v", dup["message"])
	}

	var storedHash *string
	if err := store.Pool().QueryRow(ctx, `SELECT password FROM "User" WHERE id=$1`, userID).Scan(&storedHash); err != nil {
		t.Fatal(err)
	}
	if storedHash == nil || *storedHash == "Sup3rSecret!" {
		t.Fatalf("password stored in plaintext: %#v", storedHash)
	}

	updated := requestJSON(t, client, adminToken, http.MethodPatch, server.URL+"/api/admin/users/"+userID,
		`{"role":"ADMIN","status":"SUSPENDED"}`, http.StatusOK)
	if updated["role"] != "ADMIN" || updated["status"] != "SUSPENDED" {
		t.Fatalf("updated user = %#v", updated)
	}
	if updated["email"] != email {
		t.Fatalf("update changed untouched email to %#v", updated["email"])
	}

	deactivated := requestJSON(t, client, adminToken, http.MethodDelete, server.URL+"/api/admin/users/"+userID, "", http.StatusOK)
	if deactivated["success"] != true {
		t.Fatalf("deactivate response = %#v", deactivated)
	}
	var status string
	if err := store.Pool().QueryRow(ctx, `SELECT status FROM "User" WHERE id=$1`, userID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "INACTIVE" {
		t.Fatalf("status after delete = %q, want INACTIVE (soft delete, row must still exist)", status)
	}

	requestJSON(t, client, adminToken, http.MethodDelete, server.URL+"/api/admin/users/does-not-exist", "", http.StatusNotFound)
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
		t.Fatalf("%s %s response: %v", method, target, err)
	}
	return value
}
