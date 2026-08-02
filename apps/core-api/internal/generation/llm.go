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
	"time"

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

func (client *OpenAIClient) Critique(ctx context.Context, input CritiqueRequest) (string, error) {
	var feedback string
	prompt := fmt.Sprintf(
		"Review this generated slide JSON against its title and key points. Check: (1) every key point is reflected "+
			"somewhere in the content, (2) bullets are concrete and specific, not generic filler, (3) the heading "+
			"matches what the body/bullets actually say. Title: %s. Key points: %s. Slide JSON: %s. "+
			"Return JSON only: {\"approved\":true} if it's fine, or {\"approved\":false,\"feedback\":\"specific "+
			"instruction to fix it\"} if not.",
		input.Title, strings.Join(input.KeyPoints, "; "), input.Content,
	)
	err := client.validated(ctx, "You are a presentation content reviewer. Return JSON only.", prompt, func(raw json.RawMessage) error {
		var value struct {
			Approved bool   `json:"approved"`
			Feedback string `json:"feedback"`
		}
		if json.Unmarshal(raw, &value) != nil {
			return errors.New("invalid critique response")
		}
		if !value.Approved && strings.TrimSpace(value.Feedback) == "" {
			return errors.New("rejected critique must include feedback")
		}
		if !value.Approved {
			feedback = value.Feedback
		}
		return nil
	})
	return feedback, err
}

func (client *OpenAIClient) CritiqueOutline(ctx context.Context, outline Outline, content string) (Outline, bool, error) {
	raw, err := json.Marshal(outline)
	if err != nil {
		return outline, false, err
	}
	prompt := fmt.Sprintf(
		"Review this presentation outline as a whole against its source content. Check: (1) slide order and flow "+
			"-- does the deck progress logically with no jarring jumps, (2) duplication and coverage -- do any two "+
			"slides overlap, and are the source content's topics covered without gaps, (3) slide count and "+
			"distribution -- is any single slide overloaded or starved relative to the others. "+
			"Source content: %s. Outline JSON: %s. "+
			"Return JSON only: {\"approved\":true} if it's fine, or {\"approved\":false,\"outline\":{...corrected "+
			"outline, same JSON shape as the input}} if not.",
		content, raw,
	)
	var result Outline
	changed := false
	err = client.validated(ctx, "You are a presentation outline reviewer. Return JSON only.", prompt, func(raw json.RawMessage) error {
		var value struct {
			Approved bool            `json:"approved"`
			Outline  json.RawMessage `json:"outline"`
		}
		if json.Unmarshal(raw, &value) != nil {
			return errors.New("invalid outline critique response")
		}
		if !value.Approved {
			if len(value.Outline) == 0 {
				return errors.New("rejected outline critique must include a corrected outline")
			}
			// Cap slightly above the original count -- a legitimate correction may
			// merge or split a slide or two, but must not balloon the deck size.
			corrected, parseErr := parseOutline(value.Outline, len(outline.Slides)+2, 0)
			if parseErr != nil {
				return parseErr
			}
			result = corrected
			changed = true
		}
		return nil
	})
	if err != nil {
		return outline, false, err
	}
	if !changed {
		return outline, false, nil
	}
	return result, true, nil
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
	if bullets := parseBullets(value["bullets"], 5); len(bullets) > 0 {
		result["bullets"] = bullets
	}
	if chart := validChart(value["chart"]); chart != nil {
		result["chart"] = chart
	} else if slideType == "CHART" {
		result["chart"] = map[string]any{
			"labels": []string{"Current", "Target"}, "values": []float64{60, 35},
			"series": "Example", "isExample": true,
		}
	}
	if table := validTable(value["table"]); table != nil {
		result["table"] = table
	} else if slideType == "TABLE" {
		if chartTable := tableFromChart(value["chart"]); chartTable != nil {
			// Some models (esp. small local ones) put real tabular data under
			// "chart" instead of the requested "table" key; reuse it rather than
			// discarding it for a placeholder.
			result["table"] = chartTable
		} else {
			result["table"] = map[string]any{
				"headers": []string{"항목", "값"}, "rows": [][]string{{"예시", "-"}}, "isExample": true,
			}
		}
	}
	if columns := validColumns(value["columns"]); columns != nil {
		result["columns"] = columns
	}
	if timeline := validTimeline(value["timeline"]); timeline != nil {
		result["timeline"] = timeline
	}
	if process := validProcess(value["process"]); process != nil {
		result["process"] = process
	}
	if comparison := validComparison(value["comparison"]); comparison != nil {
		result["comparison"] = comparison
	}
	if kpi := validKPI(value["metrics"]); kpi != nil {
		result["metrics"] = kpi
	}
	return json.Marshal(result)
}

