package httpserver

import (
	"net/http"
	"runtime"
	"time"

	"github.com/go-chi/chi/v5"
)

var startedAt = time.Now()

type DependencyProbe interface {
	Ready() error
}

func New(probe DependencyProbe, routeGroups ...http.Handler) http.Handler {
	router := chi.NewRouter()
	router.Get("/api/health", func(writer http.ResponseWriter, _ *http.Request) {
		status := "healthy"
		dependencies := "up"
		if probe != nil && probe.Ready() != nil {
			status, dependencies = "degraded", "down"
		}
		writeJSON(writer, http.StatusOK, map[string]any{
			"status": status, "uptime": time.Since(startedAt).Seconds(), "timestamp": time.Now().UTC(),
			"service": "taeslide-core-api", "services": map[string]any{"dependencies": map[string]string{"status": dependencies}},
		})
	})
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
	router.Get("/api/health/metrics", func(writer http.ResponseWriter, _ *http.Request) {
		var memory runtime.MemStats
		runtime.ReadMemStats(&memory)
		writeJSON(writer, http.StatusOK, map[string]any{
			"status": "healthy", "uptime": time.Since(startedAt).Seconds(),
			"memory": map[string]uint64{
				"heapUsed": memory.Alloc / 1024 / 1024, "heapTotal": memory.HeapSys / 1024 / 1024,
				"rss": memory.Sys / 1024 / 1024,
			},
			"requests": map[string]any{"total": 0, "perMinute": 0, "errorRate": 0},
		})
	})
	if len(routeGroups) > 0 && routeGroups[0] != nil {
		router.Mount("/api/auth", routeGroups[0])
	}
	if len(routeGroups) > 1 && routeGroups[1] != nil {
		router.Mount("/api", routeGroups[1])
	}
	if len(routeGroups) > 2 && routeGroups[2] != nil {
		router.Mount("/uploads", routeGroups[2])
	}
	return router
}

func writeStatus(writer http.ResponseWriter, status int, value string) {
	writeJSON(writer, status, map[string]string{"status": value})
}
