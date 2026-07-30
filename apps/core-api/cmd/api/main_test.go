package main

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/spsp4755/JaSlide/apps/core-api/internal/config"
)

func TestRunServerReturnsListenError(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if err := runServer(ctx, &http.Server{Addr: "not a valid address"}); err == nil {
		t.Fatal("runServer() error = nil")
	}
}

func TestBuildAuthRoutesRequiresJWTSecret(t *testing.T) {
	if _, err := buildAuthRoutes(config.Config{JWTLifetime: time.Hour}, nil); err == nil {
		t.Fatal("buildAuthRoutes() accepted an empty JWT secret")
	}
}

func TestBuildAuthRoutesAllowsUnconfiguredKeycloak(t *testing.T) {
	handler, err := buildAuthRoutes(config.Config{
		JWTSecret: "test-secret", JWTLifetime: time.Hour, FrontendURL: "http://localhost:3000",
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if handler == nil {
		t.Fatal("buildAuthRoutes() returned a nil handler")
	}
}
