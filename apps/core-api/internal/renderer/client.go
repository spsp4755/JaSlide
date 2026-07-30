package renderer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"path/filepath"
	"strings"
)

const (
	PPTXContentType = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
	PDFContentType  = "application/pdf"
	maxJSONBytes    = 64 << 20
)

type Client struct {
	baseURL string
	http    *http.Client
}

type Stream struct {
	Body          io.ReadCloser
	ContentType   string
	ContentLength int64
}

func PublicError(error) string {
	return "Renderer request failed"
}

func New(baseURL string, client *http.Client) *Client {
	return &Client{baseURL: strings.TrimRight(baseURL, "/"), http: client}
}

func (client *Client) PostJSON(ctx context.Context, path string, input, output any) error {
	payload, err := json.Marshal(input)
	if err != nil {
		return err
	}
	response, err := client.do(ctx, path, "application/json", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	defer response.Body.Close()
	decoder := json.NewDecoder(io.LimitReader(response.Body, maxJSONBytes))
	if err := decoder.Decode(output); err != nil {
		return fmt.Errorf("decode renderer response: %w", err)
	}
	return nil
}

func (client *Client) PostFile(ctx context.Context, path, filename, contentType string, content []byte, output any) error {
	var payload bytes.Buffer
	writer := multipart.NewWriter(&payload)
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, filepath.Base(filename)))
	header.Set("Content-Type", contentType)
	part, err := writer.CreatePart(header)
	if err != nil {
		return err
	}
	if _, err := part.Write(content); err != nil {
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	response, err := client.do(ctx, path, writer.FormDataContentType(), &payload)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if err := json.NewDecoder(io.LimitReader(response.Body, maxJSONBytes)).Decode(output); err != nil {
		return fmt.Errorf("decode renderer response: %w", err)
	}
	return nil
}

func (client *Client) StreamJSON(ctx context.Context, path string, input any) (Stream, error) {
	payload, err := json.Marshal(input)
	if err != nil {
		return Stream{}, err
	}
	response, err := client.do(ctx, path, "application/json", bytes.NewReader(payload))
	if err != nil {
		return Stream{}, err
	}
	return Stream{
		Body: response.Body, ContentType: response.Header.Get("Content-Type"),
		ContentLength: response.ContentLength,
	}, nil
}

func (client *Client) do(ctx context.Context, path, contentType string, body io.Reader) (*http.Response, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, client.baseURL+path, body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", contentType)
	response, err := client.http.Do(request)
	if err != nil {
		return nil, fmt.Errorf("renderer unavailable: %w", err)
	}
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return response, nil
	}
	defer response.Body.Close()
	detail, _ := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	return nil, fmt.Errorf("renderer status %d: %s", response.StatusCode, strings.TrimSpace(string(detail)))
}
