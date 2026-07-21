# ZIP HTML Template Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let administrators import a safe Genspark-style HTML deck ZIP as a JaSlide template.

**Architecture:** FastAPI validates archive metadata with Python `zipfile`. The API forwards the upload, stores the original ZIP with `StorageService`, and saves the first HTML layout plus archive metadata in existing template JSON. The admin page adds a ZIP import modal beside PPTX import.

**Tech Stack:** FastAPI, Python standard library, NestJS/Multer, Prisma JSON, Next.js.

## Global Constraints

- Accept `.zip` archives up to 20 MB; reject traversal paths, more than 500 entries, or more than 100 MB uncompressed.
- Require one `deck/**/manifest.json`, `format: "html"`, and a non-empty playlist whose `.html` entries exist.
- Do not add dependencies, write extraction output to disk, or add a database migration.
- Preserve existing PPTX import behavior.

---

### Task 1: Validate HTML deck ZIPs in the renderer

**Files:**
- Create: `apps/renderer/src/services/html_template_archive.py`
- Modify: `apps/renderer/src/main.py`
- Test: `apps/renderer/tests/test_html_template_archive.py`

**Interface:** `extract_html_template_archive(content: bytes) -> dict` returns `htmlTemplate` and `archive` (`manifestPath`, `canvas`, ordered `slides`, optional `thumbnailPath`). Add `POST /api/extract/html-template` for multipart `file`.

- [ ] Write tests for a valid manifest/first layout and unsafe/missing playlist entries.
- [ ] Run `python -m pytest apps/renderer/tests/test_html_template_archive.py -q`; expect missing parser failure.
- [ ] Parse with `zipfile.ZipFile(io.BytesIO(content))`, `PurePosixPath`, and `json.loads`. Validate stated path/size rules, resolve playlist entries relative to the manifest, return metadata plus first UTF-8 HTML, and translate `ValueError` to HTTP 400.
- [ ] Run `python -m pytest apps/renderer/tests/test_html_template_archive.py apps/renderer/tests/test_html_template.py -q`; expect pass.
- [ ] Commit renderer parser, route, and tests.

### Task 2: Store the validated ZIP through the admin API

**Files:**
- Modify: `apps/api/src/modules/admin/templates/admin-templates.module.ts`
- Modify: `apps/api/src/modules/admin/templates/admin-templates.controller.ts`
- Modify: `apps/api/src/modules/admin/templates/admin-templates.service.ts`
- Modify: `apps/api/src/modules/admin/templates/admin-templates.service.spec.ts`

**Interface:** Add `POST /admin/templates/import-html-zip`. Persist `{ htmlTemplate, zipTemplate: { ...archive, storageKey } }` in the existing `Template.config` JSON.

- [ ] Write a service test that mocks renderer extraction and `StorageService.upload`, then asserts saved `zipTemplate.storageKey`.
- [ ] Run `pnpm --filter @jaslide/api test -- admin-templates.service.spec.ts`; expect missing `importHtmlZip` failure.
- [ ] Import `AssetsModule`, inject `StorageService`, add the 20 MB ZIP interceptor/controller endpoint, forward to `${RENDERER_URL}/api/extract/html-template`, validate response, store with `storage.upload(file, 'templates')`, and create the existing template.
- [ ] Run `pnpm --filter @jaslide/api test -- admin-templates.service.spec.ts && pnpm --filter @jaslide/api build`; expect pass.
- [ ] Commit API changes and tests.

### Task 3: Add the administrator ZIP import action

**Files:**
- Modify: `apps/web/src/app/admin/templates/page.tsx`
- Create: `apps/web/test/html-zip-template-upload.test.js`

**Interface:** Post multipart form data to `${NEXT_PUBLIC_API_URL}/admin/templates/import-html-zip` and refresh the template list after success.

- [ ] Write a Node structural test for `import-html-zip` and `accept=".zip,application/zip"`.
- [ ] Run `node --test apps/web/test/html-zip-template-upload.test.js`; expect failure.
- [ ] Reuse the PPTX modal form pattern, adding a separate ZIP button, form state, ZIP input, upload help, and submit handler without changing PPTX import.
- [ ] Run `node --test apps/web/test/html-zip-template-upload.test.js && pnpm --filter @jaslide/web build`; expect pass.
- [ ] Commit web changes and test.

### Task 4: Verify with the supplied archive

- [ ] Run `docker compose --env-file .env up -d --build`.
- [ ] Run `curl.exe -fsS -F "file=@C:/Users/USER/Downloads/academic-review-deck.zip;type=application/zip" http://localhost:8000/api/extract/html-template`; expect non-empty `htmlTemplate` and 22 slides.
- [ ] Run `curl.exe -fsS http://localhost:4100/api/health` and `curl.exe -fsSI http://localhost:3100/`; expect API `ok` and web HTTP 200.
