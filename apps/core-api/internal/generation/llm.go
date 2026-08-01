package generation

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/spsp4755/JaSlide/apps/core-api/internal/outboundpolicy"
)

const outlineBatchSize = 6

type Model struct {
	ID, Name, Provider, ModelID, Endpoint, APIKey, APIKeyEnvVar string
	MaxTokens                                                   int
	IsActive                                                    bool
}

type EnvironmentModel struct {
	BaseURL, APIKey, Model string
	MaxTokens              int
}

type ModelSource interface {
	DefaultModel(context.Context) (Model, error)
}

type OpenAIClient struct {
	models ModelSource
	http   *http.Client
	env    EnvironmentModel
	policy *outboundpolicy.Policy
}

func NewOpenAIClient(models ModelSource, client *http.Client, env EnvironmentModel, policies ...*outboundpolicy.Policy) *OpenAIClient {
	var policy *outboundpolicy.Policy
	if len(policies) > 0 {
		policy = policies[0]
	}
	return &OpenAIClient{models: models, http: client, env: env, policy: policy}
}

func (client *OpenAIClient) Outline(ctx context.Context, input OutlineRequest) (Outline, error) {
	var result Outline
	used := append([]int(nil), input.UsedIndexes...)
	for len(result.Slides) < input.SlideCount {
		count := min(outlineBatchSize, input.SlideCount-len(result.Slides))
		batchInput := input
		batchInput.SlideCount = count
		batchInput.PriorTitles = append(append([]string(nil), input.PriorTitles...), titles(result.Slides)...)
		batchInput.UsedIndexes = used
		var batch Outline
		if err := client.validated(ctx, outlineSystem, outlinePrompt(batchInput), func(raw json.RawMessage) error {
			var err error
			batch, err = parseOutline(raw, count, len(input.TemplateSlides))
			return err
		}); err != nil {
			return Outline{}, err
		}
		if result.Title == "" {
			result.Title = batch.Title
		}
		for _, slide := range batch.Slides {
			slide.Order = len(result.Slides) + 1
			result.Slides = append(result.Slides, slide)
			if slide.TemplateIndex != nil {
				used = append(used, *slide.TemplateIndex)
			}
		}
	}
	return result, nil
}

func (client *OpenAIClient) SlideContent(ctx context.Context, input SlideRequest) (json.RawMessage, error) {
	var result json.RawMessage
	err := client.validated(ctx, "You are a professional presentation content writer. Return JSON only.",
		slidePrompt(input), func(raw json.RawMessage) error {
			cleaned, err := parseSlideContent(raw, input.Type)
			result = cleaned
			return err
		})
	return result, err
}

func (client *OpenAIClient) Edit(
	ctx context.Context, current json.RawMessage, instruction, slideType string,
) (json.RawMessage, error) {
	var result json.RawMessage
	prompt := fmt.Sprintf("Edit this slide JSON while preserving unmentioned fields.\nCurrent: %s\nInstruction: %s\nReturn JSON only.", current, instruction)
	err := client.validated(ctx, "You are a presentation editor. Return JSON only.", prompt, func(raw json.RawMessage) error {
		cleaned, err := parseSlideContent(raw, slideType)
		result = cleaned
		return err
	})
	return result, err
}

func (client *OpenAIClient) SlideHTML(ctx context.Context, template string, input SlideRequest) (string, error) {
	var result string
	prompt := fmt.Sprintf(
		"Rewrite only human-readable text in this complete HTML slide. Keep DOM, classes, styles, positions and data-object attributes.\nTitle: %s\nKey points: %s\nHTML:\n%s\nReturn JSON only: {\"html\":\"complete HTML\"}",
		input.Title, strings.Join(input.KeyPoints, "; "), template,
	)
	err := client.validated(ctx, "You are a presentation HTML editor. Return JSON only.", prompt, func(raw json.RawMessage) error {
		var value struct {
			HTML string `json:"html"`
		}
		if json.Unmarshal(raw, &value) != nil || strings.TrimSpace(value.HTML) == "" ||
			!strings.Contains(strings.ToLower(value.HTML), "<") {
			return errors.New("invalid slide HTML")
		}
		result = value.HTML
		return nil
	})
	return result, err
}

