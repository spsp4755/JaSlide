package assets

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
	"github.com/spsp4755/JaSlide/apps/core-api/internal/storagepath"
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
	detectedType, ok := allowedUploadType(assetType, filename, data)
	if !ok {
		return db.Asset{}, ErrBadRequest
	}
	mimeType = detectedType
	id, err := assetID()
	if err != nil {
		return db.Asset{}, err
	}
	key := filepath.ToSlash(filepath.Join("uploads", id+"-"+filename))
	target, err := storagepath.Writable(service.root, key)
	if err != nil {
		return db.Asset{}, ErrBadRequest
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
	asset, err := service.store.GetAsset(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if asset.UserID == nil || *asset.UserID != userID {
		return ErrNotFound
	}
	const prefix = "/uploads/"
	if strings.HasPrefix(asset.URL, prefix) {
		target, pathErr := storagepath.Removable(service.root, strings.TrimPrefix(asset.URL, prefix))
		if pathErr != nil {
			return ErrBadRequest
		}
		if err := os.Remove(target); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	_, err = service.store.DeleteAsset(ctx, id, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
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

func allowedUploadType(assetType, filename string, data []byte) (string, bool) {
	mimeType := detectedMediaType(data)
	extension := strings.ToLower(filepath.Ext(filename))
	allowedExtensions, exists := uploadMediaPolicy[assetType][mimeType]
	if !exists {
		return "", false
	}
	for _, allowed := range allowedExtensions {
		if extension == allowed {
			return mimeType, true
		}
	}
	return "", false
}

func detectedMediaType(data []byte) string {
	switch {
	case bytes.HasPrefix(data, []byte{0x00, 0x01, 0x00, 0x00}),
		bytes.HasPrefix(data, []byte("true")),
		bytes.HasPrefix(data, []byte("typ1")):
		return "font/ttf"
	case bytes.HasPrefix(data, []byte("OTTO")):
		return "font/otf"
	case bytes.HasPrefix(data, []byte("wOFF")):
		return "font/woff"
	case bytes.HasPrefix(data, []byte("wOF2")):
		return "font/woff2"
	default:
		return strings.Split(http.DetectContentType(data), ";")[0]
	}
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

var rasterMedia = map[string][]string{
	"image/png":  {".png"},
	"image/jpeg": {".jpg", ".jpeg"},
	"image/gif":  {".gif"},
	"image/webp": {".webp"},
}

var uploadMediaPolicy = map[string]map[string][]string{
	"IMAGE":      rasterMedia,
	"ICON":       rasterMedia,
	"LOGO":       rasterMedia,
	"BACKGROUND": rasterMedia,
	"FONT": {
		"font/ttf":   {".ttf"},
		"font/otf":   {".otf"},
		"font/woff":  {".woff"},
		"font/woff2": {".woff2"},
	},
}
