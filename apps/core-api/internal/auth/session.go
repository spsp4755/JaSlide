package auth

import (
	"errors"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type Principal struct {
	ID             string  `json:"id"`
	Email          string  `json:"email"`
	Name           *string `json:"name"`
	Image          *string `json:"image"`
	Role           string  `json:"role"`
	OrganizationID *string `json:"organizationId"`
	Status         string  `json:"status,omitempty"`
}

type Sessions struct {
	key      []byte
	lifetime time.Duration
}

type sessionClaims struct {
	Email string `json:"email"`
	jwt.RegisteredClaims
}

type KeycloakTransaction struct {
	State    string
	Nonce    string
	Verifier string
}

type transactionClaims struct {
	State    string `json:"state"`
	Nonce    string `json:"nonce"`
	Verifier string `json:"verifier"`
	jwt.RegisteredClaims
}

func NewSessions(secret string, lifetime time.Duration) (*Sessions, error) {
	if strings.TrimSpace(secret) == "" {
		return nil, errors.New("JWT_SECRET must be configured")
	}
	return &Sessions{key: []byte(secret), lifetime: lifetime}, nil
}

func (sessions *Sessions) Issue(principal Principal) (string, error) {
	now := time.Now()
	return jwt.NewWithClaims(jwt.SigningMethodHS256, sessionClaims{
		Email: principal.Email,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   principal.ID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(sessions.lifetime)),
		},
	}).SignedString(sessions.key)
}

func (sessions *Sessions) Verify(raw string) (string, string, error) {
	claims := new(sessionClaims)
	token, err := jwt.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) {
		return sessions.key, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithExpirationRequired())
	if err != nil || !token.Valid || claims.Subject == "" {
		return "", "", errors.New("invalid session")
	}
	return claims.Subject, claims.Email, nil
}

func (sessions *Sessions) IssueKeycloakTransaction(transaction KeycloakTransaction) (string, error) {
	now := time.Now()
	return jwt.NewWithClaims(jwt.SigningMethodHS256, transactionClaims{
		State: transaction.State, Nonce: transaction.Nonce, Verifier: transaction.Verifier,
		RegisteredClaims: jwt.RegisteredClaims{
			Audience:  jwt.ClaimStrings{"keycloak_login"},
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(10 * time.Minute)),
		},
	}).SignedString(sessions.key)
}

func (sessions *Sessions) VerifyKeycloakTransaction(raw string) (KeycloakTransaction, error) {
	claims := new(transactionClaims)
	token, err := jwt.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) {
		return sessions.key, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithExpirationRequired(), jwt.WithAudience("keycloak_login"))
	if err != nil || !token.Valid || claims.State == "" || claims.Nonce == "" || claims.Verifier == "" {
		return KeycloakTransaction{}, errors.New("invalid Keycloak transaction")
	}
	return KeycloakTransaction{State: claims.State, Nonce: claims.Nonce, Verifier: claims.Verifier}, nil
}