// parseBullets extracts up to `limit` well-formed bullets ({text, level})
// from raw. Shared by the top-level "bullets" field and each TWO_COLUMN
// column's own bullets so both follow the exact same rules.
func parseBullets(raw any, limit int) []map[string]any {
	rawBullets, ok := raw.([]any)
	if !ok {
		return nil
	}
	var bullets []map[string]any
	for _, item := range rawBullets {
		if len(bullets) == limit {
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
				if raw, ok := bullet["level"].(float64); ok && raw == float64(int(raw)) && raw >= 0 && raw <= 4 {
					level = int(raw)
				}
				bullets = append(bullets, map[string]any{"text": text, "level": level})
			}
		}
	}
	return bullets
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

// tableFromChart turns a valid chart's labels/values into a two-column table,
// for models that put real data under "chart" when asked for "table".
func tableFromChart(raw any) map[string]any {
	chart := validChart(raw)
	if chart == nil {
		return nil
	}
	labels := chart["labels"].([]any)
	values := chart["values"].([]any)
	rows := make([][]string, len(labels))
	for index := range labels {
		rows[index] = []string{labels[index].(string), fmt.Sprintf("%g", values[index].(float64))}
	}
	return map[string]any{"headers": []string{"항목", "값"}, "rows": rows}
}

func validTable(raw any) map[string]any {
	table, ok := raw.(map[string]any)
	if !ok {
		return nil
	}
	rawHeaders, headersOK := table["headers"].([]any)
	rawRows, rowsOK := table["rows"].([]any)
	if !headersOK || !rowsOK || len(rawHeaders) < 1 || len(rawHeaders) > 8 || len(rawRows) < 1 || len(rawRows) > 12 {
		return nil
	}
	headers := make([]string, len(rawHeaders))
	for index, value := range rawHeaders {
		text, ok := value.(string)
		if !ok || strings.TrimSpace(text) == "" {
			return nil
		}
		headers[index] = text
	}
	rows := make([][]string, len(rawRows))
	for rowIndex, rawRow := range rawRows {
		cells, ok := rawRow.([]any)
		if !ok || len(cells) != len(headers) {
			return nil
		}
		row := make([]string, len(cells))
		for cellIndex, value := range cells {
			text, ok := value.(string)
			if !ok {
				return nil
			}
			row[cellIndex] = text
		}
		rows[rowIndex] = row
	}
	return map[string]any{"headers": headers, "rows": rows}
}

// maxColumnBullets caps how many bullets a single TWO_COLUMN column can
// carry — generous enough for a real weekly report's ~11-item list.
const maxColumnBullets = 20

// validColumns requires exactly two columns, each with a non-empty header
// and at least one bullet, for TWO_COLUMN slides like a weekly report's
// "this week" / "next week" layout. Returns nil (no error, no placeholder)
// for anything else — the caller falls back to the flat "bullets" field.
func validColumns(raw any) []map[string]any {
	rawColumns, ok := raw.([]any)
	if !ok || len(rawColumns) != 2 {
		return nil
	}
	columns := make([]map[string]any, 2)
	for index, rawColumn := range rawColumns {
		column, ok := rawColumn.(map[string]any)
		if !ok {
			return nil
		}
		header, ok := column["header"].(string)
		if !ok || strings.TrimSpace(header) == "" {
			return nil
		}
		bullets := parseBullets(column["bullets"], maxColumnBullets)
		if len(bullets) == 0 {
			return nil
		}
		columns[index] = map[string]any{"header": header, "bullets": bullets}
	}
	return columns
}

