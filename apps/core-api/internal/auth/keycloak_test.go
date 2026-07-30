package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestKeycloakAuthorizationUsesStateNonceAndS256PKCE(t *testing.T) {
	var issuer string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/.well-known/openid-configuration" {
			http.NotFound(writer, request)
			return
		}
		_ = json.NewEncoder(writer).Encode(map[string]string{
			"issuer": issuer, "authorization_endpoint": issuer + "/authorize",
			"token_endpoint": issuer + "/token", "jwks_uri": issuer + "/jwks",
		})
	}))
	defer server.Close()
	issuer = server.URL

	keycloak, err := NewKeycloak(KeycloakConfig{
		Issuer: issuer, ClientID: "jaslide-web", RedirectURI: "https://jaslide.example/api/auth/keycloak/callback",
	}, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	login, err := keycloak.Authorization(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	authorizationURL, err := url.Parse(login.URL)
	if err != nil {
		t.Fatal(err)
	}
	if len(login.State) != 43 || len(login.Nonce) != 43 || len(login.Verifier) != 43 {
		t.Fatalf("transaction lengths = state:%d nonce:%d verifier:%d", len(login.State), len(login.Nonce), len(login.Verifier))
	}
	wantChallenge := base64.RawURLEncoding.EncodeToString(sha256Sum(login.Verifier))
	if authorizationURL.Query().Get("code_challenge") != wantChallenge ||
		authorizationURL.Query().Get("code_challenge_method") != "S256" {
		t.Fatalf("authorization URL = %s", authorizationURL)
	}
}

func TestKeycloakExchangeVerifiesIDTokenAndExtractsRoles(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	var issuer string
	const clientID = "jaslide-web"
	const nonce = "expected-nonce"
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/.well-known/openid-configuration":
			_ = json.NewEncoder(writer).Encode(map[string]string{
				"issuer": issuer, "authorization_endpoint": issuer + "/authorize",
				"token_endpoint": issuer + "/token", "jwks_uri": issuer + "/jwks",
			})
		case "/jwks":
			_ = json.NewEncoder(writer).Encode(map[string]any{"keys": []any{rsaJWK(&key.PublicKey, "test-key")}})
		case "/token":
			if err := request.ParseForm(); err != nil {
				t.Fatal(err)
			}
			if request.Form.Get("code_verifier") != "pkce-verifier" {
				t.Fatalf("code_verifier = %q", request.Form.Get("code_verifier"))
			}
			token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
				"iss": issuer, "aud": clientID, "sub": "subject-123",
				"email": "user@example.com", "email_verified": true,
				"name": "Keycloak User", "nonce": nonce,
				"iat": time.Now().Unix(), "exp": time.Now().Add(time.Minute).Unix(),
				"realm_access":    map[string]any{"roles": []string{"employee"}},
				"resource_access": map[string]any{clientID: map[string]any{"roles": []string{"jaslide-admin"}}},
			})
			token.Header["kid"] = "test-key"
			signed, err := token.SignedString(key)
			if err != nil {
				t.Fatal(err)
			}
			writer.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(writer).Encode(map[string]any{
				"access_token": "access", "token_type": "Bearer", "expires_in": 300, "id_token": signed,
			})
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()
	issuer = server.URL

	keycloak, err := NewKeycloak(KeycloakConfig{
		Issuer: issuer, ClientID: clientID, RedirectURI: "https://jaslide.example/api/auth/keycloak/callback",
	}, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	identity, err := keycloak.Exchange(context.Background(), "authorization-code", "pkce-verifier", nonce)
	if err != nil {
		t.Fatal(err)
	}
	if identity.Issuer != issuer || identity.Subject != "subject-123" ||
		identity.Email != "user@example.com" || strings.Join(identity.Roles, ",") != "employee,jaslide-admin" {
		t.Fatalf("identity = %#v", identity)
	}

	if _, err := keycloak.Exchange(context.Background(), "authorization-code", "pkce-verifier", "wrong-nonce"); err == nil {
		t.Fatal("Exchange() accepted the wrong nonce")
	}
}

