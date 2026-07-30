package auth

import (
	"context"
	"errors"
	"time"

	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrAccountLocked      = errors.New("account is locked")
	ErrAccountUnavailable = errors.New("account is unavailable")
)

type Repository interface {
	FindUserByEmail(context.Context, string) (db.User, error)
	FindUserByID(context.Context, string) (db.User, error)
	RecordFailedLogin(context.Context, string, time.Time) error
	RecordSuccessfulLogin(context.Context, string, time.Time) error
	RecordLoginAttempt(context.Context, string, bool, *string, string, string, string) error
	ResolveKeycloakUser(context.Context, string, string, string, *string, *string, string) (db.User, error)
}

type Service struct {
	store    Repository
	sessions *Sessions
}

type LoginMetadata struct {
	IPAddress string
	UserAgent string
}

func NewService(store Repository, sessions *Sessions) *Service {
	return &Service{store: store, sessions: sessions}
}

func (service *Service) Login(ctx context.Context, email, password string, metadata LoginMetadata) (Principal, string, error) {
	user, err := service.store.FindUserByEmail(ctx, email)
	if err != nil || user.Password == nil {
		_ = service.store.RecordLoginAttempt(ctx, email, false, nil, metadata.IPAddress, metadata.UserAgent, "Invalid credentials")
		return Principal{}, "", ErrInvalidCredentials
	}
	if user.LockedUntil != nil && user.LockedUntil.After(time.Now()) {
		_ = service.store.RecordLoginAttempt(ctx, email, false, &user.ID, metadata.IPAddress, metadata.UserAgent, "Account is locked")
		return Principal{}, "", ErrAccountLocked
	}
	if bcrypt.CompareHashAndPassword([]byte(*user.Password), []byte(password)) != nil {
		if err := service.store.RecordFailedLogin(ctx, user.ID, time.Now().Add(15*time.Minute)); err != nil {
			return Principal{}, "", err
		}
		_ = service.store.RecordLoginAttempt(ctx, email, false, &user.ID, metadata.IPAddress, metadata.UserAgent, "Invalid password")
		return Principal{}, "", ErrInvalidCredentials
	}

	now := time.Now()
	if err := service.store.RecordSuccessfulLogin(ctx, user.ID, now); err != nil {
		return Principal{}, "", err
	}
	_ = service.store.RecordLoginAttempt(ctx, email, true, &user.ID, metadata.IPAddress, metadata.UserAgent, "")

	principal := principalFromUser(user)
	token, err := service.sessions.Issue(principal)
	return principal, token, err
}

func principalFromUser(user db.User) Principal {
	return Principal{
		ID:             user.ID,
		Email:          user.Email,
		Name:           user.Name,
		Image:          user.Image,
		Role:           user.Role,
		OrganizationID: user.OrganizationID,
		Status:         user.Status,
	}
}

func (service *Service) BeginKeycloakTransaction(transaction KeycloakTransaction) (string, error) {
	return service.sessions.IssueKeycloakTransaction(transaction)
}

func (service *Service) CompleteKeycloakTransaction(raw string) (KeycloakTransaction, error) {
	return service.sessions.VerifyKeycloakTransaction(raw)
}

func (service *Service) LoginWithKeycloak(ctx context.Context, identity KeycloakIdentity, adminRoles []string) (Principal, string, error) {
	role := "USER"
	for _, identityRole := range identity.Roles {
		for _, adminRole := range adminRoles {
			if identityRole == adminRole {
				role = "ADMIN"
			}
		}
	}
	user, err := service.store.ResolveKeycloakUser(
		ctx, identity.Issuer, identity.Subject, identity.Email, identity.Name, identity.Image, role,
	)
	if err != nil || user.Email != identity.Email {
		return Principal{}, "", ErrInvalidCredentials
	}
	if user.Status == "SUSPENDED" || user.Status == "INACTIVE" ||
		(user.LockedUntil != nil && user.LockedUntil.After(time.Now())) {
		return Principal{}, "", ErrAccountUnavailable
	}
	principal := principalFromUser(user)
	token, err := service.sessions.Issue(principal)
	return principal, token, err
}
