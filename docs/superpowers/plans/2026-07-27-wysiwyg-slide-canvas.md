# WYSIWYG Slide Canvas — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the PNG-plus-white-textarea editing surface with a live DOM slide the browser renders itself, so text is edited in place in the slide's real fonts, sizes, colours and positions.

**Architecture:** Both template kinds already store per-slide HTML (ZIP decks in `Slide.content.html`, PPTX templates in `Template.config.htmlSlides[]`). The browser fetches that base HTML per slide, merges `objectEdits` into it locally on every keystroke, and renders it in a 1920×1080 stage scaled with a single `transform: scale()`. The object map stays the edit model, so PPTX export keeps writing into the original file through python-pptx and stays natively editable.

**Tech Stack:** Next.js 16 / React 19 (web), NestJS (api), FastAPI + python-pptx (renderer), pnpm workspace. Web tests run on `node --test`; api on jest; renderer on pytest.

**Spec:** `docs/superpowers/specs/2026-07-27-wysiwyg-slide-canvas-design.md`

## Global Constraints

- Closed network. No CDN, no external font host, no new npm registry dependency.
- The export contract does not change in this phase. `objectEdits` keeps its
  current shape; every existing export test must stay green.
- A slide must never render blank. Every failure path falls back to the
  existing PNG canvas.
- Korean UI copy for anything user-visible.
- Fonts redistributed with the app must ship their license file.

---

### Task 1: Renderer emits `data-object-id` on every object

Without an id in the HTML there is no key to bind an edit to a rendered
element. The HTML and the object map are built in one loop and are positionally
aligned today, but binding by array position breaks the moment either list
changes.

**Files:**
- Modify: `apps/renderer/src/services/pptx_to_html.py:234-271`
- Modify: `apps/renderer/src/services/html_template.py:104-107`
- Test: `apps/renderer/tests/test_pptx_to_html.py`

**Interfaces:**
- Produces: every `data-object="true"` element also carries
  `data-object-id="<shape_id>"`, matching `source.slides[].objects[].id`.
  The parser in `html_template.py` exposes it as `item["data-object-id"]`.

- [ ] **Step 1: Write the failing test**

Append to `apps/renderer/tests/test_pptx_to_html.py`:

```python
def test_every_html_object_carries_its_native_object_id():
    """The editor binds an objectEdit to a rendered element by this id."""
    result = pptx_to_html(_deck_bytes())
    html = result["htmlSlides"][0]
    ids = {obj["id"] for obj in result["sourceSlides"][0]["objects"]}

    assert ids, "fixture deck produced no objects"
    for object_id in ids:
        assert f'data-object-id="{object_id}"' in html
    assert html.count('data-object="true"') == html.count("data-object-id=")
```

Use whatever fixture-deck helper the file already defines; if it builds a deck
inline, reuse that construction rather than adding a new fixture.

- [ ] **Step 2: Run it and watch it fail**

```bash
docker compose exec -T renderer python -m pytest tests/test_pptx_to_html.py -k object_id -v
```

Expected: FAIL — `data-object-id` appears nowhere.

- [ ] **Step 3: Emit the id**

In `pptx_to_html.py`, inside `extract`, build the attribute once next to
`position`:

```python
        position = f"position:absolute;left:{left}px;top:{top}px;width:{width}px;height:{height}px"
        marker = f'data-object="true" data-object-id="{escape(str(shape.shape_id), quote=True)}"'
```

Then replace `data-object="true"` with `{marker}` in all five `objects.append`
calls (inlined image, image placeholder, table, textbox, shape). The table
branch rebuilds `position` after summing column widths — leave that as is and
use `{marker}` there too.

- [ ] **Step 4: Let the parser read it back**

In `html_template.py`, the collected dict at line 107 gains the id:

```python
                "tag": tag, "type": values.get("data-object-type"),
                "id": values.get("data-object-id"),
```

- [ ] **Step 5: Run the renderer suite**

