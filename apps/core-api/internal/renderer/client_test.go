package renderer

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestClientRejectsMalformedJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(writer, `not-json`)
	}))
	defer server.Close()

	client := New(server.URL, &http.Client{Timeout: time.Second})
	var result map[string]any
	if err := client.PostJSON(context.Background(), "/extract", map[string]string{"x": "y"}, &result); err == nil {
		t.Fatal("PostJSON accepted malformed JSON")
	}
}

func TestClientHonorsTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		time.Sleep(200 * time.Millisecond)
	}))
	defer server.Close()

	client := New(server.URL, &http.Client{Timeout: 20 * time.Millisecond})
	var result map[string]any
	if err := client.PostJSON(context.Background(), "/slow", map[string]string{}, &result); err == nil {
		t.Fatal("PostJSON timeout error = nil")
	}
}

func TestClientStreamsPPTXAndPDF(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		switch request.URL.Path {
		case "/api/render/pptx":
			writer.Header().Set("Content-Type", PPTXContentType)
			_, _ = io.WriteString(writer, "pptx-bytes")
		case "/api/render/pdf":
			writer.Header().Set("Content-Type", PDFContentType)
			_, _ = io.WriteString(writer, "pdf-bytes")
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	client := New(server.URL, server.Client())
	for _, test := range []struct {
		path, contentType, body string
	}{
		{"/api/render/pptx", PPTXContentType, "pptx-bytes"},
		{"/api/render/pdf", PDFContentType, "pdf-bytes"},
	} {
		stream, err := client.StreamJSON(context.Background(), test.path, map[string]any{"presentation": map[string]any{}})
		if err != nil {
			t.Fatal(err)
		}
		raw, err := io.ReadAll(stream.Body)
		_ = stream.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
		if stream.ContentType != test.contentType || strings.TrimSpace(string(raw)) != test.body {
			t.Fatalf("%s stream = %q %q", test.path, stream.ContentType, raw)
		}
	}
}

func TestPublicErrorNeverContainsRendererAddressOrResponseBody(t *testing.T) {
	message := PublicError(fmt.Errorf(`renderer status 500 from http://renderer.internal:8000: dial tcp 10.0.0.8:8000 secret-token`))
	for _, secret := range []string{"renderer.internal", "10.0.0.8", "secret-token", "8000"} {
		if strings.Contains(message, secret) {
			t.Fatalf("public renderer error leaked %q: %s", secret, message)
		}
	}
}
