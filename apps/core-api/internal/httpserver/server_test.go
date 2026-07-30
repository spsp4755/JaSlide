package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/spsp4755/JaSlide/apps/core-api/internal/config"
)

type unavailableProbe struct{}

func (unavailableProbe) Ready() error { return errors.New("dependency unavailable") }

func TestHealthLiveReturnsOK(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/health/live", nil)
	response := httptest.NewRecorder()

	New(unavailableProbe{}).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if body := response.Body.String(); body != "{\"status\":\"ok\"}\n" {
		t.Fatalf("body = %q, want health response", body)
	}
}

func TestConfigLoadRejectsMissingProductionDependencies(t *testing.T) {
	for _, missing := range []string{"DATABASE_URL", "REDIS_URL", "JWT_SECRET", "RENDERER_URL", "PUBLIC_ORIGIN"} {
		t.Run(missing, func(t *testing.T) {
			t.Setenv("NODE_ENV", "production")
			t.Setenv("DATABASE_URL", "postgresql://postgres:secret@database:5432/jaslide")
			t.Setenv("REDIS_URL", "redis://redis:6379")
			t.Setenv("JWT_SECRET", "test-secret-at-least-32-characters")
			t.Setenv("RENDERER_URL", "http://renderer:8000")
			t.Setenv("PUBLIC_ORIGIN", "https://slides.internal")
			t.Setenv("CORS_ORIGIN", "")
			t.Setenv(missing, "")

			if _, err := config.Load(); err == nil {
				t.Fatalf("Load() error = nil when %s is empty", missing)
			}
		})
	}
}

func TestConfigLoadRejectsWrongProductionDependencySchemes(t *testing.T) {
	for _, test := range []struct {
		name  string
		key   string
		value string
	}{
		{"database", "DATABASE_URL", "mysql://database:3306/jaslide"},
		{"redis", "REDIS_URL", "http://redis:6379"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("NODE_ENV", "production")
			t.Setenv("DATABASE_URL", "postgresql://postgres:secret@database:5432/jaslide")
			t.Setenv("REDIS_URL", "redis://redis:6379")
			t.Setenv("JWT_SECRET", "test-secret-at-least-32-characters")
			t.Setenv("RENDERER_URL", "http://renderer:8000")
			t.Setenv("PUBLIC_ORIGIN", "https://slides.internal")
			t.Setenv("CORS_ORIGIN", "")
			t.Setenv(test.key, test.value)

			if _, err := config.Load(); err == nil {
				t.Fatalf("Load() error = nil for %s", test.value)
			}
		})
	}
}

func TestHealthReadyReturnsServiceUnavailableWhenDependencyIsUnavailable(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/health/ready", nil)
	response := httptest.NewRecorder()

	New(unavailableProbe{}).ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
	if body := response.Body.String(); body != "{\"status\":\"unavailable\"}\n" {
		t.Fatalf("body = %q, want unavailable response", body)
	}
}

func TestHealthBaseAndMetricsRoutes(t *testing.T) {
	server := New(nil)
	for _, target := range []string{"/api/health", "/api/health/metrics"} {
		request := httptest.NewRequest(http.MethodGet, target, nil)
		response := httptest.NewRecorder()
		server.ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("GET %s status = %d, want %d", target, response.Code, http.StatusOK)
		}
		var body map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatalf("GET %s body: %v", target, err)
		}
		if body["status"] == nil || body["uptime"] == nil {
			t.Fatalf("GET %s body = %#v, want status and uptime", target, body)
		}
	}
}
