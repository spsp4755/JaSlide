# Editor Chat Panel UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI chat the editor's default right panel, expose manual editing from the header, and render AI edits immediately.

**Architecture:** Keep the existing editor page and generation endpoint. Replace browser-native resize handles with two pointer-driven boundary dividers. Apply returned `slides` from `/generation/edit` directly to the presentation state, then refresh the preview image.

**Tech Stack:** Next.js, React state, Tailwind CSS, existing Axios client and Node test runner.

## Global Constraints

- Reuse `/generation/edit`; do not add dependencies or backend endpoints.
- Keep explicit numbered-slide targeting; no number means all slides.
- Verify rendered behavior in the local Browser after build.

---

### Task 1: Add a failing editor source test

**Files:**
- Modify: `apps/web/test/editor-ai-chat.test.js`
- Test: `apps/web/test/editor-ai-chat.test.js`

- [ ] **Step 1: Assert the immediate state update contract**

```js
assert.match(source, /const editedSlides = response\.data\.slides/);
assert.match(source, /setPresentation\(\(current\).*editedSlides/s);
assert.match(source, /setPreviewVersion/);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test apps/web/test/editor-ai-chat.test.js`

- [ ] **Step 3: Implement Tasks 2 and 3, then rerun the test**

Run: `node --test apps/web/test/editor-ai-chat.test.js`
Expected: PASS.

### Task 2: Replace native panel resizing and reorganize editor modes

**Files:**
- Modify: `apps/web/src/app/editor/[id]/page.tsx`

- [ ] **Step 1: Remove `resize-x` from both asides**

```tsx
<aside style={{ width: leftPanelWidth }} />
<div role="separator" onPointerDown={startResize('left')} />
```

- [ ] **Step 2: Add pointer-based divider state and handlers**

```ts
const startResize = (side: 'left' | 'right') => (event: React.PointerEvent) => {
  // Clamp pointer-derived widths between the existing min/max values.
};
```

- [ ] **Step 3: Make AI chat the default panel and move manual edit to header**

```tsx
<Button onClick={() => setRightTab('edit')}>수동 편집</Button>
{rightTab === 'edit' && <Button onClick={() => setRightTab('chat')}>AI 채팅으로 돌아가기</Button>}
```

### Task 3: Apply completed AI edits to the canvas immediately

**Files:**
- Modify: `apps/web/src/app/editor/[id]/page.tsx`

- [ ] **Step 1: Use returned slides before the reconciliation fetch**

```ts
const response = await generationApi.edit({ slideIds: targets, instruction });
const editedSlides = response.data.slides ?? [];
setPresentation((current) => current ? {
  ...current,
  slides: current.slides.map((slide) => editedSlides.find((edited: any) => edited.id === slide.id) ?? slide),
} : current);
setPreviewVersion((version) => version + 1);
void fetchPresentation();
```

- [ ] **Step 2: Keep the success and failure chat messages**

```ts
setAiChatMessages((messages) => [...messages, { role: 'assistant', text: `${targets.length}개 슬라이드를 수정했습니다.` }]);
```

### Task 4: Verify the local editor

**Files:**
- Test: `apps/web/test/editor-ai-chat.test.js`

- [ ] **Step 1: Run checks**

Run: `pnpm --filter @jaslide/web test; pnpm --filter @jaslide/web build`
Expected: all tests and production build pass.

- [ ] **Step 2: Rebuild the web container and verify the UI**

Run: `docker compose up -d --build web`

Expected: `http://localhost:3100/editor/cmrvkx2iw0005tqtywb0rodma` returns 200; the AI chat panel, manual-edit button, and boundary divider render without console errors.
