# Offline Skill-Guided Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a cited presentation from user-uploaded files after the user chooses a reusable Skill/template and approves the outline.

**Architecture:** Extend the existing NestJS generation flow with immutable upload drafts and a non-queued outline endpoint. `PresentationSkill` supplies non-executable composition guidance and can point to the existing `Template`; the current BullMQ job continues to produce approved slides. Next.js adds a Skill gallery and an outline-review state without adding external services.

**Tech Stack:** Next.js 14, NestJS, Prisma/PostgreSQL, OpenAI-compatible internal LLM, BullMQ/Redis, Python renderer, Jest, Playwright-free component tests, pytest.

## Global Constraints

- No web, external image search, cloud model, remote font, or remote Skill-package fetch is permitted.
- Accept source files only as PDF, DOCX, XLSX/CSV, TXT, and Markdown; reject URLs and ZIP Skill packages.
- PPTX/PDF may only create a visual reference Skill; do not treat their content as a generation source.
- All uploaded files, chunks, citations, Skills, and templates must be owner/organization scoped.
- Skill records are data only: no executable code, tool invocation, or package import.
- Build the web with local bundled fonts; the egress-disabled build must not request Google Fonts.

---

## File structure

- `apps/api/prisma/schema.prisma` owns Skill, outline-draft, upload-source, and citation persistence.
- `apps/api/src/modules/skills/*` owns Skill validation, authorization, gallery queries, and seeded records.
- `apps/api/src/modules/generation/*` owns upload parsing, cited-outline validation, approval, and existing queue hand-off.
- `apps/api/src/modules/llm/*` owns the internal-LLM contract; it never reaches outside the configured internal base URL.
- `apps/web/src/app/skills/page.tsx` owns the local Skill gallery and create forms.
- `apps/web/src/components/generation/outline-review.tsx` owns editable approval UI.
- `apps/web/src/app/dashboard/page.tsx` owns source upload, Skill/template selection, and navigation to outline review.
- `apps/web/src/lib/api.ts` owns typed calls for Skills and outline drafts.
- `apps/web/src/app/layout.tsx` and `apps/web/src/app/globals.css` own local fonts only.

### Task 1: Establish an air-gapped build baseline

**Files:**
- Modify: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/fonts/ibm-plex-sans-kr.woff2`
- Create: `apps/web/src/fonts/noto-serif-kr.woff2`
- Modify: `apps/api/package.json`
- Modify: `apps/api/prisma/schema.prisma`
- Test: `apps/web/src/app/layout.test.ts`
- Test: `apps/api/src/prisma/prisma-generation.spec.ts`

**Interfaces:**
- Produces `--font-sans` and `--font-display` from local font files.
- Produces `pnpm --filter @jaslide/api prisma:generate`, running `prisma generate --schema prisma/schema.prisma`.

- [ ] **Step 1: Write the failing web font test**

```ts
import source from './layout?raw';

