# LLM Generation Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Korean slide generation from OpenAI-compatible internal LLMs reject malformed output instead of saving broken presentations.

**Architecture:** `LlmService` owns parsing, validation, and one repair retry; `GenerationService` only receives validated outline/content. The existing OpenAI SDK and configurable endpoint remain unchanged.

**Tech Stack:** NestJS, TypeScript, OpenAI SDK, Jest.

## Global Constraints

- Keep compatibility with OpenAI-compatible internal endpoints, Ollama, and vLLM.
- Prompt text is UTF-8 Korean and requests JSON only.
- Invalid model output gets exactly one repair retry and never reaches Prisma.

---

### Task 1: Korean JSON contracts and validated retries

**Files:**
- Modify: `apps/api/src/modules/llm/prompt-template.service.ts`
- Modify: `apps/api/src/modules/llm/llm.service.ts`
- Create: `apps/api/src/modules/llm/llm.service.spec.ts`

**Interfaces:**
- `generateOutline(input): Promise<SlideOutline>` returns exactly the requested number of valid slides.
- `generateSlideContent(input): Promise<SlideContent>` returns a heading and at most five valid bullets.

- [ ] Write failing Jest tests with mocked OpenAI responses for a valid Korean outline, malformed JSON repaired by a second response, an outline with the wrong count, and content with invalid bullet levels.
- [ ] Run `pnpm --filter @jaslide/api test -- llm.service.spec.ts` and confirm failures before production edits.
- [ ] Replace corrupted Korean prompt text with UTF-8 prompts containing the explicit contracts.
- [ ] Add a private JSON parse/validate/retry helper; reject unknown slide types, empty text, invalid counts, and invalid bullet levels.
- [ ] Run the focused tests and then `pnpm --filter @jaslide/api test`; commit only the LLM contract files.