```bash
docker compose exec -T renderer python -m pytest tests/ -q
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/renderer/src/services/pptx_to_html.py apps/renderer/src/services/html_template.py apps/renderer/tests/test_pptx_to_html.py
git commit -m "feat(renderer): key each HTML object to its native shape id"
```

---

### Task 2: Table cells anchor to the top and keep their borders

Both are visible defects today and become the editing surface in this phase.
A cell whose text floats in the vertical middle of a tall row is the single
most obvious difference from the deck.

**Files:**
- Modify: `apps/renderer/src/services/pptx_to_html.py` (`_table_html`)
- Test: `apps/renderer/tests/test_pptx_to_html.py`

**Interfaces:**
- Produces: each emitted `<td>` carries `vertical-align` from the cell's
  `text_frame.vertical_anchor` (top when unset) and a `border` from the table's
  line style.

- [ ] **Step 1: Read the current emitter**

```bash
grep -n "_table_html" -A 25 apps/renderer/src/services/pptx_to_html.py
```

Note the exact `<td>` style string before changing it.

- [ ] **Step 2: Write the failing test**

```python
def test_table_cells_anchor_to_the_top_and_draw_their_borders():
    """A tall row centred its text, which is the loudest difference from the deck."""
    html = pptx_to_html(_deck_bytes())["htmlSlides"][0]

    assert "vertical-align:top" in html
    assert "border" in html.split("<table")[1].split("</table>")[0]
```

- [ ] **Step 3: Run it and watch it fail**

```bash
docker compose exec -T renderer python -m pytest tests/test_pptx_to_html.py -k anchor -v
```

- [ ] **Step 4: Emit the anchor and border**

In `_table_html`, map python-pptx's `MSO_ANCHOR` to CSS and add it to each
cell's inline style, defaulting to top:

```python
_ANCHOR_CSS = {MSO_ANCHOR.TOP: "top", MSO_ANCHOR.MIDDLE: "middle", MSO_ANCHOR.BOTTOM: "bottom"}

def _cell_anchor(cell) -> str:
    return _ANCHOR_CSS.get(cell.text_frame.vertical_anchor, "top")
```

Import `MSO_ANCHOR` from `pptx.enum.text`. Add `vertical-align:{anchor};` and a
`border:1px solid <line colour or #D0D0D0>;` to the `<td>` style.

- [ ] **Step 5: Run the renderer suite**

```bash
docker compose exec -T renderer python -m pytest tests/ -q
```

- [ ] **Step 6: Rebuild the renderer and re-extract the reference template**

```bash
docker compose up -d --build renderer
```

- [ ] **Step 7: Commit**

```bash
git add apps/renderer/src/services/pptx_to_html.py apps/renderer/tests/test_pptx_to_html.py
git commit -m "fix(renderer): anchor table cell text to the top and keep cell borders"
```

---

### Task 3: Serve a slide's base HTML

The editor needs the slide's HTML without the presentation payload carrying
every template slide's inlined base64 images — a 17-slide ZIP template runs to
megabytes.

**Files:**
- Modify: `apps/api/src/modules/presentations/presentations.controller.ts`
- Modify: `apps/api/src/modules/presentations/presentations.service.ts`
- Test: `apps/api/src/modules/presentations/presentations.service.spec.ts`

**Interfaces:**
- Produces: `GET /api/presentations/:id/slides/:order/template-html` →
  `{ html: string }`. `html` is `''` when the slide has none, which the client
  treats as "fall back to the PNG canvas".
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Write the failing tests**

Add to `presentations.service.spec.ts`:

