package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/admin"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/assets"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/auth"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/comments"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/config"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
	exportapi "github.com/spsp4755/JaSlide/apps/core-api/internal/export"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/generation"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/httpserver"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/outboundpolicy"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/presentations"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/profile"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/renderer"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/skills"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/templates"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/versions"
)

func main() {
	if err := run(); err != nil {
		log.Printf("core API stopped: %v", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	store, err := db.Open(context.Background(), cfg)
	if err != nil {
		return err
	}
	defer func() {
		if err := store.Close(); err != nil {
			log.Printf("close data store: %v", err)
		}
	}()

	authRoutes, authService, err := buildAuthRuntime(cfg, store)
	if err != nil {
		return err
	}
	signalContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	client := &http.Client{Timeout: 30 * time.Second}
	rendererClient := renderer.New(cfg.RendererURL, &http.Client{Timeout: 180 * time.Second})
	templateService := templates.NewService(store, rendererClient, cfg.LocalStoragePath)
	generationStore := generation.NewSQLStore(store)
	generationQueue := generation.NewRedisQueue(store.Redis())
	llmPolicy, err := outboundpolicy.New(cfg.AllowedLLMEndpoints, cfg.AllowedLLMAPIKeyEnvVars)
	if err != nil {
		return err
	}
	llmClient := generation.NewOpenAIClient(generationStore, &http.Client{Timeout: 5 * time.Minute}, generation.EnvironmentModel{
		BaseURL: cfg.OpenAIBaseURL, APIKey: cfg.OpenAIAPIKey, Model: cfg.OpenAIModel, MaxTokens: cfg.OpenAIMaxTokens,
	}, llmPolicy)
	generationService := generation.NewService(generationStore, llmClient, generationQueue)
	go generationService.Run(signalContext)

	apiRoutes := chi.NewRouter()
	apiRoutes.Mount("/presentations", presentations.NewHandlers(
		presentations.NewService(store, cfg.RendererURL, cfg.LocalStoragePath, client), authService,
	))
	apiRoutes.Mount("/assets", assets.NewHandlers(assets.NewService(store, cfg.LocalStoragePath), authService))
	apiRoutes.Mount("/templates", templates.NewHandlers(templateService))
	apiRoutes.Mount("/skills", skills.NewHandlers(store, rendererClient, cfg.LocalStoragePath, authService))
	apiRoutes.Mount("/generation", generation.NewHandlers(generationService, authService, rendererClient))
	apiRoutes.Mount("/export", exportapi.NewHandlers(store, rendererClient, cfg.LocalStoragePath, authService))
	comments.RegisterRoutes(apiRoutes, store, authService)
	profile.RegisterRoutes(apiRoutes, store, authService)
	versions.RegisterRoutes(apiRoutes, store, authService)
	apiRoutes.Mount("/admin", admin.NewHandlers(
		store, authService, generationQueue, cfg.RendererURL, client,
		templates.NewAdminHandlers(templateService, authService),
	))
	server := &http.Server{
		Addr: cfg.Address,
		Handler: httpserver.New(
			dependencyProbe{config: cfg, store: store, client: &http.Client{Timeout: 2 * time.Second}},
			authRoutes,
			apiRoutes,
			assets.NewDownloadHandler(cfg.LocalStoragePath),
		),
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("core API listening on %s", cfg.Address)
	return runServer(signalContext, server)
}

func buildAuthRoutes(cfg config.Config, store auth.Repository) (http.Handler, error) {
	routes, _, err := buildAuthRuntime(cfg, store)
	return routes, err
}

func buildAuthRuntime(cfg config.Config, store auth.Repository) (http.Handler, *auth.Service, error) {
	sessions, err := auth.NewSessions(cfg.JWTSecret, cfg.JWTLifetime)
	if err != nil {
		return nil, nil, err
	}
	var keycloak *auth.Keycloak
	if cfg.KeycloakIssuer != "" && cfg.KeycloakClientID != "" && cfg.KeycloakRedirectURI != "" {
		keycloak, err = auth.NewKeycloak(auth.KeycloakConfig{
			Issuer: cfg.KeycloakIssuer, ClientID: cfg.KeycloakClientID,
			ClientSecret: cfg.KeycloakClientSecret, RedirectURI: cfg.KeycloakRedirectURI,
		}, &http.Client{Timeout: 10 * time.Second})
		if err != nil {
			return nil, nil, err
		}
	}
	service := auth.NewService(store, sessions)
	return httpserver.NewAuthHandlers(service, keycloak, httpserver.AuthOptions{
		SecureCookies:      strings.EqualFold(cfg.Environment, "production"),
		FrontendURL:        cfg.FrontendURL,
		KeycloakAdminRoles: cfg.KeycloakAdminRoles,
	}), service, nil
}

func runServer(signalContext context.Context, server *http.Server) error {
	result := make(chan error, 1)
	go func() {
		result <- server.ListenAndServe()
	}()

	select {
	case <-signalContext.Done():
		shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownContext); err != nil {
			return fmt.Errorf("server shutdown: %w", err)
		}
		return nil
	case err := <-result:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("listen: %w", err)
		}
		return nil
	}
}

type dependencyProbe struct {
	config config.Config
	store  *db.Store
	client *http.Client
}

func (probe dependencyProbe) Ready() error {
	if err := probe.store.Ready(); err != nil {
		return err
	}

	request, err := http.NewRequest(http.MethodGet, strings.TrimRight(probe.config.RendererURL, "/")+"/health", nil)
	if err != nil {
		return fmt.Errorf("renderer URL: %w", err)
	}
	response, err := probe.client.Do(request)
	if err != nil {
		return fmt.Errorf("renderer unavailable: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("renderer status %d", response.StatusCode)
	}
	return nil
}
