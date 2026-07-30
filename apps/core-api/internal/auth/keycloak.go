package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"sync"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

type KeycloakConfig struct {
	Issuer       string
	ClientID     string
	ClientSecret string
	RedirectURI  string
}

type AuthorizationRequest struct {
	URL      string
	State    string
	Nonce    string
	Verifier string
}

type KeycloakIdentity struct {
	Issuer  string
	Subject string
	Email   string
	Name    *string
	Image   *string
	Roles   []string
}

type Keycloak struct {
	config   KeycloakConfig
	client   *http.Client
	mu       sync.Mutex
	provider *oidc.Provider
}

func NewKeycloak(config KeycloakConfig, client *http.Client) (*Keycloak, error) {
	switch {
	case strings.TrimSpace(config.Issuer) == "":
		return nil, errors.New("KEYCLOAK_ISSUER must be configured")
	case strings.TrimSpace(config.ClientID) == "":
		return nil, errors.New("KEYCLOAK_CLIENT_ID must be configured")
	case strings.TrimSpace(config.RedirectURI) == "":
		return nil, errors.New("KEYCLOAK_REDIRECT_URI must be configured")
	}
	config.Issuer = strings.TrimRight(config.Issuer, "/")
	if client == nil {
		client = http.DefaultClient
	}
	return &Keycloak{config: config, client: client}, nil
}

func (keycloak *Keycloak) Authorization(ctx context.Context) (AuthorizationRequest, error) {
	provider, err := keycloak.getProvider(ctx)
	if err != nil {
		return AuthorizationRequest{}, err
	}
	state, err := randomToken()
	if err != nil {
		return AuthorizationRequest{}, err
	}
	nonce, err := randomToken()
	if err != nil {
		return AuthorizationRequest{}, err
	}
	verifier, err := randomToken()
	if err != nil {
		return AuthorizationRequest{}, err
	}
	sum := sha256.Sum256([]byte(verifier))
	config := keycloak.oauthConfig(provider)
	return AuthorizationRequest{
		URL: config.AuthCodeURL(state,
			oauth2.SetAuthURLParam("nonce", nonce),
			oauth2.SetAuthURLParam("code_challenge", base64.RawURLEncoding.EncodeToString(sum[:])),
			oauth2.SetAuthURLParam("code_challenge_method", "S256"),
		),
		State: state, Nonce: nonce, Verifier: verifier,
	}, nil
}

func (keycloak *Keycloak) Exchange(ctx context.Context, code, verifier, nonce string) (KeycloakIdentity, error) {
	provider, err := keycloak.getProvider(ctx)
	if err != nil {
		return KeycloakIdentity{}, err
	}
	ctx = context.WithValue(ctx, oauth2.HTTPClient, keycloak.client)
	oauthConfig := keycloak.oauthConfig(provider)
	token, err := oauthConfig.Exchange(ctx, code,
		oauth2.SetAuthURLParam("code_verifier", verifier))
	if err != nil {
		return KeycloakIdentity{}, errors.New("failed to authenticate with Keycloak")
	}
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok {
		return KeycloakIdentity{}, errors.New("Keycloak response has no ID token")
	}
	idToken, err := provider.Verifier(&oidc.Config{ClientID: keycloak.config.ClientID}).Verify(ctx, rawIDToken)
	if err != nil {
		return KeycloakIdentity{}, errors.New("invalid Keycloak ID token")
	}
	var claims struct {
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
		Picture       string `json:"picture"`
		RealmAccess   struct {
			Roles []string `json:"roles"`
		} `json:"realm_access"`
		ResourceAccess map[string]struct {
			Roles []string `json:"roles"`
		} `json:"resource_access"`
	}
	if err := idToken.Claims(&claims); err != nil || !claims.EmailVerified ||
		idToken.Subject == "" || claims.Email == "" || !constantTimeEqual(idToken.Nonce, nonce) {
		return KeycloakIdentity{}, errors.New("invalid Keycloak identity")
	}
	roles := uniqueRoles(claims.RealmAccess.Roles, claims.ResourceAccess[keycloak.config.ClientID].Roles)
	return KeycloakIdentity{
		Issuer: idToken.Issuer, Subject: idToken.Subject, Email: claims.Email,
		Name: optionalString(claims.Name), Image: optionalString(claims.Picture), Roles: roles,
	}, nil
}

func ValidateState(expected, received string) error {
	if !constantTimeEqual(expected, received) {
		return errors.New("invalid login state")
	}
	return nil
}

func (keycloak *Keycloak) getProvider(ctx context.Context) (*oidc.Provider, error) {
	keycloak.mu.Lock()
	defer keycloak.mu.Unlock()
	if keycloak.provider != nil {
		return keycloak.provider, nil
	}
	provider, err := oidc.NewProvider(oidc.ClientContext(ctx, keycloak.client), keycloak.config.Issuer)
	if err != nil {
		return nil, errors.New("failed to connect to Keycloak")
	}
	keycloak.provider = provider
	return provider, nil
}

func (keycloak *Keycloak) oauthConfig(provider *oidc.Provider) oauth2.Config {
	return oauth2.Config{
		ClientID: keycloak.config.ClientID, ClientSecret: keycloak.config.ClientSecret,
		RedirectURL: keycloak.config.RedirectURI, Endpoint: provider.Endpoint(),
		Scopes: []string{oidc.ScopeOpenID, "email", "profile"},
	}
}

func randomToken() (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func constantTimeEqual(expected, received string) bool {
	return expected != "" && len(expected) == len(received) &&
		subtle.ConstantTimeCompare([]byte(expected), []byte(received)) == 1
}

func uniqueRoles(groups ...[]string) []string {
	seen := make(map[string]bool)
	var result []string
	for _, group := range groups {
		for _, role := range group {
			if role != "" && !seen[role] {
				seen[role] = true
				result = append(result, role)
			}
		}
	}
	return result
}

func optionalString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
