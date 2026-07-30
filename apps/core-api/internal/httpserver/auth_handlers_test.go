package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/spsp4755/JaSlide/apps/core-api/internal/auth"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
	"golang.org/x/crypto/bcrypt"
)

type authStore struct {
	users                map[string]db.User
	loginFailed          int
	loginOK              int
	keycloakUser         *db.User
	keycloakRole         string
	createError          error
	blockSuccessfulLogin bool
}

func (store *authStore) FindUserByEmail(_ context.Context, email string) (db.User, error) {
	user, ok := store.users[email]
	if !ok {
		return db.User{}, errors.New("not found")
	}
	return user, nil
}

func (store *authStore) FindUserByID(_ context.Context, id string) (db.User, error) {
	for _, user := range store.users {
		if user.ID == id {
			return user, nil
		}
	}
	return db.User{}, errors.New("not found")
}

func (store *authStore) RecordFailedLogin(_ context.Context, _ string, _ time.Time) error {
	store.loginFailed++
	return nil
}

func (store *authStore) RecordSuccessfulLogin(_ context.Context, _ string, _ int, _ time.Time) (bool, error) {
	if store.blockSuccessfulLogin {
		return false, nil
	}
	store.loginOK++
	return true, nil
}

func (store *authStore) RecordLoginAttempt(context.Context, string, bool, *string, string, string, string) error {
	return nil
}

func (store *authStore) ResolveKeycloakUser(_ context.Context, _, _, _ string, _, _ *string, role string) (db.User, error) {
	store.keycloakRole = role
	if store.keycloakUser == nil {
		return db.User{}, errors.New("not configured")
	}
	user := *store.keycloakUser
	if user.Role == "USER" || user.Role == "ADMIN" {
		user.Role = role
	}
	store.keycloakUser = &user
	return user, nil
}

func (store *authStore) CreateLocalUser(_ context.Context, email string, name *string, password string) (db.User, error) {
	if store.createError != nil {
		return db.User{}, store.createError
	}
	user := db.User{
		ID: "registered-123", Email: email, Name: name, Password: &password,
		Role: "USER", Status: "ACTIVE",
	}
	store.users[email] = user
	return user, nil
}

func TestLocalLoginPreservesHTTPContract(t *testing.T) {
	password := "password123"
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	if err != nil {
		t.Fatal(err)
	}
	name := "Test User"
	passwordHash := string(hash)
	store := &authStore{users: map[string]db.User{
		"test@example.com": {
			ID:       "user-123",
			Email:    "test@example.com",
			Name:     &name,
			Password: &passwordHash,
			Role:     "USER",
			Status:   "ACTIVE",
		},
	}}
	handler := testAuthHandler(t, store, 7*24*time.Hour)

	response := serveJSON(handler, http.MethodPost, "/api/auth/login", `{"email":"test@example.com","password":"password123"}`)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", response.Code, response.Body.String())
	}
	if got := response.Body.String(); got != `{"user":{"id":"user-123","email":"test@example.com","name":"Test User","role":"USER"}}`+"\n" {
		t.Fatalf("body = %s", got)
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("cookies = %d, want 1", len(cookies))
	}
	cookie := cookies[0]
	if cookie.Name != "jaslide_session" || cookie.Value == "" || !cookie.HttpOnly ||
		cookie.Path != "/" || cookie.SameSite != http.SameSiteLaxMode ||
		cookie.Secure || cookie.MaxAge != 0 || !cookie.Expires.IsZero() {
		t.Fatalf("session cookie = %#v", cookie)
	}
	if store.loginOK != 1 {
		t.Fatalf("successful-login updates = %d, want 1", store.loginOK)
	}
}