func TestKeycloakRejectsInvalidIDTokens(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(jwt.MapClaims)
		none   bool
	}{
		{
			name: "wrong issuer",
			mutate: func(claims jwt.MapClaims) {
				claims["iss"] = "https://attacker.example/realms/company"
			},
		},
		{
			name: "wrong audience",
			mutate: func(claims jwt.MapClaims) {
				claims["aud"] = "another-client"
			},
		},
		{
			name: "expired",
			mutate: func(claims jwt.MapClaims) {
				claims["exp"] = time.Now().Add(-time.Minute).Unix()
			},
		},
		{name: "unsigned", none: true},
		{
			name: "unverified email",
			mutate: func(claims jwt.MapClaims) {
				claims["email_verified"] = false
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			key, err := rsa.GenerateKey(rand.Reader, 2048)
			if err != nil {
				t.Fatal(err)
			}
			var issuer string
			const clientID = "jaslide-web"
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				switch request.URL.Path {
				case "/.well-known/openid-configuration":
					_ = json.NewEncoder(writer).Encode(map[string]string{
						"issuer": issuer, "authorization_endpoint": issuer + "/authorize",
						"token_endpoint": issuer + "/token", "jwks_uri": issuer + "/jwks",
					})
				case "/jwks":
					_ = json.NewEncoder(writer).Encode(map[string]any{
						"keys": []any{rsaJWK(&key.PublicKey, "test-key")},
					})
				case "/token":
					claims := jwt.MapClaims{
						"iss": issuer, "aud": clientID, "sub": "subject-123",
						"email": "user@example.com", "email_verified": true,
						"nonce": "expected-nonce", "iat": time.Now().Unix(),
						"exp": time.Now().Add(time.Minute).Unix(),
					}
					if test.mutate != nil {
						test.mutate(claims)
					}
					var signed string
					if test.none {
						token := jwt.NewWithClaims(jwt.SigningMethodNone, claims)
						signed, err = token.SignedString(jwt.UnsafeAllowNoneSignatureType)
					} else {
						token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
						token.Header["kid"] = "test-key"
						signed, err = token.SignedString(key)
					}
					if err != nil {
						http.Error(writer, err.Error(), http.StatusInternalServerError)
						return
					}
					writer.Header().Set("Content-Type", "application/json")
					_ = json.NewEncoder(writer).Encode(map[string]any{
						"access_token": "access", "token_type": "Bearer",
						"expires_in": 300, "id_token": signed,
					})
				default:
					http.NotFound(writer, request)
				}
			}))
			defer server.Close()
			issuer = server.URL

			keycloak, err := NewKeycloak(KeycloakConfig{
				Issuer: issuer, ClientID: clientID,
				RedirectURI: "https://jaslide.example/api/auth/keycloak/callback",
			}, server.Client())
			if err != nil {
				t.Fatal(err)
			}
			if _, err := keycloak.Exchange(
				context.Background(), "authorization-code", "verifier", "expected-nonce",
			); err == nil {
				t.Fatalf("Exchange() accepted %s ID token", test.name)
			}
		})
	}
}

func TestKeycloakRejectsMismatchedState(t *testing.T) {
	if ValidateState("expected-state", "wrong-state") == nil {
		t.Fatal("ValidateState() accepted mismatched state")
	}
}

func sha256Sum(value string) []byte {
	sum := sha256.Sum256([]byte(value))
	return sum[:]
}

func rsaJWK(key *rsa.PublicKey, kid string) map[string]string {
	exponent := big.NewInt(int64(key.E)).Bytes()
	return map[string]string{
		"kty": "RSA", "use": "sig", "alg": "RS256", "kid": kid,
		"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
		"e": base64.RawURLEncoding.EncodeToString(exponent),
	}
}

func TestKeycloakRejectsUnconfiguredClient(t *testing.T) {
	_, err := NewKeycloak(KeycloakConfig{}, http.DefaultClient)
	if err == nil || !strings.Contains(err.Error(), "KEYCLOAK_ISSUER") {
		t.Fatalf("error = %v", err)
	}
}

func ExampleValidateState() {
	fmt.Println(ValidateState("same", "same") == nil)
	// Output: true
}