it('does not import fonts from the network', () => {
  expect(source).not.toContain('next/font/google');
  expect(source).toContain('next/font/local');
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm --filter @jaslide/web test -- layout.test.ts`
Expected: FAIL because `next/font/google` is currently used.

- [ ] **Step 3: Switch to local fonts and add the Prisma generation script**

```ts
import localFont from 'next/font/local';

const body = localFont({ src: './fonts/ibm-plex-sans-kr.woff2', variable: '--font-sans' });
const display = localFont({ src: './fonts/noto-serif-kr.woff2', variable: '--font-display' });
```

```json
{ "scripts": { "prisma:generate": "prisma generate --schema prisma/schema.prisma" } }
```

- [ ] **Step 4: Verify local build prerequisites**

Run: `pnpm --filter @jaslide/api prisma:generate && pnpm --filter @jaslide/web test -- layout.test.ts`
Expected: Prisma client generated and the font test passes without a network request.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/layout.tsx apps/web/src/fonts apps/api/package.json apps/web/src/app/layout.test.ts apps/api/src/prisma/prisma-generation.spec.ts
git commit -m "fix: make build prerequisites air-gapped"
```

### Task 2: Persist safe Skills and gallery records

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_add_presentation_skills/migration.sql`
- Create: `apps/api/src/modules/skills/dto/skill.dto.ts`
- Create: `apps/api/src/modules/skills/skills.service.ts`
- Create: `apps/api/src/modules/skills/skills.controller.ts`
- Create: `apps/api/src/modules/skills/skills.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/modules/skills/skills.service.spec.ts`

**Interfaces:**
- Produces `PresentationSkill { id, name, description, category, audience, tone, purpose, outlineGuidance, recommendedSlideCount, templateId?, thumbnail?, isPublic, organizationId? }`.
- Produces `GET /skills?category=&mine=` and `POST /skills`.

- [ ] **Step 1: Write failing service tests for scope and validation**

```ts
it('returns organization-visible skills but not another organization’s skill', async () => {
  prisma.presentationSkill.findMany.mockResolvedValue([visibleSkill]);
  await expect(service.findVisible(user)).resolves.toEqual([visibleSkill]);
});

it('rejects executable package fields', async () => {
  await expect(service.create(user, { ...validSkill, packageUrl: 'skill.zip' } as any))
    .rejects.toThrow('Unsupported Skill field');
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm --filter @jaslide/api test -- skills.service.spec.ts`
Expected: FAIL because the Skills module does not exist.

- [ ] **Step 3: Add the minimal model and service API**

```prisma
model PresentationSkill {
  id String @id @default(cuid())
  name String
  category String
  audience String
  tone String
  purpose String
  outlineGuidance String @db.Text
  recommendedSlideCount Int
  templateId String?
  template Template? @relation(fields: [templateId], references: [id])
  isPublic Boolean @default(false)
  organizationId String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([category])
  @@index([organizationId])
}
```

```ts
async findVisible(user: CurrentUser, category?: string) {
  return this.prisma.presentationSkill.findMany({
    where: { AND: [{ OR: [{ isPublic: true }, { organizationId: user.organizationId }] }, category ? { category } : {}] },
    orderBy: { name: 'asc' },
  });
}
```

- [ ] **Step 4: Run migration, focused tests, and module compilation**

Run: `pnpm --filter @jaslide/api prisma:generate && pnpm --filter @jaslide/api test -- skills.service.spec.ts && pnpm --filter @jaslide/api build`
Expected: PASS; the migration creates only the new table and optional foreign key.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma apps/api/src/modules/skills apps/api/src/app.module.ts
git commit -m "feat: add scoped presentation skills"
```

### Task 3: Create cited, upload-only outline drafts

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/src/modules/generation/dto/outline.dto.ts`
- Create: `apps/api/src/modules/generation/source-extraction.service.ts`
- Modify: `apps/api/src/modules/generation/generation.service.ts`
- Modify: `apps/api/src/modules/generation/generation.controller.ts`
- Modify: `apps/api/src/modules/llm/llm.service.ts`
- Test: `apps/api/src/modules/generation/source-extraction.service.spec.ts`
- Test: `apps/api/src/modules/generation/generation.service.spec.ts`

**Interfaces:**
- Consumes `POST /generation/outline` multipart files and `{ prompt?, skillId?, templateId?, slideCount, language }`.
- Produces `OutlineDraft { id, title, slides: Array<{ order, title, type, keyPoints: Array<{ text, citations: string[] }> }> }`.
- Consumes only locators generated by `SourceExtractionService.extract(files)`.

- [ ] **Step 1: Write failing tests for allowlist and citation ownership**

```ts
it('rejects a PPTX as a source document', async () => {
  await expect(service.extract([pptxFile])).rejects.toThrow('Unsupported source file');
});

it('rejects an outline citation not produced by the draft', async () => {
  await expect(service.createOutline(user, requestWith('other.pdf:page:1')))
    .rejects.toThrow('Unknown source citation');
});
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `pnpm --filter @jaslide/api test -- source-extraction.service.spec.ts generation.service.spec.ts`
Expected: FAIL because no outline endpoint or draft validation exists.

- [ ] **Step 3: Add immutable source/draft records and validation**

```ts
const sourceTypes = new Set(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'text/plain', 'text/markdown']);

if (!sourceTypes.has(file.mimetype)) throw new BadRequestException('Unsupported source file');
```

```ts
const knownLocators = new Set(chunks.map(({ locator }) => locator));
for (const point of outline.slides.flatMap((slide) => slide.keyPoints)) {
  if (point.citations.some((locator) => !knownLocators.has(locator))) throw new BadRequestException('Unknown source citation');
}
```

- [ ] **Step 4: Verify API behavior**

Run: `pnpm --filter @jaslide/api test -- source-extraction.service.spec.ts generation.service.spec.ts && pnpm --filter @jaslide/api build`
Expected: PASS; valid PDF/DOCX/XLSX/CSV/TXT/Markdown input yields cited draft data and unsupported/foreign locators fail.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma apps/api/src/modules/generation apps/api/src/modules/llm
git commit -m "feat: add upload-only cited outline drafts"
```

### Task 4: Require outline approval before enqueueing generation

**Files:**
- Modify: `apps/api/src/modules/generation/dto/generation.dto.ts`
- Modify: `apps/api/src/modules/generation/generation.service.ts`
- Modify: `apps/api/src/modules/generation/generation.controller.ts`
- Modify: `apps/api/src/modules/llm/prompt-template.service.ts`
- Test: `apps/api/src/modules/generation/generation.service.spec.ts`

**Interfaces:**
- Consumes `POST /generation/start { outlineDraftId, outline, title?, skillId?, templateId? }`.
- Produces the existing `{ jobId, presentationId, status, estimatedCost }` only after a validated, user-owned outline is accepted.

- [ ] **Step 1: Write a failing no-enqueue-before-approval test**

```ts
it('does not enqueue work before a user-approved draft is supplied', async () => {
  await expect(service.startGeneration(user.id, legacyStartRequest as any))
    .rejects.toThrow('Approved outline draft required');
  expect(queue.addGenerationJob).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @jaslide/api test -- generation.service.spec.ts`
Expected: FAIL because the legacy start API queues directly.

- [ ] **Step 3: Store approved outline and Skill/template references in the queue input**

```ts
input: {
  outline: dto.outline,
  outlineDraftId: dto.outlineDraftId,
  skillId: dto.skillId,
  templateId: dto.templateId,
  language: dto.language || 'ko',
}
```

```ts
const outline = validateApprovedOutline(draft, dto.outline);
for (const slideOutline of outline.slides) {
  const content = await this.llmService.generateSlideContent({ ...slideOutline, skill: skillInstruction, language });
}
```

- [ ] **Step 4: Run focused tests and full API build**

Run: `pnpm --filter @jaslide/api test -- generation.service.spec.ts llm.service.spec.ts && pnpm --filter @jaslide/api build`
Expected: PASS; approved outlines are generated without a second outline request.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/generation apps/api/src/modules/llm
git commit -m "feat: generate from approved skill-guided outlines"
```

### Task 5: Ship the Skill gallery and outline review flow

**Files:**
- Create: `apps/web/src/app/skills/page.tsx`
- Create: `apps/web/src/components/skills/skill-card.tsx`
- Create: `apps/web/src/components/skills/skill-form.tsx`
- Create: `apps/web/src/components/generation/outline-review.tsx`
- Modify: `apps/web/src/components/layout/app-shell.tsx`
- Modify: `apps/web/src/app/dashboard/page.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Test: `apps/web/src/components/generation/outline-review.test.tsx`
- Test: `apps/web/src/components/skills/skill-card.test.tsx`

**Interfaces:**
- Consumes `skillsApi.list(category?)`, `skillsApi.create(data)`, `generationApi.outline(formData)`, and `generationApi.start(approvedDraft)`.
- Produces a selected `{ skillId, templateId }` and approved `OutlineDraft` for the existing progress screen.

- [ ] **Step 1: Write failing interaction tests**

```tsx
it('blocks generation until the editable outline is approved', async () => {
  render(<OutlineReview draft={draft} onApprove={onApprove} />);
  await user.click(screen.getByRole('button', { name: '생성 시작' }));
  expect(onApprove).toHaveBeenCalledWith(expect.objectContaining({ id: draft.id }));
});

it('applies a selected Skill default template', async () => {
  render(<SkillCard skill={{ ...skill, templateId: 'template-1' }} onApply={onApply} />);
  await user.click(screen.getByRole('button', { name: '적용' }));
  expect(onApply).toHaveBeenCalledWith({ skillId: skill.id, templateId: 'template-1' });
});
```

- [ ] **Step 2: Run focused web tests to verify they fail**

Run: `pnpm --filter @jaslide/web test -- outline-review.test.tsx skill-card.test.tsx`
Expected: FAIL because the components and `skillsApi` do not exist.

- [ ] **Step 3: Implement the smallest gallery and review UI**

```ts
export const skillsApi = {
  list: (category?: string) => api.get('/skills', { params: { category } }),
  create: (data: CreateSkillInput) => api.post('/skills', data),
};

export const generationApi = {
  outline: (data: FormData) => api.post('/generation/outline', data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  start: (data: ApprovedOutlineRequest) => api.post('/generation/start', data),
};
```

- [ ] **Step 4: Verify selection and approval flow**

Run: `pnpm --filter @jaslide/web test -- outline-review.test.tsx skill-card.test.tsx && pnpm --filter @jaslide/web build`
Expected: PASS; the browser submits files to the outline endpoint, displays citations, and queues only after approval.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/skills apps/web/src/components/skills apps/web/src/components/generation apps/web/src/app/dashboard/page.tsx apps/web/src/components/layout/app-shell.tsx apps/web/src/lib/api.ts
git commit -m "feat: add skill gallery and outline approval"
```

### Task 6: Verify citations, local assets, and closed-network deployment

**Files:**
- Modify: `apps/api/src/modules/export/export.service.ts`
- Modify: `apps/renderer/src/generators/pptx_generator.py`
- Modify: `apps/renderer/tests/test_pptx_generator.py`
- Modify: `docs/deployment.md`
- Create: `docs/offline-verification.md`
- Test: `apps/api/src/modules/export/export.service.spec.ts`

**Interfaces:**
- Consumes slide metadata `citations: string[]`.
- Produces optional export source notes without fetching their URLs.

- [ ] **Step 1: Write a failing renderer test for offline source notes**

```python
def test_pptx_keeps_citations_as_notes_without_network_fetch(monkeypatch):
    monkeypatch.setattr('requests.get', lambda *_: pytest.fail('network access'))
    pptx = PPTXGenerator().generate(presentation_with_citations())
    assert b'quarterly.pdf:page:4' in pptx
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pytest apps/renderer/tests/test_pptx_generator.py -k citations`
Expected: FAIL because citations are not exported.

- [ ] **Step 3: Add source notes and offline verification instructions**

```python
for locator in slide.get('citations', []):
    notes_text.append(f'Source: {locator}')
```

```markdown
docker compose build --network none web api renderer
docker compose up -d
# Upload fixture → review citations → export PPTX/PDF → verify no egress logs
```

- [ ] **Step 4: Run renderer, API, and egress-disabled checks**

Run: `pytest apps/renderer/tests/test_pptx_generator.py -k citations && pnpm --filter @jaslide/api test -- export.service.spec.ts && docker compose build --network none web`
Expected: PASS; exported notes retain locators and the web build performs no font download.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/export apps/renderer/src/generators/pptx_generator.py apps/renderer/tests/test_pptx_generator.py docs/deployment.md docs/offline-verification.md
git commit -m "test: verify offline cited exports"
```

## Plan self-review

- Spec coverage: Task 1 covers local build assets; Task 2 covers non-executable Skills; Task 3 covers upload-only parsing/citations; Task 4 covers approval-gated generation; Task 5 covers the requested gallery; Task 6 covers cited exports and egress verification.
- Scope: no ZIP packages, remote services, search, or external images are introduced.
- Type consistency: `PresentationSkill`, `OutlineDraft`, `outlineDraftId`, and citation locators are the shared terms across API, UI, LLM, and renderer tasks.