func TestLocalLoginRejectsBadPassword(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte("correct-password"), 10)
	if err != nil {
		t.Fatal(err)
	}
	passwordHash := string(hash)
	store := &authStore{users: map[string]db.User{
		"test@example.com": {
			ID:       "user-123",
			Email:    "test@example.com",
			Password: &passwordHash,
			Role:     "USER",
			Status:   "ACTIVE",
		},
	}}
	handler := testAuthHandler(t, store, time.Hour)

	response := serveJSON(handler, http.MethodPost, "/api/auth/login", `{"email":"test@example.com","password":"wrong"}`)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.Code)
	}
	assertJSON(t, response.Body.Bytes(), map[string]any{
		"message": "Invalid credentials", "error": "Unauthorized", "statusCode": float64(401),
	})
	if store.loginFailed != 1 {
		t.Fatalf("failed-login updates = %d, want 1", store.loginFailed)
	}
}

func TestConcurrentLockoutPreventsSuccessfulSession(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte("correct-password"), 10)
	if err != nil {
		t.Fatal(err)
	}
	passwordHash := string(hash)
	store := &authStore{
		users: map[string]db.User{
			"test@example.com": {
				ID: "user-123", Email: "test@example.com", Password: &passwordHash,
				Role: "USER", Status: "ACTIVE", FailedLoginAttempts: 4,
			},
		},
		blockSuccessfulLogin: true,
	}
	handler := testAuthHandler(t, store, time.Hour)

	response := serveJSON(handler, http.MethodPost, "/api/auth/login",
		`{"email":"test@example.com","password":"correct-password"}`)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401; body=%s", response.Code, response.Body.String())
	}
	if len(response.Result().Cookies()) != 0 {
		t.Fatal("session cookie was issued after a concurrent lockout")
	}
}

func TestRegisterPreservesHTTPContract(t *testing.T) {
	store := &authStore{users: map[string]db.User{}}
	handler := testAuthHandler(t, store, time.Hour)

	response := serveJSON(handler, http.MethodPost, "/api/auth/register",
		`{"email":"new@example.com","password":"password123","name":"New User"}`)

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", response.Code, response.Body.String())
	}
	if got := response.Body.String(); got != `{"user":{"id":"registered-123","email":"new@example.com","name":"New User","role":"USER"}}`+"\n" {
		t.Fatalf("body = %s", got)
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != "jaslide_session" ||
		cookies[0].Value == "" || !cookies[0].HttpOnly {
		t.Fatalf("registration cookie = %#v", cookies)
	}
	if stored := store.users["new@example.com"]; stored.Password == nil ||
		bcrypt.CompareHashAndPassword([]byte(*stored.Password), []byte("password123")) != nil {
		t.Fatal("registered password was not stored as a compatible bcrypt hash")
	}
}

func TestRegisterRejectsDuplicateEmail(t *testing.T) {
	store := &authStore{users: map[string]db.User{
		"existing@example.com": {ID: "existing", Email: "existing@example.com"},
	}}
	handler := testAuthHandler(t, store, time.Hour)

	response := serveJSON(handler, http.MethodPost, "/api/auth/register",
		`{"email":"existing@example.com","password":"password123"}`)

	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", response.Code)
	}
	assertJSON(t, response.Body.Bytes(), map[string]any{
		"message": "User with this email already exists", "error": "Conflict", "statusCode": float64(409),
	})
}

