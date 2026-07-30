package db

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
)

type Asset struct {
	ID             string          `json:"id"`
	Type           string          `json:"type"`
	Name           string          `json:"name"`
	URL            string          `json:"url"`
	ThumbnailURL   *string         `json:"thumbnailUrl"`
	Size           int             `json:"size"`
	MIMEType       string          `json:"mimeType"`
	LicenseInfo    json.RawMessage `json:"licenseInfo"`
	UserID         *string         `json:"userId"`
	OrganizationID *string         `json:"organizationId"`
	CreatedAt      time.Time       `json:"createdAt"`
	UpdatedAt      time.Time       `json:"updatedAt"`
}

type AssetCreate struct {
	ID, Type, Name, URL, MIMEType, UserID string
	Size                                  int
}

const selectAsset = `
	SELECT "id","type"::text,"name","url","thumbnailUrl","size","mimeType",
		"licenseInfo","userId","organizationId","createdAt","updatedAt"
	FROM "Asset"`

func (store *Store) CreateAsset(ctx context.Context, input AssetCreate) (Asset, error) {
	_, err := store.pool.Exec(ctx, `
		INSERT INTO "Asset"
			("id","type","name","url","thumbnailUrl","size","mimeType","userId","updatedAt")
		VALUES ($1,$2,$3,$4,$4,$5,$6,$7,NOW())`,
		input.ID, input.Type, input.Name, input.URL, input.Size, input.MIMEType, input.UserID)
	if err != nil {
		return Asset{}, err
	}
	return store.GetAsset(ctx, input.ID)
}

func (store *Store) ListAssets(ctx context.Context, userID string, assetType *string) ([]Asset, error) {
	query := selectAsset + ` WHERE "userId"=$1`
	args := []any{userID}
	if assetType != nil {
		query += ` AND "type"=$2`
		args = append(args, *assetType)
	}
	query += ` ORDER BY "createdAt" DESC`
	rows, err := store.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	assets := make([]Asset, 0)
	for rows.Next() {
		asset, err := scanAsset(rows)
		if err != nil {
			return nil, err
		}
		assets = append(assets, asset)
	}
	return assets, rows.Err()
}

func (store *Store) GetAsset(ctx context.Context, id string) (Asset, error) {
	return scanAsset(store.pool.QueryRow(ctx, selectAsset+` WHERE "id"=$1`, id))
}

func (store *Store) DeleteAsset(ctx context.Context, id, userID string) (Asset, error) {
	asset, err := store.GetAsset(ctx, id)
	if err != nil {
		return Asset{}, err
	}
	if asset.UserID == nil || *asset.UserID != userID {
		return Asset{}, pgx.ErrNoRows
	}
	if _, err := store.pool.Exec(ctx, `DELETE FROM "Asset" WHERE "id"=$1`, id); err != nil {
		return Asset{}, err
	}
	return asset, nil
}

func scanAsset(row pgx.Row) (Asset, error) {
	var asset Asset
	err := row.Scan(
		&asset.ID, &asset.Type, &asset.Name, &asset.URL, &asset.ThumbnailURL,
		&asset.Size, &asset.MIMEType, &asset.LicenseInfo, &asset.UserID,
		&asset.OrganizationID, &asset.CreatedAt, &asset.UpdatedAt,
	)
	return asset, err
}