```ts
describe('slideTemplateHtml', () => {
    it('returns a ZIP deck slide\'s own generated HTML', async () => {
        prisma.presentation.findFirst.mockResolvedValue({
            id: 'p1',
            slides: [{ order: 0, content: { html: '<div>zip</div>' } }],
            template: { config: { htmlSlides: ['<div>template</div>'] } },
        });

        await expect(service.slideTemplateHtml('p1', 'user-1', 0)).resolves.toEqual({ html: '<div>zip</div>' });
    });

    it('returns the PPTX template slide the generator chose', async () => {
        prisma.presentation.findFirst.mockResolvedValue({
            id: 'p1',
            slides: [{ order: 0, content: { templateIndex: 2 } }],
            template: { config: { htmlSlides: ['a', 'b', '<div>chosen</div>'] } },
        });

        await expect(service.slideTemplateHtml('p1', 'user-1', 0)).resolves.toEqual({ html: '<div>chosen</div>' });
    });

    it('reports no HTML rather than throwing, so the client can fall back', async () => {
        prisma.presentation.findFirst.mockResolvedValue({
            id: 'p1', slides: [{ order: 0, content: {} }], template: null,
        });

        await expect(service.slideTemplateHtml('p1', 'user-1', 0)).resolves.toEqual({ html: '' });
    });

    it('refuses a slide order that is not in the deck', async () => {
        prisma.presentation.findFirst.mockResolvedValue({ id: 'p1', slides: [], template: null });

        await expect(service.slideTemplateHtml('p1', 'user-1', 9)).rejects.toBeInstanceOf(NotFoundException);
    });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd apps/api && npx jest src/modules/presentations -t slideTemplateHtml
```

Expected: FAIL — `service.slideTemplateHtml is not a function`.

- [ ] **Step 3: Implement the service method**

```ts
    /**
     * The slide's own HTML for the browser to render and edit.
     *
     * A ZIP deck generates its HTML per slide, so that is the slide. A PPTX deck
     * keeps its layouts on the template and records which one the generator
     * picked, so resolve through `templateIndex`. Returning '' rather than
     * throwing lets the editor fall back to the server-rendered PNG instead of
     * showing an empty stage.
     */
    async slideTemplateHtml(id: string, userId: string, order: number): Promise<{ html: string }> {
        const presentation = await this.prisma.presentation.findFirst({
            where: { id, userId },
            include: { slides: { orderBy: { order: 'asc' } }, template: true },
        });
        if (!presentation) throw new NotFoundException('Presentation not found');
        const slide = presentation.slides.find((item) => item.order === order);
        if (!slide) throw new NotFoundException('Slide not found');

        const content = (slide.content as any) || {};
        if (typeof content.html === 'string' && content.html.trim()) return { html: content.html };

        const htmlSlides = (presentation.template?.config as any)?.htmlSlides;
        const index = content.templateIndex;
        if (Array.isArray(htmlSlides) && Number.isInteger(index) && typeof htmlSlides[index] === 'string') {
            return { html: htmlSlides[index] };
        }
        return { html: '' };
    }
```

- [ ] **Step 4: Add the route**

```ts
    @Get(':id/slides/:order/template-html')
    @ApiOperation({ summary: "Base HTML the browser renders for one slide" })
    async slideTemplateHtml(
        @CurrentUser() user: any,
        @Param('id') id: string,
        @Param('order', ParseIntPipe) order: number,
    ) {
        return this.presentationsService.slideTemplateHtml(id, user.id, order);
    }
```

Import `ParseIntPipe` from `@nestjs/common` if it is not already imported.

- [ ] **Step 5: Run the api suite**

```bash
cd apps/api && npx jest
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/presentations
git commit -m "feat(api): serve the base HTML the editor renders for a slide"
```

---

### Task 4: Pure helpers for turning an edit into DOM changes

Geometry and style arithmetic is where the current code went wrong (`/5.4cqh`,
`fontSize/4`, `Math.max(12, …)`). Keep the arithmetic pure and tested, and let
the component's DOM writes stay trivial — the same split
`src/lib/object-transform.ts` already uses.

**Files:**
- Create: `apps/web/src/lib/slide-canvas.ts`
- Test: `apps/web/test/slide-canvas.test.js`

