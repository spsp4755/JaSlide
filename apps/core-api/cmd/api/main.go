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

	"github.com/spsp4755/JaSlide/apps/core-api/internal/config"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/httpserver"
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

	server := &http.Server{
		Addr:              cfg.Address,
		Handler:           httpserver.New(dependencyProbe{config: cfg, store: store, client: &http.Client{Timeout: 2 * time.Second}}),
		ReadHeaderTimeout: 5 * time.Second,
	}

	signalContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	log.Printf("core API listening on %s", cfg.Address)
	return runServer(signalContext, server)
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
