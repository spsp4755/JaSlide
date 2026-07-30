package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
)

type principalKey struct{}

func PrincipalFromContext(ctx context.Context) (Principal, bool) {
	principal, ok := ctx.Value(principalKey{}).(Principal)
	return principal, ok
}

func RequireUser(service *Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			raw := sessionToken(request)
			userID, _, err := service.sessions.Verify(raw)
			if err != nil {
				writeAuthError(writer, http.StatusUnauthorized, "Unauthorized", "")
				return
			}
			user, err := service.store.FindUserByID(request.Context(), userID)
			if err != nil || user.Status == "SUSPENDED" || user.Status == "INACTIVE" {
				writeAuthError(writer, http.StatusUnauthorized, "Unauthorized", "")
				return
			}
			next.ServeHTTP(writer, request.WithContext(context.WithValue(
				request.Context(), principalKey{}, principalFromUser(user),
			)))
		})
	}
}

func RequireRole(required ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			principal, ok := PrincipalFromContext(request.Context())
			if !ok {
				writeAuthError(writer, http.StatusForbidden, "Authentication required", "Forbidden")
				return
			}
			granted := roleHierarchy[principal.Role]
			if granted == nil {
				granted = map[string]bool{principal.Role: true}
			}
			for _, role := range required {
				if granted[role] {
					next.ServeHTTP(writer, request)
					return
				}
			}
			writeAuthError(writer, http.StatusForbidden, "Insufficient permissions - Admin access required", "Forbidden")
		})
	}
}

var roleHierarchy = map[string]map[string]bool{
	"SYSTEM_ADMIN": roles("SYSTEM_ADMIN", "ORG_ADMIN", "ADMIN", "OPERATOR", "AUDITOR", "USER"),
	"ORG_ADMIN":    roles("ORG_ADMIN", "ADMIN", "OPERATOR", "AUDITOR", "USER"),
	"ADMIN":        roles("ADMIN", "OPERATOR", "AUDITOR", "USER"),
	"OPERATOR":     roles("OPERATOR", "AUDITOR", "USER"),
	"AUDITOR":      roles("AUDITOR", "USER"),
	"USER":         roles("USER"),
}

func roles(values ...string) map[string]bool {
	result := make(map[string]bool, len(values))
	for _, value := range values {
		result[value] = true
	}
	return result
}

func sessionToken(request *http.Request) string {
	if cookie, err := request.Cookie("jaslide_session"); err == nil {
		return cookie.Value
	}
	const bearer = "Bearer "
	if value := request.Header.Get("Authorization"); strings.HasPrefix(value, bearer) {
		return strings.TrimSpace(strings.TrimPrefix(value, bearer))
	}
	return ""
}

func writeAuthError(writer http.ResponseWriter, status int, message, kind string) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	body := map[string]any{"message": message, "statusCode": status}
	if kind != "" {
		body["error"] = kind
	}
	_ = json.NewEncoder(writer).Encode(body)
}
