# JaSlide generation engine MVP

## Goal

Generate editable Korean PPTX files in an air-gapped deployment from a topic or document using an OpenAI-compatible internal LLM (including Ollama and vLLM).

## First delivery slice

The first slice makes generated slide data reliable before adding visual complexity:

1. Replace the corrupted Korean prompt text with UTF-8 prompts.
2. Define strict JSON contracts for outlines and slide content.
3. Validate LLM output before it reaches the database.
4. Retry once when a model returns invalid JSON or an invalid slide contract.
5. Reject invalid output with a safe job error instead of saving malformed slides.

The existing OpenAI SDK client remains the single provider adapter. Its configurable `baseURL` already supports OpenAI-compatible internal endpoints, Ollama, and vLLM; no provider-specific client is added.

## Data flow

`generation request -> LlmService -> JSON parse and contract validation -> GenerationService -> Presentation/Slide records -> existing renderer`

The outline must contain the requested number of slides, start with `TITLE`, use known slide types, and provide 2-5 non-empty key points per non-title slide. Slide content must have a non-empty heading and no more than five bullets; each bullet has non-empty text and a non-negative integer level.

## Error handling and tests

One retry is made with a repair instruction when a model response is invalid. A second invalid response throws a clear error and leaves the generation job failed. Unit tests cover valid Korean JSON, malformed JSON repaired on retry, invalid outline rejection, and invalid bullet rejection.

## Next slices

After reliable JSON is verified, add template tokens (fonts, palette, layout), apply them in the PPTX renderer, then render to PDF for Korean-font and text-overflow checks. Example PPT style extraction is a subsequent ingestion slice, not part of this contract layer.