func (client *OpenAIClient) EditHTML(ctx context.Context, html, instruction string) (string, error) {
	var result string
	prompt := fmt.Sprintf(
		"Edit only human-readable text in this HTML slide. Keep DOM, classes, styles, positions and data-object attributes.\nInstruction: %s\nHTML:\n%s\nReturn JSON only: {\"html\":\"complete HTML\"}",
		instruction, html,
	)
	err := client.validated(ctx, "You are a presentation HTML editor. Return JSON only.", prompt, func(raw json.RawMessage) error {
		var value struct {
			HTML string `json:"html"`
		}
		if json.Unmarshal(raw, &value) != nil || strings.TrimSpace(value.HTML) == "" {
			return errors.New("invalid slide HTML")
		}
		result = value.HTML
		return nil
	})
	return result, err
}

func (client *OpenAIClient) validated(
	ctx context.Context, system, prompt string, validate func(json.RawMessage) error,
) error {
	var validationError error
	for attempt := 0; attempt < 4; attempt++ {
		retryPrompt := prompt
		if validationError != nil {
			retryPrompt += "\nPrevious response was invalid. Correct it and return one JSON object only: " + validationError.Error()
		}
		raw, err := client.chat(ctx, system, retryPrompt)
		if err != nil {
			return err
		}
		raw = extractJSON(raw)
		if !json.Valid(raw) {
			validationError = errors.New("invalid JSON")
			continue
		}
		if err := validate(raw); err != nil {
			validationError = err
			continue
		}
		return nil
	}
	return validationError
}

func (client *OpenAIClient) chat(ctx context.Context, system, prompt string) (json.RawMessage, error) {
	model, err := client.resolveModel(ctx)
	if err != nil {
		return nil, err
	}
	endpoint := strings.TrimRight(model.Endpoint, "/")
	if !strings.HasSuffix(endpoint, "/chat/completions") {
		endpoint += "/chat/completions"
	}
	payload := map[string]any{
		"model": model.ModelID,
		"messages": []map[string]string{
			{"role": "system", "content": system},
			{"role": "user", "content": prompt},
		},
		"temperature": 0.7, "max_tokens": model.MaxTokens,
		"response_format": map[string]string{"type": "json_object"},
	}
	raw, status, err := client.request(ctx, endpoint, model.APIKey, payload)
	if err != nil && status == http.StatusBadRequest {
		delete(payload, "response_format")
		raw, _, err = client.request(ctx, endpoint, model.APIKey, payload)
	}
	if err != nil {
		return nil, err
	}
	var response struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if json.Unmarshal(raw, &response) != nil || len(response.Choices) == 0 ||
		strings.TrimSpace(response.Choices[0].Message.Content) == "" {
		return nil, errors.New("LLM returned no content")
	}
	return json.RawMessage(response.Choices[0].Message.Content), nil
}

func (client *OpenAIClient) request(
	ctx context.Context, endpoint, apiKey string, payload any,
) (json.RawMessage, int, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, 0, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, 0, err
	}
	request.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		request.Header.Set("Authorization", "Bearer "+apiKey)
	}
	response, err := client.http.Do(request)
	if err != nil {
		return nil, 0, fmt.Errorf("LLM unavailable: %w", err)
	}
	defer response.Body.Close()
	raw, readErr := io.ReadAll(io.LimitReader(response.Body, 16<<20))
	if readErr != nil {
		return nil, response.StatusCode, readErr
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, response.StatusCode, fmt.Errorf("LLM status %d: %s", response.StatusCode, strings.TrimSpace(string(raw)))
	}
	return raw, response.StatusCode, nil
}

