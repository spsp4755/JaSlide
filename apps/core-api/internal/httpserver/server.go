package httpserver

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

type DependencyProbe interface {
	Ready() error
}

func New(probe DependencyProbe, authRoutes ...http.Handler) http.Handler {
	router := chi.NewRouter()
	router.Get("/api/health/live", func(writer http.ResponseWriter, _ *http.Request) {
		writeStatus(writer, http.StatusOK, "ok")
	})
	router.Get("/api/health/ready", func(writer http.ResponseWriter, _ *http.Request) {
		if probe != nil && probe.Ready() != nil {
			writeStatus(writer, http.StatusServiceUnavailable, "unavailable")
			return
		}
		writeStatus(writer, http.StatusOK, "ok")
	})
	if len(authRoutes) > 0 && authRoutes[0] != nil {
		router.Mount("/api/auth", authRoutes[0])
	}
	return router
}

func writeStatus(writer http.ResponseWriter, status int, value string) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(map[string]string{"status": value})
}
