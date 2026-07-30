package db

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/spsp4755/JaSlide/apps/core-api/internal/config"
)

func TestStoreReadsCurrentPrismaTables(t *testing.T) {
	databaseURL := os.Getenv("JASLIDE_TEST_DATABASE_URL")
	redisURL := os.Getenv("JASLIDE_TEST_REDIS_URL")
	if databaseURL == "" || redisURL == "" {
		t.Skip("set JASLIDE_TEST_DATABASE_URL and JASLIDE_TEST_REDIS_URL to run integration test")
	}

	ctx := context.Background()
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
	}
	t.Cleanup(func() {
		_, _ = store.pool.Exec(context.Background(), `DELETE FROM "Presentation" WHERE "id" = ANY($1)`, []string{olderID, newerID, otherID})
		_, _ = store.pool.Exec(context.Background(), `DELETE FROM "User" WHERE "id" = ANY($1)`, []string{userID, otherUserID})
	})

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
	}

	if err := store.Ready(); err != nil {
		t.Fatalf("Ready() error = %v", err)
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
