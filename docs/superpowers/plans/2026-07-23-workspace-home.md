# Workspace Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an extensible workspace home that launches the existing JaSlide AI Slide creation flow.

**Architecture:** Keep `/dashboard` as the slide-generation application. Add `/home` as a lightweight authenticated workspace launcher and pass a home prompt through the existing dashboard query state; the root redirect points signed-in users to `/home`.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, Lucide icons, Node test runner.

## Global Constraints

- Reuse the existing auth store, `AppShell`, and Lucide dependency.
- Do not add backend APIs or dependencies.
- Existing `/dashboard` generation behavior remains unchanged when no query prompt is provided.

---

### Task 1: Add the workspace handoff test

**Files:**
- Create: `apps/web/test/workspace-home.test.js`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/dashboard/page.tsx`
- Create: `apps/web/src/app/home/page.tsx`

**Interfaces:**
- Consumes: `?prompt=<encoded text>` on `/dashboard`.
- Produces: `/home` workspace page and `/dashboard?focus=1&prompt=<encoded text>` AI Slide navigation.

- [ ] **Step 1: Write the failing test**

```js
assert.match(home, /AI 슬라이드/);
assert.match(home, /router\.push\(`\/dashboard\?focus=1&prompt=/);
assert.match(root, /isAuthenticated \? '\/home' : '\/login'/);
assert.match(dashboard, /searchParams\.get\('prompt'\)/);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test apps/web/test/workspace-home.test.js`

Expected: FAIL because `/home` and prompt handoff do not exist.

- [ ] **Step 3: Implement the smallest route changes**

```tsx
useEffect(() => {
  const prompt = searchParams.get('prompt');
  if (prompt) setTextContent(prompt);
  if (searchParams.get('focus')) inputRef.current?.focus();
}, [searchParams]);
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --test apps/web/test/workspace-home.test.js`

Expected: PASS.

### Task 2: Build the minimal workspace home

**Files:**
- Create: `apps/web/src/app/home/page.tsx`
- Test: `apps/web/test/workspace-home.test.js`

**Interfaces:**
- Consumes: `useAuthStore`, `useRouter`, and query-string navigation.
- Produces: New/Home/Skills navigation, an AI Slide launcher, and prompt handoff.

- [ ] **Step 1: Extend the failing test for empty prompt behavior**

```js
assert.match(home, /if \(!prompt\.trim\(\)\) return/);
assert.match(home, /router\.push\('\/dashboard\?focus=1'\)/);
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test apps/web/test/workspace-home.test.js`

Expected: FAIL because no workspace page exists.

- [ ] **Step 3: Implement the page with existing primitives**

```tsx
const openSlides = () => router.push('/dashboard?focus=1');
const submitPrompt = () => {
  if (!prompt.trim()) return;
  router.push(`/dashboard?focus=1&prompt=${encodeURIComponent(prompt.trim())}`);
};
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --test apps/web/test/workspace-home.test.js`

Expected: PASS.

### Task 3: Verify the rendered workspace

**Files:**
- No source changes expected.

- [ ] **Step 1: Run the web test suite and production build**

Run: `pnpm --filter @jaslide/web test; pnpm --filter @jaslide/web build`

Expected: all tests pass and `/home` is present in the build route list.

- [ ] **Step 2: Rebuild the local web service**

Run: `docker compose up -d --build web`

Expected: web container is running on port 3100.

- [ ] **Step 3: Verify the desktop and mobile workspace flow**

Run: open `http://localhost:3100/home`, enter a prompt, submit it, and confirm the dashboard receives the prompt; inspect console errors and a mobile viewport.

Expected: the workspace home renders without console errors and AI Slide opens the existing generator with the entered text.
