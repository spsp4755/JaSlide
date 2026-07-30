package db

import (
	"context"
	"encoding/json"
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
