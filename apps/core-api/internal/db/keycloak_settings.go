package db

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// KeycloakSettings is the one editable row an admin manages at
// /admin/settings/keycloak. There is exactly one row (id "default"); a
// missing row means SSO has never been configured through the admin UI yet
// and env-var defaults apply instead.
type KeycloakSettings struct {
	Issuer       string
	ClientID     string
	ClientSecret string
	RedirectURI  string
	AdminRoles   string
}

// GetKeycloakSettings returns the zero value (not an error) when no row has
// been saved yet — callers fall back to environment-variable configuration.
func (store *Store) GetKeycloakSettings(ctx context.Context) (KeycloakSettings, error) {
	var settings KeycloakSettings
	err := store.pool.QueryRow(ctx, `
		SELECT "issuer","clientId","clientSecret","redirectUri","adminRoles"
		FROM "KeycloakSetting" WHERE "id"='default'`).
		Scan(&settings.Issuer, &settings.ClientID, &settings.ClientSecret, &settings.RedirectURI, &settings.AdminRoles)
	if errors.Is(err, pgx.ErrNoRows) {
		return KeycloakSettings{}, nil
	}
	return settings, err
}

func (store *Store) SaveKeycloakSettings(ctx context.Context, settings KeycloakSettings) error {
	_, err := store.pool.Exec(ctx, `
		INSERT INTO "KeycloakSetting" ("id","issuer","clientId","clientSecret","redirectUri","adminRoles","updatedAt")
		VALUES ('default',$1,$2,$3,$4,$5,now())
		ON CONFLICT ("id") DO UPDATE SET
			"issuer"=$1,"clientId"=$2,"clientSecret"=$3,"redirectUri"=$4,"adminRoles"=$5,"updatedAt"=now()`,
		settings.Issuer, settings.ClientID, settings.ClientSecret, settings.RedirectURI, settings.AdminRoles)
	return err
}
