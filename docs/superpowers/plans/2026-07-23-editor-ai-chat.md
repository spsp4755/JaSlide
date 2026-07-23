# Editor AI Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the editor's modal AI edit action with a whole-deck chat tab that routes numbered requests to the right slides.

**Architecture:** Keep the existing `generationApi.aiEdit` endpoint. The editor parses explicit Korean slide-number references from the prompt, maps them to current slide IDs, and sends those IDs to the existing API. Chat history is local React state and the right-side editor area switches between property editing and AI chat.

**Tech Stack:** Next.js 16, React 19, TypeScript, existing JaSlide API client, Node test runner.

## Global Constraints

- Reuse `generationApi.aiEdit`; do not add backend routes or schema.
- A prompt with no valid slide number targets all current slides.
- Support `3번`, `3번 슬라이드`, `3페이지`, `2~4번`, and repeated slide numbers.
- Keep chat history session-only.
- Remove the canvas action button and old AI edit modal.

---

### Task 1: Target parser

**Files:**
- Modify: `apps/web/src/app/editor/[id]/page.tsx`
- Test: `apps/web/test/editor-ai-chat.test.js`

**Interfaces:**
- Produces: `resolveAiEditTargets(instruction: string, slides: Array<{ id: string }>): string[]`
- Consumes: presentation slide order from the editor store.

- [ ] **Step 1: Write the failing test**

```js
assert.match(source, /function resolveAiEditTargets/);
assert.match(source, /2~4/);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @jaslide/web test -- editor-ai-chat.test.js`
Expected: FAIL because the parser is absent.

- [ ] **Step 3: Write minimal implementation**

```ts
function resolveAiEditTargets(instruction: string, slides: Array<{ id: string }>) {
  const numbers = new Set<number>();
  for (const match of instruction.matchAll(/(\d+)\s*[~〜-]\s*(\d+)\s*(?:번|페이지|슬라이드)?/g)) {
    for (let number = Number(match[1]); number <= Number(match[2]); number += 1) numbers.add(number);
  }
  for (const match of instruction.matchAll(/(\d+)\s*(?:번|페이지|슬라이드)/g)) numbers.add(Number(match[1]));
  const ids = [...numbers].map((number) => slides[number - 1]?.id).filter(Boolean);
  return ids.length ? ids : slides.map((slide) => slide.id);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @jaslide/web test`
Expected: PASS.

### Task 2: AI chat tab and existing edit integration

**Files:**
- Modify: `apps/web/src/app/editor/[id]/page.tsx`
- Test: `apps/web/test/editor-ai-chat.test.js`

**Interfaces:**
- Consumes: `resolveAiEditTargets`, `generationApi.aiEdit`, editor `updateSlide`.
- Produces: chat messages `{ role: 'user' | 'assistant', text: string }` in local component state.

- [ ] **Step 1: Write the failing test**

```js
assert.match(source, /AI 채팅/);
assert.match(source, /resolveAiEditTargets\(instruction, presentation\.slides\)/);
assert.doesNotMatch(source, /showAiEditDialog/);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @jaslide/web test -- editor-ai-chat.test.js`
Expected: FAIL because the modal edit state still exists.

- [ ] **Step 3: Write minimal implementation**

```ts
const [rightTab, setRightTab] = useState<'edit' | 'chat'>('edit');
const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);

const targets = resolveAiEditTargets(instruction, presentation.slides);
const result = await generationApi.aiEdit({ slideIds: targets, instruction });
result.data.slides.forEach((slide) => updateSlide(slide.id, slide));
```

Render `Edit` and `AI Chat` tab buttons in the right sidebar. The chat pane renders messages, one textarea, and a send button. On success append a concise completion message; on failure append a retry message. Delete the old canvas button and modal JSX/state.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @jaslide/web test`
Expected: PASS.

### Task 3: Build and local deployment

**Files:**
- No source changes expected.

- [ ] **Step 1: Run production build**

Run: `pnpm --filter @jaslide/web build`
Expected: Next.js build completes with the editor route present.

- [ ] **Step 2: Rebuild local web service**

Run: `docker compose build web && docker compose up -d web && docker compose ps web`
Expected: `jaslide-web` is `Up` on port 3100.

- [ ] **Step 3: Verify the editor response**

Run: `curl.exe -fsS -o NUL -w "%{http_code}" http://localhost:3100/editor/cmrvkx2iw0005tqtywb0rodma`
Expected: `200`.
