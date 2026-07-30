package versions_test

import (
	"net/http"
	"reflect"
	"sort"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/comments"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/profile"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/versions"
)

func TestActiveVersionCommentAndProfileRoutes(t *testing.T) {
	router := chi.NewRouter()
	versions.RegisterRoutes(router, nil, nil)
	comments.RegisterRoutes(router, nil, nil)
	profile.RegisterRoutes(router, nil, nil)

	var got []string
	if err := chi.Walk(router, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if method != http.MethodOptions {
			got = append(got, method+" "+route)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	sort.Strings(got)
	want := []string{
		"DELETE /comments/{id}",
		"DELETE /versions/{id}",
		"GET /presentations/{presentationId}/comments",
		"GET /presentations/{presentationId}/versions",
		"GET /slides/{slideId}/comments",
		"GET /users/me",
		"GET /users/me/presentations",
		"GET /users/{id}",
		"GET /versions/{id}",
		"GET /versions/{id1}/compare/{id2}",
		"PATCH /comments/{id}",
		"POST /comments/{id}/resolve",
		"POST /comments/{id}/unresolve",
		"POST /presentations/{presentationId}/comments",
		"POST /presentations/{presentationId}/versions",
		"POST /versions/{id}/restore",
		"PUT /users/me",
	}
	sort.Strings(want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("routes = %#v, want %#v", got, want)
	}
}
