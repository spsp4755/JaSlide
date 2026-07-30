package config

import (
	"strings"
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

func TestLoadBuildsImmutableLLMEndpointAndEnvironmentAllowlists(t *testing.T) {
	t.Setenv("NODE_ENV", "development")
	t.Setenv("OPENAI_BASE_URL", "http://vllm.internal:8000/v1")
	t.Setenv("LLM_ALLOWED_ENDPOINTS", "http://sglang.internal:30000/v1")
	t.Setenv("LLM_ALLOWED_API_KEY_ENV_VARS", "VLLM_API_KEY,SGLANG_API_KEY")

	config, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(config.AllowedLLMEndpoints) != 2 ||
		config.AllowedLLMEndpoints[0] != "http://vllm.internal:8000/v1" ||
		config.AllowedLLMEndpoints[1] != "http://sglang.internal:30000/v1" {
		t.Fatalf("endpoint allowlist = %#v", config.AllowedLLMEndpoints)
	}
	if len(config.AllowedLLMAPIKeyEnvVars) != 2 || config.AllowedLLMAPIKeyEnvVars[1] != "SGLANG_API_KEY" {
		t.Fatalf("environment allowlist = %#v", config.AllowedLLMAPIKeyEnvVars)
	}
}

func TestLoadRequiresLongJWTSecretInProduction(t *testing.T) {
	setValidProductionEnvironment(t)
	t.Setenv("JWT_SECRET", strings.Repeat("a", 31))

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "at least 32 bytes") {
		t.Fatalf("Load() error = %v, want minimum JWT secret length error", err)
	}
}

func TestLoadAccepts32ByteJWTSecretInProduction(t *testing.T) {
	setValidProductionEnvironment(t)
	t.Setenv("JWT_SECRET", strings.Repeat("a", 32))

	if _, err := Load(); err != nil {
		t.Fatalf("Load() error = %v", err)
	}
}

func setValidProductionEnvironment(t *testing.T) {
	t.Helper()
	t.Setenv("NODE_ENV", "production")
	t.Setenv("DATABASE_URL", "postgresql://postgres:secret@database:5432/jaslide")
	t.Setenv("REDIS_URL", "redis://redis:6379")
	t.Setenv("JWT_SECRET", strings.Repeat("a", 32))
	t.Setenv("RENDERER_URL", "http://renderer:8000")
	t.Setenv("PUBLIC_ORIGIN", "https://slides.internal")
	t.Setenv("CORS_ORIGIN", "")
}
