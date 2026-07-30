package db

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/spsp4755/JaSlide/apps/core-api/internal/config"
)

func TestPostgresURLConvertsPrismaSchemaToSearchPath(t *testing.T) {
	converted, err := postgresConnectionURL("postgresql://jaslide:secret@localhost:5432/jaslide?schema=tenant_a&sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}

	parsed, err := url.Parse(converted)
	if err != nil {
		t.Fatal(err)
	}
	if got := parsed.Query().Get("schema"); got != "" {
		t.Fatalf("schema query = %q, want removed", got)
	}
	if got := parsed.Query().Get("search_path"); got != "tenant_a" {
		t.Fatalf("search_path query = %q, want tenant_a", got)
	}
	if got := parsed.Query().Get("sslmode"); got != "disable" {
		t.Fatalf("sslmode query = %q, want preserved", got)
	}
}

func TestStoreReadsCurrentPrismaTables(t *testing.T) {
	databaseURL := os.Getenv("JASLIDE_TEST_DATABASE_URL")
	redisURL := os.Getenv("JASLIDE_TEST_REDIS_URL")
	if databaseURL == "" || redisURL == "" {
		t.Skip("set JASLIDE_TEST_DATABASE_URL and JASLIDE_TEST_REDIS_URL to run integration test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	store, err := Open(ctx, config.Config{DatabaseURL: databaseURL, RedisURL: redisURL})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	suffix := time.Now().UnixNano()
	userID := fmt.Sprintf("go-test-user-%d", suffix)
	otherUserID := fmt.Sprintf("go-test-other-user-%d", suffix)
	email := fmt.Sprintf("go-test-%d@example.com", suffix)
	olderID := fmt.Sprintf("go-test-presentation-old-%d", suffix)
	newerID := fmt.Sprintf("go-test-presentation-new-%d", suffix)
	otherID := fmt.Sprintf("go-test-presentation-other-%d", suffix)

	for _, row := range []struct {
		id, email, name string
	}{
		{userID, email, "Go Reader"},
		{otherUserID, fmt.Sprintf("go-test-other-%d@example.com", suffix), "Other User"},
	} {
		if _, err := store.pool.Exec(ctx, `
			INSERT INTO "User" ("id", "email", "name", "updatedAt")
			VALUES ($1, $2, $3, NOW())`, row.id, row.email, row.name); err != nil {
			t.Fatal(err)
		}
		registerRowCleanup(t, store, `DELETE FROM "User" WHERE "id" = $1`, row.id)
	}

	for _, row := range []struct {
		id, title, userID string
		updatedAt         time.Time
	}{
		{olderID, "Older deck", userID, time.Date(2026, 7, 28, 9, 0, 0, 0, time.UTC)},
		{newerID, "Newer deck", userID, time.Date(2026, 7, 29, 9, 0, 0, 0, time.UTC)},
		{otherID, "Other deck", otherUserID, time.Date(2026, 7, 30, 9, 0, 0, 0, time.UTC)},
	} {
		if _, err := store.pool.Exec(ctx, `
			INSERT INTO "Presentation"
				("id", "title", "userId", "sourceType", "createdAt", "updatedAt")
			VALUES ($1, $2, $3, 'TEXT', $4, $4)`,
			row.id, row.title, row.userID, row.updatedAt); err != nil {
			t.Fatal(err)
		}
		registerRowCleanup(t, store, `DELETE FROM "Presentation" WHERE "id" = $1`, row.id)
	}

	if err := store.Ready(); err != nil {
		t.Fatalf("Ready() error = %v", err)
	}
	var searchPath string
	if err := store.pool.QueryRow(ctx, `SHOW search_path`).Scan(&searchPath); err != nil {
		t.Fatal(err)
	}
	if searchPath != "public" {
		t.Fatalf("search_path = %q, want public from Prisma schema query", searchPath)
	}

	byEmail, err := store.FindUserByEmail(ctx, email)
	if err != nil {
		t.Fatal(err)
	}
	if byEmail.ID != userID || byEmail.Name == nil || *byEmail.Name != "Go Reader" {
		t.Fatalf("FindUserByEmail() = %#v", byEmail)
	}

	byID, err := store.FindUserByID(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	if byID.Email != email || byID.Role != "USER" || byID.Status != "ACTIVE" {
		t.Fatalf("FindUserByID() = %#v", byID)
	}
	if err := store.RecordFailedLogin(ctx, userID, time.Now().Add(15*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if updated, err := store.RecordSuccessfulLogin(ctx, userID, 1, time.Now()); err != nil || !updated {
		t.Fatal(err)
	}
	if err := store.RecordLoginAttempt(ctx, email, true, &userID, "127.0.0.1", "go-test", ""); err != nil {
		t.Fatal(err)
	}
	registerRowCleanup(t, store, `DELETE FROM "LoginLog" WHERE "email" = $1`, email)

	if _, err := store.pool.Exec(ctx, `
		UPDATE "User" SET "failedLoginAttempts" = 4, "lockedUntil" = NULL WHERE "id" = $1`, userID); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordFailedLogin(ctx, userID, time.Now().Add(15*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if updated, err := store.RecordSuccessfulLogin(ctx, userID, 4, time.Now()); err != nil || updated {
		t.Fatalf("concurrent successful login update = %v, %v; want false, nil", updated, err)
	}
	lockedUser, err := store.FindUserByID(ctx, userID)
	if err != nil || lockedUser.FailedLoginAttempts != 5 || lockedUser.LockedUntil == nil {
		t.Fatalf("concurrent lockout user = %#v, %v", lockedUser, err)
	}

	keycloakEmail := fmt.Sprintf("go-keycloak-%d@example.com", suffix)
	keycloakUser, err := store.ResolveKeycloakUser(
		ctx, "https://keycloak.example/realms/company", "subject-123",
		keycloakEmail, nil, nil, "ADMIN",
	)
	if err != nil {
		t.Fatal(err)
	}
	registerRowCleanup(t, store, `DELETE FROM "User" WHERE "id" = $1`, keycloakUser.ID)
	if keycloakUser.Email != keycloakEmail || keycloakUser.Role != "ADMIN" {
		t.Fatalf("ResolveKeycloakUser() = %#v", keycloakUser)
	}
	linkedAgain, err := store.ResolveKeycloakUser(
		ctx, "https://keycloak.example/realms/company", "subject-123",
		keycloakEmail, nil, nil, "USER",
	)
	if err != nil || linkedAgain.ID != keycloakUser.ID || linkedAgain.Role != "USER" {
		t.Fatalf("linked ResolveKeycloakUser() = %#v, %v", linkedAgain, err)
	}
	promotedAgain, err := store.ResolveKeycloakUser(
		ctx, "https://keycloak.example/realms/company", "subject-123",
		keycloakEmail, nil, nil, "ADMIN",
	)
	if err != nil || promotedAgain.ID != keycloakUser.ID || promotedAgain.Role != "ADMIN" {
		t.Fatalf("promoted ResolveKeycloakUser() = %#v, %v", promotedAgain, err)
	}
	if _, err := store.pool.Exec(ctx, `
		UPDATE "User" SET "role" = 'ORG_ADMIN' WHERE "id" = $1`, keycloakUser.ID); err != nil {
		t.Fatal(err)
	}
	preservedRole, err := store.ResolveKeycloakUser(
		ctx, "https://keycloak.example/realms/company", "subject-123",
		keycloakEmail, nil, nil, "USER",
	)
	if err != nil || preservedRole.Role != "ORG_ADMIN" {
		t.Fatalf("preserved ResolveKeycloakUser() = %#v, %v", preservedRole, err)
	}

	localEmail := fmt.Sprintf("go-register-%d@example.com", suffix)
	passwordHash := "$2a$10$RK29UA5QXRUEuLcP1OcN.eKIcGTrTVE1w.g1RkIskCMZxRTq7iNf."
	localUser, err := store.CreateLocalUser(ctx, localEmail, nil, passwordHash)
	if err != nil {
		t.Fatal(err)
	}
	registerRowCleanup(t, store, `DELETE FROM "User" WHERE "id" = $1`, localUser.ID)
	if localUser.Email != localEmail || localUser.Password == nil || *localUser.Password != passwordHash {
		t.Fatalf("CreateLocalUser() = %#v", localUser)
	}
	if _, err := store.CreateLocalUser(ctx, localEmail, nil, passwordHash); !errors.Is(err, ErrUserExists) {
		t.Fatalf("duplicate CreateLocalUser() error = %v", err)
	}

	page, err := store.ListPresentations(ctx, userID, 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 2 || page.Page != 1 || page.Limit != 1 || page.TotalPages != 2 {
		t.Fatalf("ListPresentations() page = %#v", page)
	}
	if len(page.Data) != 1 || page.Data[0].ID != newerID {
		t.Fatalf("ListPresentations() data = %#v", page.Data)
	}

	presentation, err := store.GetPresentation(ctx, olderID)
	if err != nil {
		t.Fatal(err)
	}
	if presentation.UserID != userID || presentation.Title != "Older deck" || presentation.SourceType != "TEXT" {
		t.Fatalf("GetPresentation() = %#v", presentation)
	}
}

func registerRowCleanup(t *testing.T, store *Store, query, id string) {
	t.Helper()
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if _, err := store.pool.Exec(ctx, query, id); err != nil {
			t.Errorf("cleanup %s: %v", id, err)
		}
	})
}
