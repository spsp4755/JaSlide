package config

import (
	"testing"
	"time"
)

func TestLoadPreservesAuthenticationDefaults(t *testing.T) {
	t.Setenv("NODE_ENV", "development")
	t.Setenv("JWT_SECRET", "test-secret")
	t.Setenv("JWT_EXPIRES_IN", "")
	t.Setenv("FRONTEND_URL", "")
	t.Setenv("KEYCLOAK_ISSUER", "")
	t.Setenv("KEYCLOAK_CLIENT_ID", "")
	t.Setenv("KEYCLOAK_REDIRECT_URI", "")
	t.Setenv("APP_URL", "")

	config, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if config.JWTLifetime != 7*24*time.Hour {
		t.Fatalf("JWT lifetime = %s, want 168h", config.JWTLifetime)
	}
	if config.FrontendURL != "http://localhost:3000" {
		t.Fatalf("frontend URL = %q", config.FrontendURL)
	}
}

func TestLoadAcceptsNestStyleDayLifetimeAndKeycloakRedirectFallback(t *testing.T) {
	t.Setenv("NODE_ENV", "development")
	t.Setenv("JWT_SECRET", "test-secret")
	t.Setenv("JWT_EXPIRES_IN", "2d")
	t.Setenv("APP_URL", "https://slides.internal/")
	t.Setenv("KEYCLOAK_ISSUER", "https://keycloak.internal/realms/company/")
	t.Setenv("KEYCLOAK_CLIENT_ID", "jaslide")
	t.Setenv("KEYCLOAK_REDIRECT_URI", "")
	t.Setenv("KEYCLOAK_ADMIN_ROLES", "slides-admin, company-admin ")

	config, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if config.JWTLifetime != 48*time.Hour {
		t.Fatalf("JWT lifetime = %s, want 48h", config.JWTLifetime)
	}
	if config.KeycloakRedirectURI != "https://slides.internal/api/auth/keycloak/callback" {
		t.Fatalf("redirect URI = %q", config.KeycloakRedirectURI)
	}
	if len(config.KeycloakAdminRoles) != 2 || config.KeycloakAdminRoles[1] != "company-admin" {
		t.Fatalf("admin roles = %#v", config.KeycloakAdminRoles)
	}
}

func TestLoadRejectsInvalidJWTLifetime(t *testing.T) {
	t.Setenv("NODE_ENV", "development")
	t.Setenv("JWT_EXPIRES_IN", "forever")

	if _, err := Load(); err == nil {
		t.Fatal("Load() accepted invalid JWT_EXPIRES_IN")
	}
}
