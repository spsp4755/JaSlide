# Example PPTX Template Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task.

**Goal:** Let an administrator upload a PPTX and save extracted style tokens as a JaSlide template.

**Architecture:** NestJS accepts an admin-only, size-limited `.pptx`, sends its bytes to the internal renderer through the existing `RENDERER_URL`, and persists only returned token data in the existing `Template.config` field.

**Tech Stack:** NestJS, Axios, Multer, FastAPI, python-pptx, Jest, pytest.

## Global Constraints

- Admin role required.
- Accept `.pptx` only and reject files above 20 MB before forwarding.
- Renderer returns only colors/typography, never slide content/images/notes.

---

### Task 1: Renderer style extraction endpoint

**Files:**
- Modify: `apps/renderer/src/main.py`
- Modify: `apps/renderer/tests/test_style_extractor.py`

- [ ] Add a failing FastAPI test for a multipart PPTX upload returning only `config` tokens.
- [ ] Run renderer pytest and observe failure.
- [ ] Add `POST /api/extract/style` using `UploadFile`, reject non-PPTX content/name, and call `extract_template_tokens`.
- [ ] Run renderer tests and commit renderer files.

### Task 2: Admin template upload and save

**Files:**
- Modify: `apps/api/src/modules/admin/templates/admin-templates.controller.ts`
- Modify: `apps/api/src/modules/admin/templates/admin-templates.service.ts`
- Modify: `apps/api/src/modules/admin/templates/admin-templates.service.spec.ts`

- [ ] Write failing tests for admin upload forwarding and saved template config; test invalid extension/size rejection.
- [ ] Run focused API tests and observe failure.
- [ ] Add `POST /admin/templates/import-pptx` with Multer limits and file filter; forward multipart to `${RENDERER_URL}/api/extract/style`; create a template from validated returned config.
- [ ] Run focused and API tests; commit only template API files.