func (client *OpenAIClient) resolveModel(ctx context.Context) (Model, error) {
	model, err := client.models.DefaultModel(ctx)
	if err == nil && model.IsActive {
		if model.APIKey == "" && model.APIKeyEnvVar != "" {
			model.APIKey, _ = client.policy.APIKeyFromEnvironment(model.APIKeyEnvVar)
		}
		if model.Endpoint == "" && strings.EqualFold(model.Provider, "openai") {
			model.Endpoint = "https://api.openai.com/v1"
		}
		if model.Endpoint == "" {
			return Model{}, errors.New("LLM endpoint is not configured")
		}
		if client.policy != nil {
			if err := client.policy.ValidateEndpoint(model.Endpoint); err != nil {
				return Model{}, err
			}
		} else if _, err := url.ParseRequestURI(model.Endpoint); err != nil {
			return Model{}, errors.New("LLM endpoint is invalid")
		}
		if model.MaxTokens <= 0 {
			model.MaxTokens = 4096
		}
		return model, nil
	}
	if client.env.BaseURL == "" {
		return Model{}, errors.New("No LLM configured")
	}
	if client.policy != nil {
		if err := client.policy.ValidateEndpoint(client.env.BaseURL); err != nil {
			return Model{}, err
		}
	}
	maxTokens := client.env.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 4096
	}
	return Model{
		Provider: "environment", ModelID: defaultString(client.env.Model, "gpt-4-turbo-preview"),
		Endpoint: client.env.BaseURL, APIKey: client.env.APIKey, MaxTokens: maxTokens, IsActive: true,
	}, nil
}

func parseOutline(raw json.RawMessage, count, templateCount int) (Outline, error) {
	var value struct {
		Title  string `json:"title"`
		Slides []struct {
			Order         int      `json:"order"`
			Title         string   `json:"title"`
			Type          string   `json:"type"`
			KeyPoints     []string `json:"keyPoints"`
			TemplateIndex *int     `json:"templateIndex"`
		} `json:"slides"`
	}
	if json.Unmarshal(raw, &value) != nil || strings.TrimSpace(value.Title) == "" {
		return Outline{}, errors.New("outline requires a title")
	}
	result := Outline{Title: value.Title}
	for _, slide := range value.Slides {
		if len(result.Slides) == count {
			break
		}
		if strings.TrimSpace(slide.Title) == "" {
			continue
		}
		if !slideTypes[slide.Type] {
			slide.Type = "CONTENT"
		}
		points := nonEmpty(slide.KeyPoints, 8)
		if len(points) == 0 {
			points = []string{slide.Title}
		}
		index := slide.TemplateIndex
		if index != nil && (*index < 0 || (templateCount > 0 && *index >= templateCount)) {
			index = nil
		}
		result.Slides = append(result.Slides, OutlineSlide{
			Order: len(result.Slides) + 1, Title: slide.Title, Type: slide.Type,
			KeyPoints: points, TemplateIndex: index,
		})
	}
	if len(result.Slides) == 0 {
		return Outline{}, errors.New("outline requires slides")
	}
	return result, nil
}

func parseSlideContent(raw json.RawMessage, slideType string) (json.RawMessage, error) {
	var value map[string]any
	if json.Unmarshal(raw, &value) != nil {
		return nil, errors.New("invalid slide content")
	}
	if nested, ok := value["slide"].(map[string]any); ok {
		value = nested
	}
	heading, ok := value["heading"].(string)
	if !ok || strings.TrimSpace(heading) == "" {
		// ponytail: some models (esp. small local ones) return "title" instead of the
		// requested "heading" key; accept it as a fallback rather than failing generation.
		heading, ok = value["title"].(string)
	}
	if !ok || strings.TrimSpace(heading) == "" {
		return nil, errors.New("slide content requires heading")
	}
	result := map[string]any{"heading": heading}
	for _, field := range []string{"subheading", "body"} {
		if text, ok := value[field].(string); ok && strings.TrimSpace(text) != "" {
			result[field] = text
		}
	}
	if rawBullets, ok := value["bullets"].([]any); ok {
		var bullets []map[string]any
		for _, item := range rawBullets {
			if len(bullets) == 5 {
				break
			}
			switch bullet := item.(type) {
			case string:
				if strings.TrimSpace(bullet) != "" {
					bullets = append(bullets, map[string]any{"text": bullet, "level": 0})
				}
			case map[string]any:
				if text, ok := bullet["text"].(string); ok && strings.TrimSpace(text) != "" {
					level := 0
					if bullet["level"] == float64(1) {
						level = 1
					}
					bullets = append(bullets, map[string]any{"text": text, "level": level})
				}
			}
		}
		if len(bullets) > 0 {
			result["bullets"] = bullets
		}
	}
	if chart := validChart(value["chart"]); chart != nil {
		result["chart"] = chart
	} else if slideType == "CHART" {
		result["chart"] = map[string]any{
			"labels": []string{"Current", "Target"}, "values": []float64{60, 35},
			"series": "Example", "isExample": true,
		}
	}
	return json.Marshal(result)
}

