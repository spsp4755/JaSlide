package admin_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/admin"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/auth"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/config"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
)

// An admin editing SSO settings through the UI must take effect immediately
// (no restart) and must never leak the stored client secret back out.
func TestAdminKeycloakSettingsRoundTripAndHotSwap(t *testing.T) {
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
	if _, err := store.Pool().Exec(ctx, `DELETE FROM "KeycloakSetting" WHERE id='default'`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = store.Pool().Exec(context.Background(), `DELETE FROM "KeycloakSetting" WHERE id='default'`)
	})

	suffix := fmt.Sprint(time.Now().UnixNano())
	adminID := "go-admin-kc-" + suffix
	adminEmail := "admin-kc-" + suffix + "@example.com"
	if _, err := store.Pool().Exec(ctx,
		`INSERT INTO "User" (id,email,role,"updatedAt") VALUES ($1,$2,'SYSTEM_ADMIN',NOW())`, adminID, adminEmail); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = store.Pool().Exec(context.Background(), `DELETE FROM "User" WHERE id=$1`, adminID)
	})
	sessions, err := auth.NewSessions("admin-keycloak-test-secret", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	authService := auth.NewService(store, sessions)
	adminToken, err := sessions.Issue(auth.Principal{ID: adminID, Email: adminEmail, Role: "SYSTEM_ADMIN"})
	if err != nil {
		t.Fatal(err)
	}

	registry := auth.NewKeycloakRegistry(nil, nil)
	router := chi.NewRouter()
	router.Mount("/api/admin", admin.NewHandlers(store, authService, nil, "", nil, nil, registry))
	server := httptest.NewServer(router)
	defer server.Close()
	client := server.Client()

	settingsURL := server.URL + "/api/admin/settings/keycloak"

	initial := requestJSON(t, client, adminToken, http.MethodGet, settingsURL, "", http.StatusOK)
	if initial["clientSecretSet"] != false || initial["issuer"] != "" {
		t.Fatalf("initial settings = %#v, want empty/unset", initial)
	}
	if registry.Get() != nil {
		t.Fatal("registry has a live Keycloak before any settings were ever saved")
	}

	created := requestJSON(t, client, adminToken, http.MethodPut, settingsURL, `{
		"issuer":"https://keycloak.example/realms/company",
		"clientId":"jaslide-web",
		"clientSecret":"s3cr3t",
		"redirectUri":"https://jaslide.example/api/auth/keycloak/callback",
		"adminRoles":"jaslide-admin, jaslide-owner"
	}`, http.StatusOK)
	if created["clientSecretSet"] != true {
		t.Fatalf("PUT response leaked or omitted the secret flag: %#v", created)
	}
	if _, leaked := created["clientSecret"]; leaked {
		t.Fatalf("PUT response leaked the raw client secret: %#v", created)
	}
	if registry.Get() == nil {
		t.Fatal("registry.Get() is nil after saving a complete Keycloak config — hot-swap did not happen")
	}
	if roles := registry.AdminRoles(); len(roles) != 2 || roles[0] != "jaslide-admin" || roles[1] != "jaslide-owner" {
		t.Fatalf("registry.AdminRoles() = %v, want [jaslide-admin jaslide-owner]", roles)
	}
	firstKeycloak := registry.Get()

	// Omitting clientSecret on a follow-up edit must keep the previously
	// saved secret rather than clearing it — the GET response never returns
	// the real value for an admin to copy back into the form.
	updated := requestJSON(t, client, adminToken, http.MethodPut, settingsURL, `{
		"adminRoles":"jaslide-admin"
	}`, http.StatusOK)
	if updated["clientSecretSet"] != true {
		t.Fatalf("clientSecret was cleared by an update that omitted it: %#v", updated)
	}
	stored, err := store.GetKeycloakSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if stored.ClientSecret != "s3cr3t" {
		t.Fatalf("stored ClientSecret = %q, want unchanged s3cr3t", stored.ClientSecret)
	}
	if registry.Get() == firstKeycloak {
		t.Fatal("registry.Get() still returns the pre-update Keycloak instance — hot-swap did not happen on the second save")
	}
	if roles := registry.AdminRoles(); len(roles) != 1 || roles[0] != "jaslide-admin" {
		t.Fatalf("registry.AdminRoles() after second save = %v, want [jaslide-admin]", roles)
	}

	// An incomplete config (missing clientId/redirectUri) must be rejected
	// without touching the DB or the live registry.
	requestJSON(t, client, adminToken, http.MethodPut, settingsURL, `{
		"issuer":"https://keycloak.example/realms/company",
		"clientId":"",
		"redirectUri":""
	}`, http.StatusBadRequest)
	stillStored, err := store.GetKeycloakSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if stillStored.ClientID == "" {
		t.Fatalf("a rejected PUT persisted an incomplete config: %#v", stillStored)
	}
	if registry.Get() == nil {
		t.Fatal("a rejected PUT cleared the live registry")
	}
}