// validTimeline requires 3-8 items, each with a non-empty label. date and
// description are optional strings, kept as-is when present.
func validTimeline(raw any) map[string]any {
	timeline, ok := raw.(map[string]any)
	if !ok {
		return nil
	}
	rawItems, ok := timeline["items"].([]any)
	if !ok || len(rawItems) < 3 || len(rawItems) > 8 {
		return nil
	}
	items := make([]map[string]any, len(rawItems))
	for index, rawItem := range rawItems {
		item, ok := rawItem.(map[string]any)
		if !ok {
			return nil
		}
		label, ok := item["label"].(string)
		if !ok || strings.TrimSpace(label) == "" {
			return nil
		}
		entry := map[string]any{"label": label}
		if date, ok := item["date"].(string); ok && strings.TrimSpace(date) != "" {
			entry["date"] = date
		}
		if description, ok := item["description"].(string); ok && strings.TrimSpace(description) != "" {
			entry["description"] = description
		}
		items[index] = entry
	}
	return map[string]any{"items": items}
}

// validProcess requires 2-6 steps, each with a non-empty label.
func validProcess(raw any) map[string]any {
	process, ok := raw.(map[string]any)
	if !ok {
		return nil
	}
	rawSteps, ok := process["steps"].([]any)
	if !ok || len(rawSteps) < 2 || len(rawSteps) > 6 {
		return nil
	}
	steps := make([]map[string]any, len(rawSteps))
	for index, rawStep := range rawSteps {
		step, ok := rawStep.(map[string]any)
		if !ok {
			return nil
		}
		label, ok := step["label"].(string)
		if !ok || strings.TrimSpace(label) == "" {
			return nil
		}
		entry := map[string]any{"label": label}
		if description, ok := step["description"].(string); ok && strings.TrimSpace(description) != "" {
			entry["description"] = description
		}
		steps[index] = entry
	}
	return map[string]any{"steps": steps}
}

// validComparison requires both "left" and "right" sides, each with a
// non-empty title and at least one bullet (reusing parseBullets so a side's
// bullets follow the exact same string-or-object rules as everywhere else).
func validComparison(raw any) map[string]any {
	comparison, ok := raw.(map[string]any)
	if !ok {
		return nil
	}
	sides := make(map[string]map[string]any, 2)
	for _, key := range []string{"left", "right"} {
		rawSide, ok := comparison[key].(map[string]any)
		if !ok {
			return nil
		}
		title, ok := rawSide["title"].(string)
		if !ok || strings.TrimSpace(title) == "" {
			return nil
		}
		bullets := parseBullets(rawSide["bullets"], 6)
		if len(bullets) == 0 {
			return nil
		}
		sides[key] = map[string]any{"title": title, "bullets": bullets}
	}
	return map[string]any{"left": sides["left"], "right": sides["right"]}
}

// validKPI requires 2-6 metric cards, each with a non-empty value and label.
func validKPI(raw any) map[string]any {
	kpi, ok := raw.(map[string]any)
	if !ok {
		return nil
	}
	rawMetrics, ok := kpi["metrics"].([]any)
	if !ok || len(rawMetrics) < 2 || len(rawMetrics) > 6 {
		return nil
	}
	metrics := make([]map[string]any, len(rawMetrics))
	for index, rawMetric := range rawMetrics {
		metric, ok := rawMetric.(map[string]any)
		if !ok {
			return nil
		}
		value, ok := metric["value"].(string)
		if !ok || strings.TrimSpace(value) == "" {
			return nil
		}
		label, ok := metric["label"].(string)
		if !ok || strings.TrimSpace(label) == "" {
			return nil
		}
		metrics[index] = map[string]any{"value": value, "label": label}
	}
	return map[string]any{"metrics": metrics}
}

