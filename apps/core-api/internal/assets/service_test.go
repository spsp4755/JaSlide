package assets

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/spsp4755/JaSlide/apps/core-api/internal/db"
)

type memoryRepository struct {
	asset       db.Asset
	createCalls int
	deleteCalls int
}

func (repository *memoryRepository) CreateAsset(_ context.Context, input db.AssetCreate) (db.Asset, error) {
	repository.createCalls++
	repository.asset = db.Asset{
		ID: input.ID, Type: input.Type, Name: input.Name, URL: input.URL,
		MIMEType: input.MIMEType, Size: input.Size, UserID: &input.UserID,
	}
	return repository.asset, nil
}

func (repository *memoryRepository) ListAssets(context.Context, string, *string) ([]db.Asset, error) {
	return []db.Asset{repository.asset}, nil
}

func (repository *memoryRepository) GetAsset(context.Context, string) (db.Asset, error) {
	return repository.asset, nil
}

func (repository *memoryRepository) DeleteAsset(context.Context, string, string) (db.Asset, error) {
	repository.deleteCalls++
	return repository.asset, nil
}

func TestUploadRejectsHTMLDisguisedAsImage(t *testing.T) {
	root := t.TempDir()
	repository := &memoryRepository{}
	service := NewService(repository, root)

	_, err := service.Upload(
		context.Background(), "user-1", "portrait.png", "image/png", "IMAGE",
		[]byte("<!doctype html><script>top.location='https://attacker.invalid'</script>"),
	)

	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("Upload() error = %v, want ErrBadRequest", err)
	}
	if repository.createCalls != 0 {
		t.Fatalf("CreateAsset() calls = %d, want 0", repository.createCalls)
	}
	entries, readErr := os.ReadDir(root)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if len(entries) != 0 {
		t.Fatalf("upload root contains %d entries, want none", len(entries))
	}
}

func TestUploadEnforcesDetectedMediaPolicyForEachAssetType(t *testing.T) {
	tests := []struct {
		name      string
		filename  string
		assetType string
		data      []byte
	}{
		{name: "image extension must match bytes", filename: "portrait.jpg", assetType: "IMAGE", data: validPNG()},
		{name: "font type cannot contain image", filename: "brand.png", assetType: "FONT", data: validPNG()},
		{name: "image type cannot contain font", filename: "brand.woff2", assetType: "IMAGE", data: []byte("wOF2font-data")},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			repository := &memoryRepository{}
			_, err := NewService(repository, t.TempDir()).Upload(
				context.Background(), "user-1", test.filename, "application/octet-stream",
				test.assetType, test.data,
			)
			if !errors.Is(err, ErrBadRequest) {
				t.Fatalf("Upload() error = %v, want ErrBadRequest", err)
			}
			if repository.createCalls != 0 {
				t.Fatalf("CreateAsset() calls = %d, want 0", repository.createCalls)
			}
		})
	}
}

func TestDownloadForcesLegacyActiveContentToAttachment(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "uploads", "legacy.html")
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte("<script>alert(document.domain)</script>"), 0o644); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/uploads/uploads/legacy.html", nil)
	recorder := httptest.NewRecorder()
	NewDownloadHandler(root).ServeHTTP(recorder, request)
	response := recorder.Result()
	defer response.Body.Close()
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	if got := response.Header.Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q, want nosniff", got)
	}
	if got := response.Header.Get("Content-Disposition"); !strings.HasPrefix(got, "attachment;") {
		t.Fatalf("Content-Disposition = %q, want attachment", got)
	}
	if got := response.Header.Get("Content-Type"); got != "application/octet-stream" {
		t.Fatalf("Content-Type = %q, want application/octet-stream", got)
	}
}

func TestDeleteDoesNotDeleteDatabaseRowWhenFileRemovalFails(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "uploads", "cannot-remove.png")
	if err := os.MkdirAll(filepath.Join(target, "child"), 0o755); err != nil {
		t.Fatal(err)
	}
	userID := "user-1"
	repository := &memoryRepository{asset: db.Asset{
		ID: "asset-1", URL: "/uploads/uploads/cannot-remove.png", UserID: &userID,
	}}
	service := NewService(repository, root)

	err := service.Delete(context.Background(), "asset-1", userID)

	if err == nil {
		t.Fatal("Delete() error = nil, want filesystem error")
	}
	if repository.deleteCalls != 0 {
		t.Fatalf("DeleteAsset() calls = %d, want 0", repository.deleteCalls)
	}
}

func TestDownloadAndDeleteRejectSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	uploads := filepath.Join(root, "uploads")
	if err := os.MkdirAll(uploads, 0o755); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "outside.png")
	if err := os.WriteFile(outside, validPNG(), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(uploads, "escape.png")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symlinks are unavailable: %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/uploads/uploads/escape.png", nil)
	recorder := httptest.NewRecorder()
	NewDownloadHandler(root).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("download status = %d, want 404", recorder.Code)
	}

	userID := "user-1"
	repository := &memoryRepository{asset: db.Asset{
		ID: "asset-1", URL: "/uploads/uploads/escape.png", UserID: &userID,
	}}
	err := NewService(repository, root).Delete(context.Background(), "asset-1", userID)
	if err == nil {
		t.Fatal("Delete() error = nil, want unsafe-path error")
	}
	if repository.deleteCalls != 0 {
		t.Fatalf("DeleteAsset() calls = %d, want 0", repository.deleteCalls)
	}
	file, err := os.Open(outside)
	if err != nil {
		t.Fatalf("outside file was removed: %v", err)
	}
	_, _ = io.Copy(io.Discard, file)
	_ = file.Close()
}

func validPNG() []byte {
	return []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	}
}
