package contentsecurity

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"

	"golang.org/x/net/html"
)

const MaxHTMLBytes = 4 << 20

var (
	dangerousElements = map[string]bool{
		"script": true, "iframe": true, "object": true, "embed": true, "applet": true,
		"link": true, "meta": true, "base": true, "form": true, "input": true,
		"button": true, "textarea": true, "select": true, "option": true,
		"foreignobject": true, "animate": true, "animatemotion": true,
		"animatetransform": true, "set": true,
	}
	importRule = regexp.MustCompile(`(?is)@(?:import|charset|namespace)[^;{}]*(?:;|$)`)
	urlRule    = regexp.MustCompile(`(?is)url\s*\(\s*([^)]*?)\s*\)`)
)

func SanitizeHTML(source string) (string, error) {
	if len(source) == 0 || len(source) > MaxHTMLBytes {
		return "", errors.New("HTML template has an invalid size")
	}
	if !utf8.ValidString(source) || strings.ContainsRune(source, '\x00') {
		return "", errors.New("HTML template is not valid UTF-8")
	}
	document, err := html.Parse(strings.NewReader(source))
	if err != nil {
		return "", fmt.Errorf("parse HTML template: %w", err)
	}
	sanitizeNode(document)
	var output bytes.Buffer
	if err := html.Render(&output, document); err != nil {
		return "", fmt.Errorf("render sanitized HTML: %w", err)
	}
	if output.Len() > MaxHTMLBytes {
		return "", errors.New("sanitized HTML template is too large")
	}
	return output.String(), nil
}

func SanitizeTemplateConfig(raw json.RawMessage) (json.RawMessage, error) {
	if len(raw) == 0 {
		return nil, errors.New("template config is required")
	}
	var config map[string]any
	if err := json.Unmarshal(raw, &config); err != nil {
		return nil, errors.New("template config must be valid JSON")
	}
	if value, ok := config["htmlTemplate"].(string); ok && strings.TrimSpace(value) != "" {
		clean, err := SanitizeHTML(value)
		if err != nil {
			return nil, err
		}
		config["htmlTemplate"] = clean
	}
	if values, ok := config["htmlSlides"].([]any); ok {
		if len(values) > 500 {
			return nil, errors.New("template contains too many slides")
		}
		cleaned := make([]string, 0, len(values))
		var total int
		for _, rawSlide := range values {
			slide, ok := rawSlide.(string)
			if !ok {
				return nil, errors.New("template slide must be HTML")
			}
			clean, err := SanitizeHTML(slide)
			if err != nil {
				return nil, err
			}
			total += len(clean)
			if total > 64<<20 {
				return nil, errors.New("template HTML is too large")
			}
			cleaned = append(cleaned, clean)
		}
		config["htmlSlides"] = cleaned
	}
	return json.Marshal(config)
}

func sanitizeNode(node *html.Node) {
	for child := node.FirstChild; child != nil; {
		next := child.NextSibling
		if child.Type == html.ElementNode && dangerousElements[strings.ToLower(child.Data)] {
			node.RemoveChild(child)
			child = next
			continue
		}
		sanitizeAttributes(child)
		if child.Type == html.ElementNode && strings.EqualFold(child.Data, "style") {
			if child.FirstChild != nil && child.FirstChild.Type == html.TextNode {
				child.FirstChild.Data = sanitizeStylesheet(child.FirstChild.Data)
			}
		}
		sanitizeNode(child)
		child = next
	}
}

func sanitizeAttributes(node *html.Node) {
	if node.Type != html.ElementNode {
		return
	}
	result := node.Attr[:0]
	for _, attribute := range node.Attr {
		name := strings.ToLower(attribute.Key)
		if strings.HasPrefix(name, "on") || name == "srcdoc" || name == "formaction" {
			continue
		}
		switch name {
		case "style":
			attribute.Val = sanitizeDeclarations(attribute.Val)
			if attribute.Val == "" {
				continue
			}
		case "href", "xlink:href":
			if !safeLink(attribute.Val, strings.EqualFold(node.Data, "use")) {
				continue
			}
		case "src", "poster", "background":
			if !safeResourceURL(attribute.Val) {
				continue
			}
		}
		result = append(result, attribute)
	}
	node.Attr = result
	if strings.EqualFold(node.Data, "a") {
		node.Attr = append(node.Attr, html.Attribute{Key: "rel", Val: "noopener noreferrer"})
	}
}

func safeLink(raw string, localOnly bool) bool {
	value := strings.TrimSpace(raw)
	if value == "" {
		return false
	}
	if strings.HasPrefix(value, "#") {
		return true
	}
	if localOnly {
		return false
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return false
	}
	if parsed.Scheme == "" {
		return !strings.HasPrefix(value, "//") && !strings.HasPrefix(value, "\\")
	}
	switch strings.ToLower(parsed.Scheme) {
	case "https", "http", "mailto":
		return true
	default:
		return false
	}
}

func safeResourceURL(raw string) bool {
	value := strings.TrimSpace(raw)
	lower := strings.ToLower(value)
	if strings.HasPrefix(lower, "data:image/") {
		for _, kind := range []string{"png;base64,", "jpeg;base64,", "jpg;base64,", "gif;base64,", "webp;base64,"} {
			if strings.HasPrefix(strings.TrimPrefix(lower, "data:image/"), kind) {
				return true
			}
		}
		return false
	}
	parsed, err := url.Parse(value)
	return err == nil && parsed.Scheme == "" && value != "" &&
		!strings.HasPrefix(value, "//") && !strings.HasPrefix(value, "\\")
}

func sanitizeStylesheet(source string) string {
	source = importRule.ReplaceAllString(source, "")
	var output strings.Builder
	for _, block := range strings.Split(source, "}") {
		parts := strings.SplitN(block, "{", 2)
		if len(parts) != 2 || strings.Contains(parts[0], "@") {
			continue
		}
		declarations := sanitizeDeclarations(parts[1])
		if declarations != "" {
			output.WriteString(parts[0])
			output.WriteByte('{')
			output.WriteString(declarations)
			output.WriteByte('}')
		}
	}
	return output.String()
}

func sanitizeDeclarations(source string) string {
	var safe []string
	for _, declaration := range strings.Split(source, ";") {
		parts := strings.SplitN(declaration, ":", 2)
		if len(parts) != 2 {
			continue
		}
		property := strings.ToLower(strings.TrimSpace(parts[0]))
		value := strings.TrimSpace(parts[1])
		lower := strings.ToLower(value)
		if property == "" || strings.HasPrefix(property, "--") ||
			property == "behavior" || property == "-moz-binding" ||
			strings.Contains(lower, "expression(") || strings.Contains(lower, "javascript:") ||
			strings.Contains(lower, "vbscript:") || strings.Contains(lower, "@import") {
			continue
		}
		validURLs := true
		value = urlRule.ReplaceAllStringFunc(value, func(match string) string {
			sub := urlRule.FindStringSubmatch(match)
			resource := ""
			if len(sub) == 2 {
				resource = strings.Trim(strings.TrimSpace(sub[1]), `"'`)
			}
			if resource == "" || !safeResourceURL(resource) {
				validURLs = false
				return ""
			}
			return `url("` + resource + `")`
		})
		if validURLs {
			safe = append(safe, strings.TrimSpace(parts[0])+":"+value)
		}
	}
	return strings.Join(safe, ";")
}
