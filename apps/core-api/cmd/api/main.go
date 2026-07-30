package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/spsp4755/JaSlide/apps/core-api/internal/config"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/httpserver"
)

func main() {
	config, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}

	server := &http.Server{
		Addr:              config.Address,
		Handler:           httpserver.New(dependencyProbe{config: config, client: &http.Client{Timeout: 2 * time.Second}}),
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		log.Printf("core API listening on %s", config.Address)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	signalContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	<-signalContext.Done()

	shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownContext); err != nil {
		log.Printf("server shutdown: %v", err)
	}
}

type dependencyProbe struct {
	config config.Config
	client *http.Client
}

func (probe dependencyProbe) Ready() error {
	for _, dependency := range []struct {
		name        string
		rawURL      string
		defaultPort string
	}{
		{"database", probe.config.DatabaseURL, "5432"},
		{"redis", probe.config.RedisURL, "6379"},
	} {
		if err := probeTCP(dependency.rawURL, dependency.defaultPort); err != nil {
			return fmt.Errorf("%s unavailable: %w", dependency.name, err)
		}
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

func probeTCP(rawURL, defaultPort string) error {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return err
	}
	host := parsed.Hostname()
	if host == "" {
		return fmt.Errorf("missing host")
	}
	port := parsed.Port()
	if port == "" {
		port = defaultPort
	}
	connection, err := net.DialTimeout("tcp", net.JoinHostPort(host, port), 2*time.Second)
	if err != nil {
		return err
	}
	return connection.Close()
}
