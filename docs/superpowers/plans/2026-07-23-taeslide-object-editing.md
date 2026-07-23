# TaeSlide Object Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand JaSlide as TaeSlide and let users edit HTML-slide text and rectangle objects without external services.

**Architecture:** Extend the existing `content.html` mutation helpers in the editor. A selected object retains its DOM target and inline styles; saving the updated HTML uses the existing slide update API and the existing offline Chromium/PPTX renderer consumes the same value.

**Tech Stack:** Next.js, React, TypeScript, Tailwind CSS, existing Chromium renderer and PPTX export.

## Global Constraints

- No Keynote, CDN, cloud editor, or new dependency.
- Existing structured-slide controls remain unchanged.
- HTML object edits remain compatible with the current `data-object="true"` templates.

---

### Task 1: Lock the TaeSlide and object-style contract

**Files:**
- Create: `apps/web/test/taeslide-object-editing.test.js`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/app/editor/[id]/page.tsx`

**Interfaces:**
- Produces `updateHtmlObject(html, index, updates)` for text, position, and CSS-style changes.

- [ ] **Step 1: Write failing source assertions**

```js
assert.match(editor, /function updateHtmlObject/);
assert.match(editor, /fontSize/);
assert.match(editor, /backgroundColor/);
assert.match(layout, /TaeSlide/);
```

- [ ] **Step 2: Run the focused test**

Run: `node --test apps/web/test/taeslide-object-editing.test.js`

Expected: FAIL because the generic object updater and TaeSlide metadata do not exist.

- [ ] **Step 3: Implement generic style mutation and branding**

```ts
if (updates.fontSize !== undefined) element.style.fontSize = `${updates.fontSize}px`;
if (updates.backgroundColor !== undefined) element.style.backgroundColor = updates.backgroundColor;
```

- [ ] **Step 4: Run the focused test**

Run: `node --test apps/web/test/taeslide-object-editing.test.js`

Expected: PASS.

### Task 2: Expose text and shape controls in the existing manual inspector

**Files:**
- Modify: `apps/web/src/app/editor/[id]/page.tsx`
- Test: `apps/web/test/taeslide-object-editing.test.js`

**Interfaces:**
- Consumes selected HTML object IDs and `updateHtmlObject`.
- Produces font family, font size, text/fill/border colors, alignment, geometry, add text, add rectangle, and delete actions.

- [ ] **Step 1: Extend the failing assertions**

```js
assert.match(editor, /addHtmlShape/);
assert.match(editor, /borderColor/);
assert.match(editor, /fontFamily/);
assert.match(editor, /deleteHtmlObject/);
```

- [ ] **Step 2: Run the focused test**

Run: `node --test apps/web/test/taeslide-object-editing.test.js`

Expected: FAIL because these object actions are absent.

- [ ] **Step 3: Implement only the selected-object controls**

```tsx
<input type="color" value={item.color} onChange={(event) => save({ color: event.target.value })} />
<Button onClick={() => save({ html: addHtmlShape(html) })}>도형 추가</Button>
```

- [ ] **Step 4: Run the focused test**

Run: `node --test apps/web/test/taeslide-object-editing.test.js`

Expected: PASS.

### Task 3: Verify offline editor behavior

**Files:**
- No source changes expected.

- [ ] **Step 1: Run web tests and build**

Run: `pnpm --filter @jaslide/web test; pnpm --filter @jaslide/web build`

Expected: all tests pass and the build succeeds.

- [ ] **Step 2: Rebuild local services**

Run: `docker compose up -d --build web api renderer`

Expected: web, API, and renderer containers start.

- [ ] **Step 3: Browser smoke test**

Run: open an HTML template slide, select an object, change a style, reload, and verify the object retains the style.

Expected: visual changes are immediate and persist with no external network request.