// weekRanges returns "YYYY.MM.DD ~ YYYY.MM.DD" for the Monday-Friday of the
// week containing now, and for the following week — computed once here so
// the model never has to do date arithmetic itself. Sunday counts as the
// last day of the preceding Monday-Friday week.
func weekRanges(now time.Time) (thisWeek, nextWeek string) {
	offset := (int(now.Weekday()) + 6) % 7
	monday := now.AddDate(0, 0, -offset)
	format := func(monday time.Time) string {
		friday := monday.AddDate(0, 0, 4)
		return monday.Format("2006.01.02") + " ~ " + friday.Format("2006.01.02")
	}
	return format(monday), format(monday.AddDate(0, 0, 7))
}

// dateGuidance is appended to every outline/content prompt so a skill that
// needs "this week" / "next week" dates (e.g. a weekly report) can copy an
// already-computed value instead of asking the model to calculate one.
func dateGuidance() string {
	now := time.Now()
	thisWeek, nextWeek := weekRanges(now)
	return fmt.Sprintf(
		" Today is %s. This week (Mon-Fri): %s. Next week (Mon-Fri): %s. "+
			"Use these dates unless the user explicitly states a different period.",
		now.Format("2006.01.02"), thisWeek, nextWeek,
	)
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
	guidance := "\nChoose each slide's type by its content: TABLE for row/column data such as comparisons, schedules, or structured records; CHART for numeric trends or comparisons; BULLET_LIST for simple lists; TITLE for section covers; CONTENT for narrative slides; TIMELINE for chronological roadmaps or schedules; PROCESS for sequential step-by-step flows; COMPARISON for two-sided comparisons; KPI for a dashboard of key metrics."
	return fmt.Sprintf(
		"Create exactly %d presentation slides in %s from this source:\n%s%s%s%s%s\nReturn JSON only: {\"title\":\"Deck\",\"slides\":[{\"order\":1,\"title\":\"Title\",\"type\":\"CONTENT\",\"keyPoints\":[\"specific point\"],\"templateIndex\":0}]}",
		input.SlideCount, input.Language, truncate(input.Content, 10000), catalog, continuation, guidance, dateGuidance(),
	)
}

func slidePrompt(input SlideRequest) string {
	guidance := ""
	if strings.TrimSpace(input.SkillGuidance) != "" {
		guidance = "\n\n[Writing Skill Guide]\n" + input.SkillGuidance
	}
	return fmt.Sprintf(
		"Create concise slide content in %s. Title: %s. Type: %s. Key points: %s. "+
			"Return JSON only with heading, optional subheading/body, 3-5 bullets "+
			"(each an object with text and level 0-4 for indentation), "+
			"chart for CHART as {\"labels\":[\"...\"],\"values\":[0]}, "+
			"table for TABLE as {\"headers\":[\"...\"],\"rows\":[[\"...\"]]}, "+
			"columns for TWO_COLUMN as exactly two {\"header\":\"...\",\"bullets\":[{\"text\":\"...\",\"level\":0}]} objects, "+
			"timeline for TIMELINE as {\"items\":[{\"date\":\"...\",\"label\":\"...\",\"description\":\"...\"}]} with 3-8 items, "+
			"process for PROCESS as {\"steps\":[{\"label\":\"...\",\"description\":\"...\"}]} with 2-6 steps, "+
			"comparison for COMPARISON as {\"left\":{\"title\":\"...\",\"bullets\":[\"...\"]},\"right\":{\"title\":\"...\",\"bullets\":[\"...\"]}}, "+
			"and metrics for KPI as {\"metrics\":[{\"value\":\"...\",\"label\":\"...\"}]} with 2-6 cards.%s%s",
		input.Language, input.Title, input.Type, strings.Join(input.KeyPoints, "; "), dateGuidance(), guidance,
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
