# Export and Outline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make imported template styles visible, make export failures diagnosable, and let users meet the three-slide minimum.

**Architecture:** Keep all behavior in the existing editor, dashboard, and export service. Use the template's existing inline CSS and normal serializable error fields; do not add dependencies or endpoints.

**Tech Stack:** Next.js, NestJS, Jest, Node test runner.

## Global Constraints

- No new dependency or service.
- Preserve the existing three-slide minimum.

### Task 1: Regression tests

**Files:**
- Modify: `apps/api/src/modules/export/export.service.spec.ts`
- Modify: `apps/web/test/outline-approval.test.js`

- [ ] Assert renderer errors log a serializable status/detail, and assert the outline offers an add-slide control and visible three-slide minimum.
- [ ] Run the focused tests and observe failures before implementation.

### Task 2: Minimal implementation

**Files:**
- Modify: `apps/api/src/modules/export/export.service.ts`
- Modify: `apps/web/src/app/dashboard/page.tsx`
- Modify: `apps/web/src/app/editor/[id]/page.tsx`

- [ ] Log only the renderer status/detail and use the existing template HTML variables to style preview controls.
- [ ] Add one default slide action and disable generation below three valid slides.
- [ ] Run API and web tests, the web build, and direct renderer PPTX/PDF requests.