func TestLoginRejectsInvalidBodiesBeforeAuthentication(t *testing.T) {
	tests := []struct {
		name     string
		body     string
		messages []string
	}{
		{
			"missing password", `{"email":"test@example.com"}`,
			[]string{"password should not be empty", "password must be a string"},
		},
		{
			"empty password", `{"email":"test@example.com","password":""}`,
			[]string{"password should not be empty"},
		},
		{
			"unknown property", `{"email":"test@example.com","password":"password123","extra":true}`,
			[]string{"property extra should not exist"},
		},
		{
			"single-label email domain", `{"email":"a@b","password":"password123"}`,
			[]string{"email must be an email"},
		},
		{
			"one-character top-level domain", `{"email":"x@y.c","password":"password123"}`,
			[]string{"email must be an email"},
		},
		{
			"case-variant email key", `{"Email":"test@example.com","password":"password123"}`,
			[]string{"property Email should not exist", "email must be an email"},
		},
		{
			"case-variant password key", `{"email":"test@example.com","Password":"password123"}`,
			[]string{
				"property Password should not exist",
				"password should not be empty",
				"password must be a string",
			},
		},
		{"malformed JSON", `{"email":"test@example.com"`, nil},
		{
			"multiple JSON values",
			`{"email":"test@example.com","password":"password123"}{"email":"other@example.com"}`,
			nil,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := &authStore{users: map[string]db.User{}}
			handler := testAuthHandler(t, store, time.Hour)
			response := serveJSON(handler, http.MethodPost, "/api/auth/login", test.body)

			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", response.Code, response.Body.String())
			}
			var body map[string]any
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body["error"] != "Bad Request" || body["statusCode"] != float64(400) {
				t.Fatalf("body = %#v", body)
			}
			if test.messages != nil {
				var actual []string
				for _, message := range body["message"].([]any) {
					actual = append(actual, message.(string))
				}
				if strings.Join(actual, "\n") != strings.Join(test.messages, "\n") {
					t.Fatalf("messages = %#v, want %#v", actual, test.messages)
				}
			}
		})
	}
}

func TestLogoutClearsSessionCookie(t *testing.T) {
	handler := testAuthHandler(t, &authStore{users: map[string]db.User{}}, time.Hour)
	response := serveJSON(handler, http.MethodPost, "/api/auth/logout", "")

	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", response.Code)
	}
	if response.Body.Len() != 0 {
		t.Fatalf("body = %q, want empty", response.Body.String())
	}
	header := response.Header().Get("Set-Cookie")
	if !strings.HasPrefix(header, "jaslide_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax") {
		t.Fatalf("Set-Cookie = %q", header)
	}
}

func TestProductionCookieIsSecure(t *testing.T) {
	sessions, err := auth.NewSessions("test-secret-at-least-32-characters", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	handler := New(nil, NewAuthHandlers(
		auth.NewService(&authStore{users: map[string]db.User{}}, sessions),
		nil,
		AuthOptions{SecureCookies: true},
	))
	response := serveJSON(handler, http.MethodPost, "/api/auth/logout", "")

	cookies := response.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].Secure {
		t.Fatalf("production cookie = %#v, want Secure", cookies)
	}
}

