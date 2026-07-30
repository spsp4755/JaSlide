package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/mail"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/auth"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
)

type AuthOptions struct {
	SecureCookies bool
	FrontendURL   string
}

type KeycloakProvider interface {
	Authorization(context.Context) (auth.AuthorizationRequest, error)
	Exchange(context.Context, string, string, string) (auth.KeycloakIdentity, error)
	// AdminRoles reports which Keycloak realm/client roles map to the
	// application's ADMIN role. Reads live off whatever the provider
	// currently holds, so an admin editing it takes effect immediately.
	AdminRoles() []string
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
	router.Post("/register", handlers.register)
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
		request.Context(), identity, handlers.keycloak.AdminRoles(),
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
		Email    string  `json:"email"`
		Password *string `json:"password"`
	}
	validation, err := decodeJSON(writer, request, &input, "email", "password")
	if err != nil {
		handlers.badJSON(writer, err)
		return
	}
	if !validEmail(input.Email) {
		validation = append(validation, "email must be an email")
	}
	if input.Password == nil {
		validation = append(validation, "password should not be empty", "password must be a string")
	} else if *input.Password == "" {
		validation = append(validation, "password should not be empty")
	}
	if len(validation) != 0 {
		writeValidationError(writer, validation)
		return
	}

	principal, token, err := handlers.service.Login(request.Context(), input.Email, *input.Password, auth.LoginMetadata{
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

func (handlers *authHandlers) register(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		Email    string  `json:"email"`
		Password *string `json:"password"`
		Name     *string `json:"name"`
	}
	validation, err := decodeJSON(writer, request, &input, "email", "password", "name")
	if err != nil {
		handlers.badJSON(writer, err)
		return
	}
	if !validEmail(input.Email) {
		validation = append(validation, "email must be an email")
	}
	if input.Password == nil {
		validation = append(validation,
			"password must be longer than or equal to 8 characters", "password must be a string",
		)
	} else if len(*input.Password) < 8 {
		validation = append(validation, "password must be longer than or equal to 8 characters")
	}
	if len(validation) != 0 {
		writeValidationError(writer, validation)
		return
	}
	principal, token, err := handlers.service.Register(
		request.Context(), input.Email, *input.Password, input.Name,
	)
	if err != nil {
		if errors.Is(err, db.ErrUserExists) {
			writeAPIError(writer, http.StatusConflict, "User with this email already exists", "Conflict")
			return
		}
		writeAPIError(writer, http.StatusInternalServerError, "Internal server error", "Internal Server Error")
		return
	}
	http.SetCookie(writer, handlers.cookie("jaslide_session", token, "/"))
	writeJSON(writer, http.StatusCreated, struct {
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
	if err != nil || address.Address != value || len(value) > 254 {
		return false
	}
	at := strings.LastIndexByte(value, '@')
	if at <= 0 || at > 64 || at == len(value)-1 {
		return false
	}
	domain := value[at+1:]
	labels := strings.Split(domain, ".")
	if len(labels) < 2 || len(labels[len(labels)-1]) < 2 {
		return false
	}
	for index, label := range labels {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, character := range label {
			if character >= 'a' && character <= 'z' ||
				character >= 'A' && character <= 'Z' ||
				index < len(labels)-1 && character >= '0' && character <= '9' ||
				character == '-' {
				continue
			}
			return false
		}
	}
	return true
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

func writeValidationError(writer http.ResponseWriter, messages []string) {
	writeJSON(writer, http.StatusBadRequest, map[string]any{
		"message": messages, "error": "Bad Request", "statusCode": http.StatusBadRequest,
	})
}

func decodeJSON(
	writer http.ResponseWriter,
	request *http.Request,
	target any,
	allowedFields ...string,
) ([]string, error) {
	decoder := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 64<<10))
	var raw json.RawMessage
	if err := decoder.Decode(&raw); err != nil {
		return nil, err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return nil, errors.New("multiple JSON values")
		}
		return nil, err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, err
	}
	allowed := make(map[string]bool, len(allowedFields))
	for _, field := range allowedFields {
		allowed[field] = true
	}
	var unknown []string
	for field := range fields {
		if !allowed[field] {
			unknown = append(unknown, field)
			delete(fields, field)
		}
	}
	sort.Strings(unknown)
	known, err := json.Marshal(fields)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(known, target); err != nil {
		return nil, err
	}
	var validation []string
	for _, field := range unknown {
		validation = append(validation, "property "+field+" should not exist")
	}
	return validation, nil
}

func (handlers *authHandlers) badJSON(writer http.ResponseWriter, err error) {
	message := "Bad Request"
	if errors.Is(err, io.ErrUnexpectedEOF) {
		message = "Unexpected end of JSON input"
	} else if err.Error() == "multiple JSON values" {
		message = "Unexpected non-whitespace character after JSON"
	} else {
		message = fmt.Sprintf("Invalid JSON: %v", err)
	}
	writeAPIError(writer, http.StatusBadRequest, message, "Bad Request")
}
