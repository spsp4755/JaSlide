package export

import (
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/spsp4755/JaSlide/apps/core-api/internal/renderer"
)

func TestReadValidatedStreamRejectsWrongContentTypeAndMagic(t *testing.T) {
	tests := []struct {
		name, contentType, body, kind string
	}{
		{"wrong MIME", "text/html", "PK\x03\x04deck", "pptx"},
		{"wrong PPTX magic", renderer.PPTXContentType, "<html>failure</html>", "pptx"},
		{"wrong PDF magic", renderer.PDFContentType, "not-pdf", "pdf"},
		{"wrong PNG magic", "image/png", "not-png", "png"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			stream := renderer.Stream{Body: io.NopCloser(strings.NewReader(test.body)), ContentType: test.contentType}
			if _, err := readValidatedStream(stream, test.kind); err == nil {
				t.Fatal("expected renderer stream rejection")
			}
		})
	}
}

func TestReadValidatedStreamAcceptsPPTXPDFAndPNG(t *testing.T) {
	tests := []struct {
		contentType, body, kind string
	}{
		{renderer.PPTXContentType, "PK\x03\x04deck", "pptx"},
		{renderer.PDFContentType, "%PDF-1.7", "pdf"},
		{"image/png", "\x89PNG\r\n\x1a\nrest", "png"},
	}
	for _, test := range tests {
		stream := renderer.Stream{Body: io.NopCloser(strings.NewReader(test.body)), ContentType: test.contentType}
		raw, err := readValidatedStream(stream, test.kind)
		if err != nil || string(raw) != test.body {
			t.Fatalf("%s stream = %q, %v", test.kind, raw, err)
		}
	}
}

type failingReader struct{}

func (failingReader) Read([]byte) (int, error) { return 0, errors.New("stream interrupted") }
func (failingReader) Close() error             { return nil }

func TestReadValidatedStreamReturnsReadFailureBeforeResponse(t *testing.T) {
	stream := renderer.Stream{Body: failingReader{}, ContentType: renderer.PDFContentType}
	if _, err := readValidatedStream(stream, "pdf"); err == nil {
		t.Fatal("expected interrupted stream error")
	}
}