**Interfaces:**
- Produces:
  - `objectEditStyle(edit: ObjectEdit): Record<string, string>` — inline CSS to
    assign onto the located element.
  - `objectEditText(edit: ObjectEdit): string | null` — the plain text to write,
    or `null` when this edit does not change text.
  - `canvasScale(containerWidth: number): number` — `containerWidth / 1920`.
  - `toSlidePx(clientDelta: number, scale: number): number` — pointer delta in
    slide coordinates.
  - `SLIDE_W = 1920`, `SLIDE_H = 1080`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/slide-canvas.test.js`, following the compile-and-require
pattern already used by `object-transform.test.js`:

```js
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaslide-canvas-'));
execFileSync('npx', ['tsc', 'src/lib/slide-canvas.ts', '--outDir', outDir, '--module', 'commonjs', '--target', 'es2020'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'pipe',
});
const { objectEditStyle, objectEditText, canvasScale, toSlidePx, SLIDE_W } = require(path.join(outDir, 'slide-canvas.js'));

test('the stage scales as one unit instead of per-element percentages', () => {
    assert.equal(SLIDE_W, 1920);
    assert.equal(canvasScale(960), 0.5);
    // A 40px drag on a half-scale canvas is an 80px move on the slide.
    assert.equal(toSlidePx(40, 0.5), 80);
});

test('geometry is emitted in the slide\'s own pixels, not a derived percentage', () => {
    assert.deepEqual(
        objectEditStyle({ objectId: '6', left: 140, top: 120, width: 800, height: 200 }),
        { left: '140px', top: '120px', width: '800px', height: '200px' },
    );
});

test('font size is the deck\'s point size, with no floor and no divisor', () => {
    // The old canvas divided by 5.4 or by 4 and clamped at 12px, so a 13pt
    // caption and a 22pt heading came out nearly the same size.
    assert.deepEqual(objectEditStyle({ objectId: '6', fontSize: 13 }), { fontSize: '13pt' });
    assert.deepEqual(objectEditStyle({ objectId: '6', fontSize: 22 }), { fontSize: '22pt' });
});

test('only the properties an edit actually sets are emitted', () => {
    assert.deepEqual(objectEditStyle({ objectId: '6' }), {});
    assert.deepEqual(objectEditStyle({ objectId: '6', color: '#1A1A1A', bold: true }), {
        color: '#1A1A1A', fontWeight: '700',
    });
    assert.deepEqual(objectEditStyle({ objectId: '6', italic: false }), { fontStyle: 'normal' });
});

test('fill, line and rotation reach the element', () => {
    assert.deepEqual(
        objectEditStyle({ objectId: '9', fillColor: '#FFEEEE', lineColor: '#202124', lineWidth: 2, rotation: 90 }),
        { background: '#FFEEEE', borderColor: '#202124', borderWidth: '2px', borderStyle: 'solid', transform: 'rotate(90deg)' },
    );
});