func validChart(raw any) map[string]any {
	chart, ok := raw.(map[string]any)
	if !ok {
		return nil
	}
	labels, labelsOK := chart["labels"].([]any)
	values, valuesOK := chart["values"].([]any)
	if !labelsOK || !valuesOK || len(labels) < 2 || len(labels) > 6 || len(labels) != len(values) {
		return nil
	}
	for _, label := range labels {
		if _, ok := label.(string); !ok {
			return nil
		}
	}
	for _, number := range values {
		if _, ok := number.(float64); !ok {
			return nil
		}
	}
	return chart
}

func outlinePrompt(input OutlineRequest) string {
	catalog := ""
	if len(input.TemplateSlides) > 0 {
		var rows []string
		for index, slide := range input.TemplateSlides {
			rows = append(rows, fmt.Sprintf("%d: %s", index, slide))
		}
		catalog = "\nTemplate slides (choose the best templateIndex):\n" + strings.Join(rows, "\n")
	}
	continuation := ""
	if len(input.PriorTitles) > 0 {
		continuation = "\nContinue after these titles without repetition: " + strings.Join(input.PriorTitles, "; ")
	}
	guidance := "\nChoose each slide's type by its content: TABLE for row/column data such as comparisons, schedules, or structured records; CHART for numeric trends or comparisons; BULLET_LIST for simple lists; TITLE for section covers; CONTENT for narrative slides."
	return fmt.Sprintf(
		"Create exactly %d presentation slides in %s from this source:\n%s%s%s%s\nReturn JSON only: {\"title\":\"Deck\",\"slides\":[{\"order\":1,\"title\":\"Title\",\"type\":\"CONTENT\",\"keyPoints\":[\"specific point\"],\"templateIndex\":0}]}",
		input.SlideCount, input.Language, truncate(input.Content, 10000), catalog, continuation, guidance,
	)
}

func slidePrompt(input SlideRequest) string {
	return fmt.Sprintf(
		"Create concise slide content in %s. Title: %s. Type: %s. Key points: %s. Return JSON only with heading, optional subheading/body, 3-5 bullets and chart for CHART.",
		input.Language, input.Title, input.Type, strings.Join(input.KeyPoints, "; "),
	)
}

func extractJSON(raw json.RawMessage) json.RawMessage {
	text := strings.TrimSpace(string(raw))
	if startFence := strings.Index(text, "```"); startFence >= 0 {
		after := text[startFence+3:]
		after = strings.TrimPrefix(strings.TrimSpace(after), "json")
		if endFence := strings.Index(after, "```"); endFence >= 0 {
			text = strings.TrimSpace(after[:endFence])
		}
	}
	start, end := strings.Index(text, "{"), strings.LastIndex(text, "}")
	if start >= 0 && end > start {
		return json.RawMessage(text[start : end+1])
	}
	return json.RawMessage(text)
}

func nonEmpty(values []string, limit int) []string {
	result := make([]string, 0, min(len(values), limit))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			result = append(result, value)
			if len(result) == limit {
				break
			}
		}
	}
	return result
}

func titles(slides []OutlineSlide) []string {
	result := make([]string, len(slides))
	for index := range slides {
		result[index] = slides[index].Title
	}
	return result
}

func truncate(value string, limit int) string {
	runes := []rune(value)
	if len(runes) > limit {
		runes = runes[:limit]
	}
	return string(runes)
}

func defaultString(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

const outlineSystem = "You are a professional presentation consultant. Return valid JSON only."
