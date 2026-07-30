package db

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

type User struct {
	ID                  string
	Email               string
	Name                *string
	Image               *string
	Password            *string
	Role                string
	Status              string
	Preferences         json.RawMessage
	MFAEnabled          bool
	MFASecret           *string
	FailedLoginAttempts int
	LockedUntil         *time.Time
	OrganizationID      *string
	LastLoginAt         *time.Time
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

const selectUser = `
	SELECT "id", "email", "name", "image", "password", "role"::text,
		"status"::text, "preferences", "mfaEnabled", "mfaSecret",
		"failedLoginAttempts", "lockedUntil", "organizationId",
		"lastLoginAt", "createdAt", "updatedAt"
	FROM "User"`

func (store *Store) FindUserByEmail(ctx context.Context, email string) (User, error) {
	return scanUser(store.pool.QueryRow(ctx, selectUser+` WHERE "email" = $1`, email))
}

func (store *Store) FindUserByID(ctx context.Context, id string) (User, error) {
	return scanUser(store.pool.QueryRow(ctx, selectUser+` WHERE "id" = $1`, id))
}

func scanUser(row pgx.Row) (User, error) {
	var user User
	err := row.Scan(
		&user.ID, &user.Email, &user.Name, &user.Image, &user.Password,
		&user.Role, &user.Status, &user.Preferences, &user.MFAEnabled,
		&user.MFASecret, &user.FailedLoginAttempts, &user.LockedUntil,
		&user.OrganizationID, &user.LastLoginAt, &user.CreatedAt, &user.UpdatedAt,
	)
	return user, err
}

func (store *Store) RecordFailedLogin(ctx context.Context, userID string, lockedUntil time.Time) error {
	_, err := store.pool.Exec(ctx, `
		UPDATE "User"
		SET "failedLoginAttempts" = "failedLoginAttempts" + 1,
			"lockedUntil" = CASE
				WHEN "failedLoginAttempts" + 1 >= 5 THEN $2::timestamp
				ELSE NULL
			END,
			"updatedAt" = NOW()
		WHERE "id" = $1`, userID, lockedUntil)
	return err
}

func (store *Store) RecordSuccessfulLogin(ctx context.Context, userID string, loggedInAt time.Time) error {
	_, err := store.pool.Exec(ctx, `
		UPDATE "User"
		SET "failedLoginAttempts" = 0, "lockedUntil" = NULL,
			"lastLoginAt" = $2, "updatedAt" = NOW()
		WHERE "id" = $1`, userID, loggedInAt)
	return err
}

func (store *Store) RecordLoginAttempt(
	ctx context.Context,
	email string,
	success bool,
	userID *string,
	ipAddress, userAgent, errorMessage string,
) error {
	id, err := randomID()
	if err != nil {
		return err
	}
	_, err = store.pool.Exec(ctx, `
		INSERT INTO "LoginLog"
			("id", "email", "success", "userId", "ipAddress", "userAgent", "errorMsg")
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		id, email, success, userID, nullable(ipAddress), nullable(userAgent), nullable(errorMessage))
	return err
}

func (store *Store) ResolveKeycloakUser(
	ctx context.Context,
	issuer, subject, email string,
	name, image *string,
	newRole string,
) (User, error) {
	transaction, err := store.pool.Begin(ctx)
	if err != nil {
		return User{}, err
	}
	defer func() { _ = transaction.Rollback(ctx) }()

	providerAccountID := issuer + "|" + subject
	user, err := scanUser(transaction.QueryRow(ctx, linkedKeycloakUserQuery, providerAccountID))
	if err == nil {
		if user.Email != email {
			return User{}, errors.New("Keycloak account email does not match linked user")
		}
		return user, transaction.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return User{}, err
	}

	user, err = scanUser(transaction.QueryRow(ctx, selectUser+` WHERE "email" = $1`, email))
	if errors.Is(err, pgx.ErrNoRows) {
		userID, idErr := randomID()
		if idErr != nil {
			return User{}, idErr
		}
		user, err = scanUser(transaction.QueryRow(ctx, `
			INSERT INTO "User" ("id", "email", "name", "image", "role", "updatedAt")
			VALUES ($1, $2, $3, $4, $5::"UserRole", NOW())
			RETURNING "id", "email", "name", "image", "password", "role"::text,
				"status"::text, "preferences", "mfaEnabled", "mfaSecret",
				"failedLoginAttempts", "lockedUntil", "organizationId",
				"lastLoginAt", "createdAt", "updatedAt"`,
			userID, email, name, image, newRole))
	}
	if err != nil {
		return User{}, err
	}

	accountID, err := randomID()
	if err != nil {
		return User{}, err
	}
	if _, err := transaction.Exec(ctx, `
		INSERT INTO "Account" ("id", "userId", "type", "provider", "providerAccountId")
		VALUES ($1, $2, 'oauth', 'keycloak', $3)`,
		accountID, user.ID, providerAccountID); err != nil {
		return User{}, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return User{}, err
	}
	return user, nil
}

const linkedKeycloakUserQuery = `
	SELECT u."id", u."email", u."name", u."image", u."password", u."role"::text,
		u."status"::text, u."preferences", u."mfaEnabled", u."mfaSecret",
		u."failedLoginAttempts", u."lockedUntil", u."organizationId",
		u."lastLoginAt", u."createdAt", u."updatedAt"
	FROM "Account" a
	JOIN "User" u ON u."id" = a."userId"
	WHERE a."provider" = 'keycloak' AND a."providerAccountId" = $1`

func randomID() (string, error) {
	value := make([]byte, 18)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("generate ID: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func nullable(value string) any {
	if value == "" {
		return nil
	}
	return value
}