test('text is reported only when the edit carries it', () => {
    assert.equal(objectEditText({ objectId: '6', text: '주간 업무 보고' }), '주간 업무 보고');
    assert.equal(objectEditText({ objectId: '6' }), null);
    // An empty string is a real edit — the user cleared the box.
    assert.equal(objectEditText({ objectId: '6', text: '' }), '');
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd apps/web && node --test ./test/slide-canvas.test.js
```

Expected: FAIL — `src/lib/slide-canvas.ts` does not exist.

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/slide-canvas.ts`:

```ts
/** The slide's own coordinate space. Template HTML is authored at this size. */
export const SLIDE_W = 1920;
export const SLIDE_H = 1080;

export interface ObjectEdit {
    objectId: string;
    text?: string;
    left?: number; top?: number; width?: number; height?: number;
    color?: string; fontSize?: number; fontFamily?: string;
    bold?: boolean; italic?: boolean;
    fillColor?: string; lineColor?: string; lineWidth?: number;
    rotation?: number;
    delete?: boolean;
}

/** How much the 1920-wide stage is shrunk to fit its container. */
export function canvasScale(containerWidth: number): number {
    return containerWidth / SLIDE_W;
}

/**
 * A pointer delta converted into slide pixels.
 *
 * The stage is scaled once as a whole, so this is the only place the
 * conversion happens — replacing the per-call-site `* 1920 / bounds.width`.
 */
export function toSlidePx(clientDelta: number, scale: number): number {
    return scale ? clientDelta / scale : clientDelta;
}

/**
 * Inline CSS for one edit.
 *
 * Sizes stay in the deck's own units: the slide stage is scaled as a whole, so
 * a 13pt caption is written as 13pt. The old canvas divided by 5.4 or by 4 and
 * floored at 12px, which is why every box came out roughly one size.
 */
export function objectEditStyle(edit: ObjectEdit): Record<string, string> {
    const style: Record<string, string> = {};
    for (const key of ['left', 'top', 'width', 'height'] as const) {
        if (typeof edit[key] === 'number') style[key] = `${edit[key]}px`;
    }
    if (typeof edit.fontSize === 'number') style.fontSize = `${edit.fontSize}pt`;
    if (edit.fontFamily) style.fontFamily = edit.fontFamily;
    if (edit.color) style.color = edit.color;
    if (typeof edit.bold === 'boolean') style.fontWeight = edit.bold ? '700' : '400';
    if (typeof edit.italic === 'boolean') style.fontStyle = edit.italic ? 'italic' : 'normal';
    if (edit.fillColor) style.background = edit.fillColor;
    if (edit.lineColor) { style.borderColor = edit.lineColor; style.borderStyle = 'solid'; }
    if (typeof edit.lineWidth === 'number') { style.borderWidth = `${edit.lineWidth}px`; style.borderStyle = 'solid'; }
    if (typeof edit.rotation === 'number') style.transform = `rotate(${edit.rotation}deg)`;
    return style;
}

/** The text an edit writes, or null when it changes no text. */
export function objectEditText(edit: ObjectEdit): string | null {
    return typeof edit.text === 'string' ? edit.text : null;
}
```

- [ ] **Step 4: Run and watch it pass**

```bash
cd apps/web && node --test ./test/slide-canvas.test.js
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/slide-canvas.ts apps/web/test/slide-canvas.test.js
git commit -m "feat(editor): slide-space geometry helpers for a scaled canvas"
```

---

### Task 5: Ship the fonts the renderer actually uses

The renderer resolves the reference deck's runs to NanumGothic. The browser,
given the same family name, falls back to Malgun Gothic. Until the browser has
the same file, nothing else in this phase looks right.

**Files:**
- Create: `apps/web/public/fonts/NanumGothic.ttf`
- Create: `apps/web/public/fonts/NanumGothicBold.ttf`
- Create: `apps/web/public/fonts/LICENSE-nanum.txt`
- Modify: `apps/web/src/app/globals.css`
- Test: `apps/web/test/local-fonts.test.js`

**Interfaces:**
- Produces: `@font-face` families `NanumGothic` and `나눔고딕` resolvable in the
  browser, matching the renderer's `fc-match` result.

- [ ] **Step 1: Copy the fonts and their license out of the renderer image**

```bash
docker compose cp renderer:/usr/share/fonts/truetype/nanum/NanumGothic.ttf apps/web/public/fonts/NanumGothic.ttf
docker compose cp renderer:/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf apps/web/public/fonts/NanumGothicBold.ttf
docker compose cp renderer:/usr/share/doc/fonts-nanum/copyright apps/web/public/fonts/LICENSE-nanum.txt
```

Create the directory first if `docker compose cp` reports it missing.

- [ ] **Step 2: Write the failing test**

Append to `apps/web/test/local-fonts.test.js`:

```js
test('the slide canvas can draw the fonts the renderer resolves to', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'globals.css'), 'utf8');

    // The deck names its runs in Korean; the renderer resolves 나눔고딕 to
    // NanumGothic.ttf. Both spellings must reach the same file or the browser
    // silently falls back and stops matching the export.
    assert.match(css, /font-family:\s*'NanumGothic'/);
    assert.match(css, /font-family:\s*'나눔고딕'/);
    assert.match(css, /NanumGothicBold\.ttf/);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'fonts', 'NanumGothic.ttf')));
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'fonts', 'LICENSE-nanum.txt')));
});
```

- [ ] **Step 3: Run and watch it fail**

```bash
cd apps/web && node --test ./test/local-fonts.test.js
```

- [ ] **Step 4: Declare the faces**

Append to `apps/web/src/app/globals.css`:

```css
/* The renderer resolves a deck's Korean runs to these exact files. Serving the
   same files to the browser is what makes the editing canvas and the exported
   deck show the same glyphs; without them the browser silently substitutes
   Malgun Gothic and every measurement drifts. Both the Latin and the Korean
   spelling are declared because PPTX runs name the font either way. */
@font-face { font-family: 'NanumGothic'; src: url('/fonts/NanumGothic.ttf') format('truetype'); font-weight: 400; font-display: block; }
@font-face { font-family: 'NanumGothic'; src: url('/fonts/NanumGothicBold.ttf') format('truetype'); font-weight: 700; font-display: block; }
@font-face { font-family: '나눔고딕'; src: url('/fonts/NanumGothic.ttf') format('truetype'); font-weight: 400; font-display: block; }
@font-face { font-family: '나눔고딕'; src: url('/fonts/NanumGothicBold.ttf') format('truetype'); font-weight: 700; font-display: block; }
```

- [ ] **Step 5: Run the web suite**

```bash
cd apps/web && pnpm test
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/public/fonts apps/web/src/app/globals.css apps/web/test/local-fonts.test.js
git commit -m "feat(editor): serve the renderer's Korean fonts to the browser"
```

---

### Task 6: SlideCanvas renders the slide as live DOM

**Files:**
- Create: `apps/web/src/components/editor/slide-canvas.tsx`
- Test: `apps/web/test/slide-canvas-component.test.js`

**Interfaces:**
- Consumes: `objectEditStyle`, `objectEditText`, `canvasScale`, `toSlidePx`,
  `SLIDE_W`, `SLIDE_H` from Task 4;
  `GET /api/presentations/:id/slides/:order/template-html` from Task 3;
  `data-object-id` from Task 1.
- Produces: `<SlideCanvas baseHtml objectEdits selectedObjectId editingObjectId
  onSelectObject onStartTextEdit onChangeText onTransform />`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/slide-canvas-component.test.js`. This one asserts on
source, matching `html-slide-editing.test.js`, because rendering React needs a
DOM this repo has no runner for:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = () => fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'editor', 'slide-canvas.tsx'), 'utf8');

test('the slide is live DOM, scaled as one stage', () => {
    const code = source();
    assert.match(code, /dangerouslySetInnerHTML/);
    assert.match(code, /transform:\s*`scale\(/);
    assert.match(code, /transformOrigin/);
    // The whole point: no image beneath the editing surface.
    assert.doesNotMatch(code, /<img/);
});

