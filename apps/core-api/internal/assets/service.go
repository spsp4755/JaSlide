package assets

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
)

var (
	ErrNotFound   = errors.New("not found")
	ErrBadRequest = errors.New("bad request")
)

type Repository interface {
	CreateAsset(context.Context, db.AssetCreate) (db.Asset, error)
	ListAssets(context.Context, string, *string) ([]db.Asset, error)
	GetAsset(context.Context, string) (db.Asset, error)
	DeleteAsset(context.Context, string, string) (db.Asset, error)
}

type Service struct {
	store Repository
	root  string
}

func NewService(store Repository, root string) *Service {
	return &Service{store: store, root: filepath.Clean(root)}
}

func (service *Service) Upload(ctx context.Context, userID, filename, mimeType, assetType string, data []byte) (db.Asset, error) {
	if !safeFilename(filename) {
		return db.Asset{}, ErrBadRequest
	}
	if !assetTypes[assetType] {
		return db.Asset{}, ErrBadRequest
	}
	id, err := assetID()
	if err != nil {
		return db.Asset{}, err
	}
	key := filepath.ToSlash(filepath.Join("uploads", id+"-"+filename))
	target, err := localPath(service.root, key)
	if err != nil {
		return db.Asset{}, ErrBadRequest
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return db.Asset{}, err
	}
	temporary, err := os.CreateTemp(filepath.Dir(target), ".upload-*")
	if err != nil {
		return db.Asset{}, err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if _, err := temporary.Write(data); err != nil {
		_ = temporary.Close()
		return db.Asset{}, err
	}
	if err := temporary.Close(); err != nil {
		return db.Asset{}, err
	}
	if err := os.Rename(temporaryName, target); err != nil {
		return db.Asset{}, err
	}
	publicURL := "/uploads/" + key
	asset, err := service.store.CreateAsset(ctx, db.AssetCreate{
		ID: id, Type: assetType, Name: filename, URL: publicURL,
		MIMEType: mimeType, UserID: userID, Size: len(data),
	})
	if err != nil {
		_ = os.Remove(target)
		return db.Asset{}, err
	}
	return asset, nil
}

func (service *Service) List(ctx context.Context, userID string, assetType *string) ([]db.Asset, error) {
	if assetType != nil && !assetTypes[*assetType] {
		return nil, ErrBadRequest
	}
	return service.store.ListAssets(ctx, userID, assetType)
}

func (service *Service) Get(ctx context.Context, id string) (db.Asset, error) {
	asset, err := service.store.GetAsset(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Asset{}, ErrNotFound
	}
	return asset, err
}

func (service *Service) Delete(ctx context.Context, id, userID string) error {
	asset, err := service.store.DeleteAsset(ctx, id, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	const prefix = "/uploads/"
	if strings.HasPrefix(asset.URL, prefix) {
		target, pathErr := localPath(service.root, strings.TrimPrefix(asset.URL, prefix))
		if pathErr == nil {
			if err := os.Remove(target); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
	}
	return nil
}

func localPath(root, key string) (string, error) {
	if key == "" || filepath.IsAbs(key) || strings.Contains(key, `\`) {
		return "", ErrBadRequest
	}
	root = filepath.Clean(root)
	target := filepath.Clean(filepath.Join(root, filepath.FromSlash(key)))
	if target == root || !strings.HasPrefix(target, root+string(os.PathSeparator)) {
		return "", ErrBadRequest
	}
	return target, nil
}

func safeFilename(name string) bool {
	if name == "" || name == "." || name == ".." || filepath.Base(name) != name ||
		strings.ContainsAny(name, `/\<>:"|?*`+"\x00") ||
		strings.HasSuffix(name, " ") || strings.HasSuffix(name, ".") {
		return false
	}
	for _, character := range name {
		if character < 32 {
			return false
		}
	}
	return true
}

func assetID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return "go-" + hex.EncodeToString(value[:]), nil
}

var assetTypes = map[string]bool{
	"IMAGE": true, "ICON": true, "LOGO": true, "BACKGROUND": true, "FONT": true,
}
