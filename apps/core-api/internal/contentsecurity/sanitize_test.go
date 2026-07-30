package contentsecurity

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSanitizeHTMLRemovesExecutableMarkupAndKeepsSlideLayout(t *testing.T) {
	input := `<!doctype html><html><head>
		<link rel="stylesheet" href="https://evil.test/font.css">
		<style>@import "https://evil.test/x"; .slide{position:absolute;color:#123;background:url(javascript:alert(1))}</style>
		</head><body onload="alert(1)">
		<script>alert(1)</script><iframe src="http://metadata.internal"></iframe>
		<div class="slide" style="left:10px;color:#123;behavior:url(x)" onclick="alert(1)">
		<a href="javascript:alert(1)">title</a>
		<img src="data:image/png;base64,iVBORw0KGgo=" onerror="alert(1)">
		<svg><foreignObject><div>bad</div></foreignObject><path d="M0 0 L1 1"/></svg>
		</div></body></html>`

	clean, err := SanitizeHTML(input)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{
		"<script", "<iframe", "<link", "@import", "javascript:", "onload", "onclick", "onerror",
		"behavior:", "foreignObject",
	} {
		if strings.Contains(strings.ToLower(clean), strings.ToLower(forbidden)) {
			t.Fatalf("sanitized HTML still contains %q: %s", forbidden, clean)
		}
	}
	for _, required := range []string{`class="slide"`, "position:absolute", "left:10px", "color:#123", "<svg", "<path", "data:image/png;base64"} {
		if !strings.Contains(clean, required) {
			t.Fatalf("sanitized HTML lost safe layout %q: %s", required, clean)
		}
	}
}

func TestSanitizeHTMLRejectsMalformedAndOversizedDocuments(t *testing.T) {
	if _, err := SanitizeHTML(strings.Repeat("a", MaxHTMLBytes+1)); err == nil {
		t.Fatal("expected oversized HTML to be rejected")
	}
	if _, err := SanitizeHTML("\x00<script>alert(1)</script>"); err == nil {
		t.Fatal("expected NUL-containing HTML to be rejected")
	}
}

func TestSanitizeConfigCleansAllHTMLFields(t *testing.T) {
	raw := []byte(`{"htmlTemplate":"<div onclick='x()'>base</div>","htmlSlides":["<script>x()</script><div>one</div>"],"colors":{"primary":"#000"}}`)
	clean, err := SanitizeTemplateConfig(raw)
	if err != nil {
		t.Fatal(err)
	}
	var config map[string]any
	if err := json.Unmarshal(clean, &config); err != nil {
		t.Fatal(err)
	}
	template, _ := config["htmlTemplate"].(string)
	slides, _ := config["htmlSlides"].([]any)
	if strings.Contains(template, "onclick") || len(slides) != 1 || strings.Contains(slides[0].(string), "<script") {
		t.Fatalf("config remained executable: %s", clean)
	}
	colors, _ := config["colors"].(map[string]any)
	if colors["primary"] != "#000" || !strings.Contains(slides[0].(string), "<div>one</div>") {
		t.Fatalf("config lost safe fields: %s", clean)
	}
}
