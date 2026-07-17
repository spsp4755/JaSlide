# Offline Skill-Guided Presentation Generation

## Goal

Make JaSlide generate editable Korean PPTX/PDF decks from user-uploaded files only, using a reusable presentation Skill and visual template selected from an in-product gallery.

## Product boundary

This is an air-gapped product. The API, worker, renderer, browser, and LLM may communicate only with configured internal services. No web search, external image search, cloud model, CDN font, or remote Skill-package fetch is permitted.

The first release accepts PDF, DOCX, XLSX/CSV, TXT, Markdown, and PPTX as presentation source files. A PPTX upload explicitly chooses one mode: **content source** extracts text, notes, table/chart descriptions, and slide-number locators for a new deck; **Skill/template reference** extracts only visual tokens. Importing `.zip` Skill packages is explicitly out of scope.

## User flow

1. A user opens the prompt-first home screen, uploads one or more source files, enters an optional request, and chooses a Skill and template.
2. The API parses only the uploaded files, stores the extracted source text and a source locator for every chunk, and sends the bounded material plus the selected Skill instruction to the internal LLM.
3. The LLM returns a slide-by-slide outline. Every key point must cite one or more uploaded-file locators. The UI shows the outline before a presentation or paid generation job is created.
4. The user may change outline titles, order, and key points, then approves it.
5. The existing queue generates slide content from the approved outline. The selected Skill supplies purpose, audience, tone, and composition rules; the selected template supplies colors, typography, and layout.
6. The editor preserves source citations in slide metadata, supports the existing per-slide AI edit/version controls, and exports editable PPTX or PDF through the existing internal renderer.

## Skill model

A Skill is a small, reusable database record. It is not executable code and cannot call tools.

Required fields:

- `name`, `description`, `category`, and `isPublic`
- `audience`, `tone`, `purpose`, and `outlineGuidance`
- `recommendedSlideCount`
- optional `templateId`
- optional `thumbnail` asset URL

The direct-create form collects these fields. The “create from presentation” action uploads only a PPTX or PDF as a visual reference: PPTX reuses the existing safe style-extraction endpoint; PDF is stored only as a thumbnail/reference asset. Neither path extracts or stores source text as Skill instructions. The same PPTX may instead be explicitly uploaded in content-source mode, which records slide-number locators and never changes the original file.

Seeded Skills cover only the categories the product needs for its first gallery: business strategy, executive reporting, B2B sales, education, technical review, and marketing. Users can filter all Skills, their organization’s Skills, and category chips. There is no ZIP import/export or shared-code Skill format.

## Data and API boundaries

Add a `PresentationSkill` model and an optional `skillId` relation on `Presentation` and `GenerationJob`. Keep `Template` unchanged so existing templates remain valid.

Add uploaded-source records that associate a presentation draft with its owned asset, normalized source type, extracted chunks, and immutable locators such as `fileName:page:3` or `fileName:sheet:Revenue:row:12`. The source parser rejects unsupported MIME types, password-protected/invalid documents, and bounded-size violations before extraction.

Split generation into two explicit APIs:

- `POST /generation/outline`: validates upload ownership, Skill/template visibility, parses source files, and returns a non-persisted, cited outline draft.
- `POST /generation/start`: accepts the validated outline draft identifier and edits, creates the presentation and queue job, and starts existing content generation.

The server owns source chunks and citation validation. Browser-submitted text never substitutes for an uploaded source. Any citation that does not resolve to a draft-owned locator rejects the outline before it is shown or approved.

## UI

Add `/skills` beside Home and My Presentations in the existing application shell.

The page matches the shown Genspark-style information architecture without copying its assets: category chips, a three-action “New Skill” panel, and local preview cards. The actions are:

- create from a PPTX/PDF reference;
- create a direct Skill;
- browse and apply an existing Skill.

The home composer gains a source-file picker and Skill picker. The template gallery remains available, and selecting a Skill with a default template preselects it while allowing the user to choose another visible template. The outline review screen is a focused step between submit and the existing progress screen.

## Generation and rendering

Extend the LLM outline contract with per-key-point citation locators and Skill-derived constraints. Content generation receives only the approved outline, selected Skill, and the selected template; it does not receive unbounded raw documents a second time.

Use existing slide fields and metadata for citations so the PPTX renderer stays focused on editable text, shapes, charts, and images. Citations appear in the web editor and as optional small source notes in PDF/PPTX exports. No web URLs are fetched as part of generation.

## Security and operations

- Allow only configured internal model endpoints; fail startup/deployment when an LLM base URL resolves outside the allowed internal network policy.
- Bundle Korean fonts into the web and renderer images. Replace Google-font fetching with local font assets so a production build works with egress disabled.
- Maintain a dependency/image manifest and an offline package/image import procedure for Harbor deployments.
- Enforce upload type, compressed/expanded size, page/sheet count, extraction timeout, ownership, and organization visibility at every upload boundary.
- Record Skill selection, template selection, source asset IDs, model ID, and generation timestamps in the audit log. Do not log source content or LLM credentials.

## Testing and acceptance

The feature is accepted when a user can deploy without internet access, upload a supported internal document, choose a seeded or organization Skill and a template, review cited outline items, approve the outline, and export a Korean PPTX/PDF with the chosen visual style.

Tests cover citation validation, unsupported/unsafe uploads, cross-organization access denial, Skill/template selection, outline approval before job enqueueing, LLM contract rejection/repair, and renderer output. An egress-disabled integration environment must build the web without downloading fonts and run the full generation path against an internal OpenAI-compatible test endpoint.

## Explicit non-goals

- Internet, intranet, wiki, drive, or search indexing
- Remote image search/generation
- Executable, ZIP-imported, or marketplace-downloaded Skills
- Google Slides export in closed-network deployment
- Collaborative real-time editing changes
