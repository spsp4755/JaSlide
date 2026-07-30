package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/auth"
)

type AuthOptions struct {
	SecureCookies      bool
	FrontendURL        string
	KeycloakAdminRoles []string
}

type KeycloakProvider interface {
	Authorization(context.Context) (auth.AuthorizationRequest, error)
	Exchange(context.Context, string, string, string) (auth.KeycloakIdentity, error)
}

type authHandlers struct {
	service  *auth.Service
	keycloak KeycloakProvider
	options  AuthOptions
}

func NewAuthHandlers(service *auth.Service, keycloak KeycloakProvider, options AuthOptions) http.Handler {
	handlers := &authHandlers{service: service, keycloak: keycloak, options: options}
	router := chi.NewRouter()
	router.Post("/login", handlers.login)
	router.Post("/logout", handlers.logout)
	router.With(auth.RequireUser(service)).Get("/me", handlers.me)
	router.Get("/keycloak", handlers.startKeycloak)
	router.Get("/keycloak/callback", handlers.completeKeycloak)
	return router
}

func (handlers *authHandlers) startKeycloak(writer http.ResponseWriter, request *http.Request) {
	if handlers.keycloak == nil {
		handlers.failLogin(writer, "sso_unavailable")
		return
	}
	login, err := handlers.keycloak.Authorization(request.Context())
	if err != nil {
		handlers.failLogin(writer, "sso_unavailable")
		return
	}
	transaction, err := handlers.service.BeginKeycloakTransaction(auth.KeycloakTransaction{
		State: login.State, Nonce: login.Nonce, Verifier: login.Verifier,
	})
	if err != nil {
		handlers.failLogin(writer, "sso_unavailable")
		return
	}
	cookie := handlers.cookie("jaslide_keycloak_login", transaction, "/api/auth/keycloak")
	cookie.MaxAge = 600
	http.SetCookie(writer, cookie)
	http.Redirect(writer, request, login.URL, http.StatusFound)
}

func (handlers *authHandlers) completeKeycloak(writer http.ResponseWriter, request *http.Request) {
	code, state := request.URL.Query().Get("code"), request.URL.Query().Get("state")
	cookie, err := request.Cookie("jaslide_keycloak_login")
	if handlers.keycloak == nil || err != nil || code == "" || state == "" {
		handlers.failLogin(writer, "sso_failed")
		return
	}
	transaction, err := handlers.service.CompleteKeycloakTransaction(cookie.Value)
	if err != nil {
		handlers.failLogin(writer, "sso_expired")
		return
	}
	if err := auth.ValidateState(transaction.State, state); err != nil {
		handlers.failLogin(writer, "sso_failed")
		return
	}
	identity, err := handlers.keycloak.Exchange(
		request.Context(), code, transaction.Verifier, transaction.Nonce,
	)
	if err != nil {
		handlers.failLogin(writer, "sso_failed")
		return
	}
	principal, token, err := handlers.service.LoginWithKeycloak(
		request.Context(), identity, handlers.options.KeycloakAdminRoles,
	)
	if err != nil {
		handlers.failLogin(writer, "sso_failed")
		return
	}
	http.SetCookie(writer, handlers.cookie("jaslide_session", token, "/"))
	clear := handlers.cookie("jaslide_keycloak_login", "", "/api/auth/keycloak")
	clear.Expires = time.Unix(0, 0).UTC()
	http.SetCookie(writer, clear)
	target := "dashboard"
	if principal.Role == "ADMIN" || principal.Role == "SYSTEM_ADMIN" {
		target = "admin"
	}
	http.Redirect(writer, request, strings.TrimRight(handlers.frontendURL(), "/")+"/"+target, http.StatusFound)
}

func (handlers *authHandlers) failLogin(writer http.ResponseWriter, reason string) {
	writer.Header().Set("Location", strings.TrimRight(handlers.frontendURL(), "/")+"/login?error="+reason)
	writer.WriteHeader(http.StatusFound)
}

func (handlers *authHandlers) frontendURL() string {
	if handlers.options.FrontendURL != "" {
		return handlers.options.FrontendURL
	}
	return "http://localhost:3000"
}

func (handlers *authHandlers) login(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 64<<10))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || !validEmail(input.Email) {
		writeAPIError(writer, http.StatusBadRequest, "Bad Request", "Bad Request")
		return
	}

	principal, token, err := handlers.service.Login(request.Context(), input.Email, input.Password, auth.LoginMetadata{
		IPAddress: clientIP(request),
		UserAgent: request.UserAgent(),
	})
	if err != nil {
		switch {
		case errors.Is(err, auth.ErrInvalidCredentials):
			writeAPIError(writer, http.StatusUnauthorized, "Invalid credentials", "Unauthorized")
		case errors.Is(err, auth.ErrAccountLocked):
			writeAPIError(writer, http.StatusUnauthorized, "Account is temporarily locked. Please try again later.", "Unauthorized")
		default:
			writeAPIError(writer, http.StatusInternalServerError, "Internal server error", "Internal Server Error")
		}
		return
	}

	http.SetCookie(writer, handlers.cookie("jaslide_session", token, "/"))
	writeJSON(writer, http.StatusOK, struct {
		User loginResponseUser `json:"user"`
	}{User: loginUser(principal)})
}

func (handlers *authHandlers) logout(writer http.ResponseWriter, _ *http.Request) {
	cookie := handlers.cookie("jaslide_session", "", "/")
	cookie.Expires = time.Unix(0, 0).UTC()
	http.SetCookie(writer, cookie)
	writer.WriteHeader(http.StatusNoContent)
}

func (handlers *authHandlers) me(writer http.ResponseWriter, request *http.Request) {
	principal, _ := auth.PrincipalFromContext(request.Context())
	writeJSON(writer, http.StatusOK, principal)
}

func (handlers *authHandlers) cookie(name, value, path string) *http.Cookie {
	return &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     path,
		HttpOnly: true,
		Secure:   handlers.options.SecureCookies,
		SameSite: http.SameSiteLaxMode,
	}
}

type loginResponseUser struct {
	ID    string  `json:"id"`
	Email string  `json:"email"`
	Name  *string `json:"name"`
	Role  string  `json:"role"`
}

func loginUser(principal auth.Principal) loginResponseUser {
	return loginResponseUser{
		ID: principal.ID, Email: principal.Email, Name: principal.Name, Role: principal.Role,
	}
}

func validEmail(value string) bool {
	address, err := mail.ParseAddress(value)
	return err == nil && address.Address == value && strings.Contains(value, "@")
}

func clientIP(request *http.Request) string {
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err == nil {
		return host
	}
	return request.RemoteAddr
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func writeAPIError(writer http.ResponseWriter, status int, message, kind string) {
	writeJSON(writer, status, map[string]any{"message": message, "error": kind, "statusCode": status})
}
