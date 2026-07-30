package db

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/spsp4755/JaSlide/apps/core-api/internal/config"
)

func TestKeycloakSettingsRoundTripsAndDefaultsToZeroValue(t *testing.T) {
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
	t.Cleanup(func() {
		_, _ = store.Pool().Exec(context.Background(), `DELETE FROM "KeycloakSetting" WHERE id='default'`)
	})
	if _, err := store.Pool().Exec(ctx, `DELETE FROM "KeycloakSetting" WHERE id='default'`); err != nil {
		t.Fatal(err)
	}

	before, err := store.GetKeycloakSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if before != (KeycloakSettings{}) {
		t.Fatalf("GetKeycloakSettings() before any save = %#v, want zero value", before)
	}

	saved := KeycloakSettings{
		Issuer: "https://keycloak.example/realms/company", ClientID: "jaslide-web",
		ClientSecret: "s3cr3t", RedirectURI: "https://jaslide.example/api/auth/keycloak/callback",
		AdminRoles: "jaslide-admin,jaslide-owner",
	}
	if err := store.SaveKeycloakSettings(ctx, saved); err != nil {
		t.Fatal(err)
	}
	after, err := store.GetKeycloakSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if after != saved {
		t.Fatalf("GetKeycloakSettings() after save = %#v, want %#v", after, saved)
	}

	saved.ClientSecret = "rotated-secret"
	if err := store.SaveKeycloakSettings(ctx, saved); err != nil {
		t.Fatal(err)
	}
	updated, err := store.GetKeycloakSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if updated.ClientSecret != "rotated-secret" {
		t.Fatalf("ClientSecret after re-save = %q, want rotated-secret (upsert must update, not duplicate)", updated.ClientSecret)
	}
}