func TestMeRejectsExpiredSession(t *testing.T) {
	store := &authStore{users: map[string]db.User{}}
	sessions, err := auth.NewSessions("test-secret-at-least-32-characters", -time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	token, err := sessions.Issue(auth.Principal{ID: "user-123", Email: "test@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	handler := New(nil, NewAuthHandlers(auth.NewService(store, sessions), nil, AuthOptions{}))
	request := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	request.AddCookie(&http.Cookie{Name: "jaslide_session", Value: token})
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.Code)
	}
}

func TestMePreservesNullablePrincipalFields(t *testing.T) {
	store := &authStore{users: map[string]db.User{
		"user@example.com": {
			ID: "user-123", Email: "user@example.com", Role: "USER", Status: "ACTIVE",
		},
	}}
	sessions, err := auth.NewSessions("test-secret-at-least-32-characters", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	token, err := sessions.Issue(auth.Principal{ID: "user-123", Email: "user@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	handler := New(nil, NewAuthHandlers(auth.NewService(store, sessions), nil, AuthOptions{}))
	request := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	request.AddCookie(&http.Cookie{Name: "jaslide_session", Value: token})
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}
	assertJSON(t, response.Body.Bytes(), map[string]any{
		"id": "user-123", "email": "user@example.com", "name": nil, "image": nil,
		"role": "USER", "organizationId": nil, "status": "ACTIVE",
	})
}

func TestRequireRoleRejectsNonAdmin(t *testing.T) {
	store := &authStore{users: map[string]db.User{
		"user@example.com": {ID: "user-123", Email: "user@example.com", Role: "USER", Status: "ACTIVE"},
	}}
	sessions, err := auth.NewSessions("test-secret-at-least-32-characters", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	token, err := sessions.Issue(auth.Principal{ID: "user-123", Email: "user@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	protected := auth.RequireUser(auth.NewService(store, sessions))(
		auth.RequireRole("ADMIN")(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			writer.WriteHeader(http.StatusNoContent)
		})),
	)
	request := httptest.NewRequest(http.MethodGet, "/admin", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()

	protected.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", response.Code)
	}
}

func TestKeycloakStartSetsTenMinuteTransactionCookie(t *testing.T) {
	var issuer string
	provider := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/.well-known/openid-configuration" {
			http.NotFound(writer, request)
			return
		}
		_ = json.NewEncoder(writer).Encode(map[string]string{
			"issuer": issuer, "authorization_endpoint": issuer + "/authorize",
			"token_endpoint": issuer + "/token", "jwks_uri": issuer + "/jwks",
		})
	}))
	defer provider.Close()
	issuer = provider.URL

	store := &authStore{users: map[string]db.User{}}
	sessions, err := auth.NewSessions("test-secret-at-least-32-characters", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	keycloak, err := auth.NewKeycloak(auth.KeycloakConfig{
		Issuer: issuer, ClientID: "jaslide", RedirectURI: "https://jaslide.example/api/auth/keycloak/callback",
	}, provider.Client())
	if err != nil {
		t.Fatal(err)
	}
	handler := New(nil, NewAuthHandlers(auth.NewService(store, sessions), keycloak, AuthOptions{
		FrontendURL: "https://jaslide.example",
	}))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/auth/keycloak", nil))

	if response.Code != http.StatusFound || !strings.HasPrefix(response.Header().Get("Location"), issuer+"/authorize?") {
		t.Fatalf("status/location = %d %q", response.Code, response.Header().Get("Location"))
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != "jaslide_keycloak_login" ||
		cookies[0].Path != "/api/auth/keycloak" || cookies[0].MaxAge != 600 ||
		!cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteLaxMode {
		t.Fatalf("transaction cookie = %#v", cookies)
	}
}

func TestKeycloakUnavailableReturnsToLogin(t *testing.T) {
	handler := testAuthHandler(t, &authStore{users: map[string]db.User{}}, time.Hour)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/auth/keycloak", nil))

	if response.Code != http.StatusFound || response.Header().Get("Location") != "http://localhost:3000/login?error=sso_unavailable" {
		t.Fatalf("status/location = %d %q", response.Code, response.Header().Get("Location"))
	}
}

type fakeKeycloak struct {
	request  auth.AuthorizationRequest
	identity auth.KeycloakIdentity
}

func (provider fakeKeycloak) Authorization(context.Context) (auth.AuthorizationRequest, error) {
	return provider.request, nil
}

func (provider fakeKeycloak) Exchange(context.Context, string, string, string) (auth.KeycloakIdentity, error) {
	return provider.identity, nil
}

func TestKeycloakCallbackCreatesSessionAndRedirectsAdmin(t *testing.T) {
	name := "Keycloak Admin"
	user := db.User{
		ID: "admin-123", Email: "admin@example.com", Name: &name, Role: "ADMIN", Status: "ACTIVE",
	}
	store := &authStore{users: map[string]db.User{}, keycloakUser: &user}
	sessions, err := auth.NewSessions("test-secret-at-least-32-characters", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	provider := fakeKeycloak{
		request: auth.AuthorizationRequest{
			URL: "https://keycloak.example/authorize", State: "expected-state",
			Nonce: "expected-nonce", Verifier: "expected-verifier",
		},
		identity: auth.KeycloakIdentity{
			Issuer: "https://keycloak.example/realms/company", Subject: "subject-123",
			Email: user.Email, Name: &name, Roles: []string{"jaslide-admin"},
		},
	}
	handler := New(nil, NewAuthHandlers(auth.NewService(store, sessions), provider, AuthOptions{
		FrontendURL: "https://jaslide.example", KeycloakAdminRoles: []string{"jaslide-admin"},
	}))
	start := httptest.NewRecorder()
	handler.ServeHTTP(start, httptest.NewRequest(http.MethodGet, "/api/auth/keycloak", nil))
	transaction := start.Result().Cookies()[0]
	callbackRequest := httptest.NewRequest(
		http.MethodGet, "/api/auth/keycloak/callback?code=code&state=expected-state", nil,
	)
	callbackRequest.AddCookie(transaction)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, callbackRequest)

	if response.Code != http.StatusFound || response.Header().Get("Location") != "https://jaslide.example/admin" {
		t.Fatalf("status/location = %d %q", response.Code, response.Header().Get("Location"))
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 2 || cookies[0].Name != "jaslide_session" || cookies[0].Value == "" ||
		cookies[1].Name != "jaslide_keycloak_login" || !cookies[1].Expires.Equal(time.Unix(0, 0).UTC()) {
		t.Fatalf("callback cookies = %#v", cookies)
	}
	if store.keycloakRole != "ADMIN" {
		t.Fatalf("new Keycloak user role = %q, want ADMIN", store.keycloakRole)
	}
}

func TestKeycloakLoginSynchronizesRolePromotionAndRevocation(t *testing.T) {
	user := db.User{
		ID: "keycloak-user", Email: "user@example.com", Role: "USER", Status: "ACTIVE",
	}
	store := &authStore{users: map[string]db.User{}, keycloakUser: &user}
	sessions, err := auth.NewSessions("test-secret-at-least-32-characters", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	service := auth.NewService(store, sessions)
	identity := auth.KeycloakIdentity{
		Issuer: "https://keycloak.example/realms/company", Subject: "subject-123",
		Email: "user@example.com", Roles: []string{"jaslide-admin"},
	}

	promoted, _, err := service.LoginWithKeycloak(
		context.Background(), identity, []string{"jaslide-admin"},
	)
	if err != nil || promoted.Role != "ADMIN" {
		t.Fatalf("promoted principal = %#v, %v", promoted, err)
	}

	identity.Roles = []string{"employee"}
	revoked, _, err := service.LoginWithKeycloak(
		context.Background(), identity, []string{"jaslide-admin"},
	)
	if err != nil || revoked.Role != "USER" {
		t.Fatalf("revoked principal = %#v, %v", revoked, err)
	}
}

func TestKeycloakLoginPreservesApplicationManagedRoles(t *testing.T) {
	for _, role := range []string{"SYSTEM_ADMIN", "ORG_ADMIN", "OPERATOR", "AUDITOR"} {
		t.Run(role, func(t *testing.T) {
			user := db.User{
				ID: "keycloak-user", Email: "user@example.com", Role: role, Status: "ACTIVE",
			}
			store := &authStore{users: map[string]db.User{}, keycloakUser: &user}
			sessions, err := auth.NewSessions("test-secret-at-least-32-characters", time.Hour)
			if err != nil {
				t.Fatal(err)
			}
			principal, _, err := auth.NewService(store, sessions).LoginWithKeycloak(
				context.Background(),
				auth.KeycloakIdentity{
					Issuer:  "https://keycloak.example/realms/company",
					Subject: "subject-123", Email: user.Email,
					Roles: []string{"jaslide-admin"},
				},
				[]string{"jaslide-admin"},
			)
			if err != nil || principal.Role != role {
				t.Fatalf("principal = %#v, %v; want preserved %s", principal, err, role)
			}
		})
	}
}

func testAuthHandler(t *testing.T, store *authStore, lifetime time.Duration) http.Handler {
	t.Helper()
	sessions, err := auth.NewSessions("test-secret-at-least-32-characters", lifetime)
	if err != nil {
		t.Fatal(err)
	}
	return New(nil, NewAuthHandlers(auth.NewService(store, sessions), nil, AuthOptions{}))
}

func serveJSON(handler http.Handler, method, target, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, target, bytes.NewBufferString(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func assertJSON(t *testing.T, raw []byte, want map[string]any) {
	t.Helper()
	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if len(got) != len(want) {
		t.Fatalf("JSON = %#v, want %#v", got, want)
	}
	for key, value := range want {
		if got[key] != value {
			t.Fatalf("JSON[%q] = %#v, want %#v", key, got[key], value)
		}
	}
}