test('objects are found by their native id, not by array position', () => {
    assert.match(source(), /\[data-object-id="/);
});

test('text is edited in place, with nothing painted over the slide', () => {
    const code = source();
    assert.match(code, /contentEditable/);
    assert.doesNotMatch(code, /<textarea/);
    assert.doesNotMatch(code, /bg-white/);
});

test('pointer deltas convert through the shared scale helper', () => {
    assert.match(source(), /toSlidePx\(/);
    assert.doesNotMatch(source(), /1920 \/ bounds\.width/);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd apps/web && node --test ./test/slide-canvas-component.test.js
```

- [ ] **Step 3: Implement the component**

Create `apps/web/src/components/editor/slide-canvas.tsx`. It must:

1. Measure its container with a `ResizeObserver` and hold `scale` in state.
2. Render a wrapper of the container's size, containing a
   `width: SLIDE_W, height: SLIDE_H` stage with
   `transform: scale(scale)` and `transformOrigin: 'top left'`.
3. Set the stage's markup once per `baseHtml` with `dangerouslySetInnerHTML`.
4. In a `useEffect` keyed on `objectEdits`, for each edit:
   `stage.querySelector('[data-object-id="' + CSS.escape(edit.objectId) + '"]')`,
   then `element.style.display = 'none'` when `edit.delete`, otherwise
   `Object.assign(element.style, objectEditStyle(edit))` and — when
   `objectEditText(edit)` is not null — replace the element's text container
   with a single span carrying the first run's style (per the spec: the canvas
   must not show formatting the export will drop).
5. Attach a delegated `pointerdown` on the stage that resolves
   `event.target.closest('[data-object-id]')` and calls `onSelectObject`.
6. On double-click of a text or shape object, set `contentEditable` on it and
   call `onStartTextEdit`; on `input` call `onChangeText(id, el.innerText)`; on
   blur or Escape, clear `contentEditable`.
7. Draw the selection outline and the eight `RESIZE_HANDLES` (import from
   `@/lib/object-transform`) as absolutely positioned siblings inside the stage,
   using the selected element's `offsetLeft/offsetTop/offsetWidth/offsetHeight`.
8. Convert every pointer delta with `toSlidePx(delta, scale)`.

Keep the file focused on rendering and hit-testing; the arithmetic lives in
Task 4's module.

- [ ] **Step 4: Run and watch it pass**

```bash
cd apps/web && node --test ./test/slide-canvas-component.test.js
```

- [ ] **Step 5: Typecheck**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/editor/slide-canvas.tsx apps/web/test/slide-canvas-component.test.js
git commit -m "feat(editor): render the slide as live DOM instead of a PNG"
```

---

### Task 7: Wire SlideCanvas into the editor and delete the old surface

**Files:**
- Modify: `apps/web/src/app/editor/[id]/page.tsx` (the `previewUrl` branches at
  1998-2145, `nativeTextStyle` at 208-217, and the `previewStale` state)
- Modify: `apps/web/src/lib/api.ts` (add the template-html fetch)
- Test: `apps/web/test/html-slide-editing.test.js`

**Interfaces:**
- Consumes: everything from Tasks 3, 4 and 6.

- [ ] **Step 1: Update the guard test**

In `apps/web/test/html-slide-editing.test.js`, replace the assertions that
pin the old surface with ones that pin the new one:

```js
test('the editing surface is the slide itself, not a picture of it', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'editor', '[id]', 'page.tsx'), 'utf8');

    assert.match(source, /<SlideCanvas/);
    // The three approximations that made editing look like a notepad.
    assert.doesNotMatch(source, /function nativeTextStyle/);
    assert.doesNotMatch(source, /previewStale/);
    assert.doesNotMatch(source, /cqh/);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd apps/web && node --test ./test/html-slide-editing.test.js
```

- [ ] **Step 3: Fetch the base HTML**

Add to `apps/web/src/lib/api.ts`:

```ts
export const fetchSlideTemplateHtml = async (presentationId: string, order: number): Promise<string> => {
    const { data } = await api.get(`/presentations/${presentationId}/slides/${order}/template-html`);
    return typeof data?.html === 'string' ? data.html : '';
};
```

Match the file's existing export and client style rather than copying this
verbatim if it differs.

- [ ] **Step 4: Swap the canvas**

In `page.tsx`, replace the `previewUrl` editing branch with `<SlideCanvas …>`
when base HTML is available, keeping the PNG branch only as the fallback the
spec requires:

```tsx
if (baseHtml) {
    return <SlideCanvas
        baseHtml={baseHtml}
        objectEdits={content.objectEdits || []}
        selectedObjectId={selectedNativeObjectId}
        editingObjectId={editingNativeTextId}
        onSelectObject={onSelectNativeObject}
        onStartTextEdit={setEditingNativeTextId}
        onChangeText={(id, text) => updateNativeObjectContent(id, { text })}
        onTransform={(id, box) => updateNativeObjectContent(id, box)}
    />;
}
if (previewUrl) {
    return <img src={previewUrl} alt={`${slide.title || '슬라이드'} 미리보기`} className="h-full w-full object-contain" />;
}
```

- [ ] **Step 5: Delete the dead machinery**

Remove `nativeTextStyle`, the `previewStale` state and its opaque overlay, both
`<textarea>` blocks, and the `/19.2` and `/10.8` percentage conversions that
only existed to position boxes over the image. Keep the preview fetch — the
thumbnails and "일반 보기" still use it.

- [ ] **Step 6: Run the web suite and typecheck**

```bash
cd apps/web && pnpm test && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/editor apps/web/src/lib/api.ts apps/web/test/html-slide-editing.test.js
git commit -m "feat(editor): edit the slide in place and drop the notepad textarea"
```

---

### Task 8: End-to-end verification against both reference files

**Files:** none — this task proves the previous seven.

- [ ] **Step 1: Rebuild and restart**

```bash
docker compose up -d --build renderer api web
```

- [ ] **Step 2: Re-extract the reference PPTX template**

So the stored HTML gains `data-object-id` and the table fixes:

```bash
curl -s -b /tmp/cj -X POST http://localhost:4100/api/admin/templates/cms2hkmvr000d32is5bschjgo/reextract-pptx -w '\nHTTP %{http_code}\n'
```

- [ ] **Step 3: Confirm the ids reached the stored HTML**

```bash
docker compose exec -T postgres psql -U jaslide -d jaslide -t -A -c "select (config->'htmlSlides'->>0) ~ 'data-object-id' from \"Template\" where id='cms2hkmvr000d32is5bschjgo';"
```

Expected: `t`.

- [ ] **Step 4: Open the PPTX deck's editor and verify in the browser**

Open `http://localhost:3100/editor/cms2hl069000h32isc1jykbf3`. Confirm with the
browser tools that: the canvas contains no `<img>`; `[data-object-id]` elements
exist; double-clicking the title puts a caret in it; typing shows no white
rectangle and the table's borders and header fill stay visible; the on-screen
family resolves to NanumGothic.

- [ ] **Step 5: Compare against the server render**

Fetch `/api/export/<id>/preview?slide=0` and compare it with a screenshot of
the canvas. Differences in glyph shape or text size are failures; small
differences in anti-aliasing are not.

- [ ] **Step 6: Verify the ZIP deck too**

Repeat steps 4-5 for `cms2hvcli000s32iscl5646l1`.

- [ ] **Step 7: Confirm the export contract did not move**

```bash
cd apps/api && npx jest
curl -s -b /tmp/cj -o /tmp/out.pptx -w '%{http_code}\n' -X POST http://localhost:4100/api/export/cms2hl069000h32isc1jykbf3/pptx
```

Expected: all api tests pass; export returns 201 and the file still opens with
selectable text.

- [ ] **Step 8: Commit any fixes the verification surfaced**

---

## Self-Review

**Spec coverage.** SlideCanvas → Task 6. Base-HTML resolution and the endpoint →
Task 3. Browser-side merge → Tasks 4 and 6. In-place editing → Tasks 6 and 7.
`data-object-id` → Task 1. Fonts → Task 5. Extractor fidelity fixes → Task 2.
Deletions → Task 7. Error handling → Task 3 (empty string) and Task 7 (PNG
fallback). Testing and acceptance → Task 8.

**Known gap, deliberate.** The spec's ZIP-template fallback to element index
when `data-object-id` is absent is not its own task; it belongs inside Task 6's
lookup and is covered by Task 8 step 6 exercising a real ZIP deck.

**Type consistency.** `objectEditStyle`, `objectEditText`, `canvasScale`,
`toSlidePx`, `SLIDE_W`, `SLIDE_H` are defined in Task 4 and used under those
exact names in Task 6. `slideTemplateHtml` is named identically in the service,
the controller and its tests. `ObjectEdit` matches the `objectEdits` shape the
editor and `_apply_native_edit` already exchange.
