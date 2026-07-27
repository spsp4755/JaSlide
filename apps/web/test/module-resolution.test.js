const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const SRC = path.join(__dirname, '..', 'src');
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];

function sourceFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        return /\.tsx?$/.test(entry.name) ? [full] : [];
    });
}

// A `@/` import with no file behind it builds fine under `next dev` but fails
// `next build`, so it only surfaces when the Docker image is built.
test('every @/ import resolves to a file that exists', () => {
    const missing = [];
    for (const file of sourceFiles(SRC)) {
        const source = fs.readFileSync(file, 'utf8');
        for (const [, specifier] of source.matchAll(/from\s+'@\/([^']+)'/g)) {
            if (!EXTENSIONS.some((extension) => fs.existsSync(path.join(SRC, specifier + extension)))) {
                missing.push(`${path.relative(SRC, file)} -> @/${specifier}`);
            }
        }
    }
    assert.deepEqual(missing, []);
});

test('the slide save scheduler exposes the API the editor calls', () => {
    const scheduler = fs.readFileSync(path.join(SRC, 'lib', 'slide-save-scheduler.ts'), 'utf8');

    assert.match(scheduler, /export function createSlideSaveScheduler/);
    assert.match(scheduler, /schedule\(slideId: string/);
    assert.match(scheduler, /cancelAll\(\)/);
    assert.match(scheduler, /flushAll\(\)/);
    // One timer per slide id — a single shared timer would drop slide A's save
    // when slide B is edited inside the debounce window.
    assert.match(scheduler, /new Map<string/);
});

test('the debounced save reads the slide from the store, not a stale closure', () => {
    const editor = fs.readFileSync(path.join(SRC, 'app', 'editor', '[id]', 'page.tsx'), 'utf8');
    const callback = editor.slice(editor.indexOf('createSlideSaveScheduler(async'));

    // The scheduler is built once while `presentation` is still null, so a
    // captured copy never finds the slide: the save no-ops and the editor
    // stays on "저장 대기 중" forever.
    assert.match(callback.slice(0, 900), /useEditorStore\.getState\(\)\.presentation\?\.slides\.find/);
    assert.doesNotMatch(callback.slice(0, 900), /const slide = presentation\?\.slides\.find/);
});

test('the editing canvas has no image to draw text twice over', () => {
    const editor = fs.readFileSync(path.join(SRC, 'app', 'editor', '[id]', 'page.tsx'), 'utf8');
    const canvas = fs.readFileSync(path.join(SRC, 'components', 'editor', 'slide-canvas.tsx'), 'utf8');

    // Text used to appear twice — once baked into the preview PNG and once in the
    // overlay drawn on top, offset by the font difference. The old fix was to
    // paint the overlay only while the image lagged. The canvas removes the
    // premise instead: it renders the slide, so there is no second copy to
    // disagree with and no image underneath to cover up.
    assert.match(editor, /<SlideCanvas/);
    assert.doesNotMatch(canvas, /<img/);
    assert.match(canvas, /dangerouslySetInnerHTML/);
});

test('a preview refresh invalidates only the slides that changed', () => {
    const editor = fs.readFileSync(path.join(SRC, 'app', 'editor', '[id]', 'page.tsx'), 'utf8');

    // A single global counter dropped every slide's cached preview, and the effect
    // then re-rendered the whole deck through LibreOffice on every keystroke's save.
    assert.doesNotMatch(editor, /setPreviewVersion/);
    assert.match(editor, /invalidatePreviews\(\[slideId\]\)/);
    assert.match(editor, /const key = `\$\{slideId\}:\$\{previewRevisions\[slideId\] \|\| 0\}`/);
    // Prefetch neighbours, not the entire deck: the renderer serves one at a time.
    assert.match(editor, /for \(const offset of \[1, -1\]\)/);
});

test('an edit shows immediately, without waiting for a server render', () => {
    const canvas = fs.readFileSync(path.join(SRC, 'components', 'editor', 'slide-canvas.tsx'), 'utf8');

    // This used to need an opaque patch drawn over the stale PNG until LibreOffice
    // caught up ~1s later. Now the edited DOM *is* the slide, so the change is on
    // screen as it is typed and the edits reapply locally.
    assert.match(canvas, /objectEdits\.forEach/);
    assert.match(canvas, /contentEditable/);
    assert.doesNotMatch(canvas, /previewStale|previewUrl/);
});

test('the slide panel shows each slide, not the same grey icon', () => {
    const editor = fs.readFileSync(path.join(SRC, 'app', 'editor', '[id]', 'page.tsx'), 'utf8');
    const panel = editor.slice(editor.indexOf('function DraggableSlide'), editor.indexOf('interface EditableSlidePreviewProps'));

    assert.match(panel, /previewUrl\n?\s*\? <img src=\{previewUrl\}/);
    assert.match(editor, /previewUrl=\{thumbnails\[slide\.id\]\}/);
    // Filled one at a time so a thumbnail sweep never queues ahead of an edit.
    assert.match(editor, /await loadPreview\(index, presentation\.slides\[index\]\.id\)/);
});

test('a table can be inserted on a PPTX slide, at a chosen size', () => {
    const editor = fs.readFileSync(path.join(SRC, 'app', 'editor', '[id]', 'page.tsx'), 'utf8');

    // The 표 button only rewrote content.html, so on a PPTX-backed slide it just
    // showed "HTML 템플릿 슬라이드가 필요합니다" — with a table-based report template,
    // which is the whole point, inserting a table was impossible.
    assert.match(editor, /const insertNativeTable = \(rows: number, columns: number\)/);
    assert.match(editor, /addTable: \{ rows, columns \}/);
    assert.match(editor, /source\?\.kind === 'pptx'\) insertNativeTable\(rows, columns\)/);
    // Size chosen before inserting: a fixed 3x3 cannot grow afterwards.
    assert.match(editor, /aria-label=\{`\$\{rows\}행 \$\{columns\}열 표`\}/);
});

test('the insert dropdowns dismiss and switch groups without a mouse', () => {
    const editor = fs.readFileSync(path.join(SRC, 'app', 'editor', '[id]', 'page.tsx'), 'utf8');

    // They used to close only by clicking their own button again, leaving the shape
    // sheet over the canvas, and groups switched on hover alone — unusable on touch.
    assert.match(editor, /closest\?\.\('\[data-insert-picker\]'\)/);
    assert.match(editor, /event\.key === 'Escape'\) close\(\)/);
    assert.match(editor, /onClick=\{\(\) => setShapePickerGroup\(index\)\}/);
    assert.match(editor, /aria-expanded=\{showShapePicker\}/);
});

test('a PPTX slide shows a rendering state instead of a fake slide', () => {
    const editor = fs.readFileSync(path.join(SRC, 'app', 'editor', '[id]', 'page.tsx'), 'utf8');

    // Without this the generic type-based editor flashed a different slide for the
    // second the renderer needs.
    assert.match(editor, /슬라이드를 그리고 있습니다/);
    assert.ok(
        editor.indexOf('슬라이드를 그리고 있습니다') < editor.lastIndexOf('switch (slide.type)'),
        'the rendering state must come before the generic fallback',
    );
});

test('exporting flushes pending edits and reports why it failed', () => {
    const editor = fs.readFileSync(path.join(SRC, 'app', 'editor', '[id]', 'page.tsx'), 'utf8');
    const handler = editor.slice(editor.indexOf("const handleExport = async"), editor.indexOf('// AI Edit handler'));

    // The renderer builds from stored state, so a debounced edit had to land first.
    assert.match(handler, /await saveSchedulerRef\.current\?\.flushAll\(\)/);
    // Error bodies arrive as bytes on an arraybuffer response; decode them.
    assert.match(handler, /data instanceof ArrayBuffer \|\| data instanceof Blob/);
    assert.doesNotMatch(handler, /toast\(\{ title: '내보내기 실패', variant: 'destructive' \}\)/);
});

test('an empty template list tells the user what to do next', () => {
    const dashboard = fs.readFileSync(path.join(SRC, 'app', 'dashboard', 'page.tsx'), 'utf8');

    // It used to be one dead sentence: "사용 가능한 템플릿이 없습니다."
    assert.doesNotMatch(dashboard, /사용 가능한 템플릿이 없습니다/);
    assert.match(dashboard, /템플릿 없이 생성하면 기본 레이아웃을 사용합니다/);
    // Only an admin can add one, so only an admin is offered the link.
    assert.match(dashboard, /isAdminRole\(user\?\.role\)[\s\S]{0,120}\/admin\/templates/);
});

test('the model connection test reports through a toast, not a blocking dialog', () => {
    const models = fs.readFileSync(path.join(SRC, 'app', 'admin', 'models', 'page.tsx'), 'utf8');

    assert.doesNotMatch(models, /^\s*alert\(/m);
    assert.match(models, /showToast\(\n?\s*result\.success/);
    assert.match(models, /role="status" aria-live="polite"/);
});

test('the admin template screen speaks Korean throughout', () => {
    const admin = fs.readFileSync(path.join(SRC, 'app', 'admin', 'templates', 'page.tsx'), 'utf8');

    // "PPTX 템플릿을…" is fine; a message with no Hangul at all is not.
    const english = [...admin.matchAll(/showToast\('([^']+)'/g)]
        .map((match) => match[1])
        .filter((message) => !/[가-힣]/.test(message));
    assert.deepEqual(english, []);
});

test('manual editing has the handles, keys and stacking Google Slides users expect', () => {
    const editor = fs.readFileSync(path.join(SRC, 'app', 'editor', '[id]', 'page.tsx'), 'utf8');
    const canvas = fs.readFileSync(path.join(SRC, 'components', 'editor', 'slide-canvas.tsx'), 'utf8');

    // The eight-handle ring moved to the canvas along with dragging; a single
    // bottom-right handle meant an object could only ever grow down and right.
    assert.match(canvas, /RESIZE_HANDLES\.map/);
    assert.match(canvas, /startDrag\(event, handle\)/);
    assert.match(canvas, /startDrag\(event, null\)/);

    // Delete used to only remove HTML objects, so a selected PPTX object ignored the key.
    assert.match(editor, /if \(selectedNativeObjectId\) deleteNativeObject\(\)/);
    assert.match(editor, /nudgeBox\(/);
    // Z-order: reaching the object underneath an overlapping one.
    assert.match(editor, /order: 'front'/);
    assert.match(editor, /order: 'back'/);

    // Ctrl+D used to duplicate the whole slide when an object was selected.
    assert.match(editor, /else if \(selectedNativeObjectId\) duplicateNativeObject\(\)/);
    assert.match(editor, /duplicate: selectedNativeObjectId/);
    // A rotation control, so an inserted arrow can point somewhere other than its preset.
    assert.match(editor, /aria-label="회전 각도"/);
    assert.match(editor, /rotation: Number\(event\.target\.value\)/);

    // Snap guides while dragging; object-transform.test.js covers the geometry.
    assert.match(canvas, /snapBox\(\{ \.\.\.initial, left: initial\.left \+ dx, top: initial\.top \+ dy \}, neighbours\)/);
    assert.match(canvas, /snapGuides\?\.vertical\.map/);
    // They must not linger once the pointer is released.
    // \r?\n, not \n: the repo checks out CRLF on Windows and this assertion
    // failed there for the line ending rather than for anything it tests.
    assert.match(canvas, /const stop = \(\) => \{\r?\n?\s*setSnapGuides\(null\);/);
});

test('shapes accept in-slide text editing, like Google Slides', () => {
    const canvas = fs.readFileSync(path.join(SRC, 'components', 'editor', 'slide-canvas.tsx'), 'utf8');

    // An autoshape has a text frame, so double-click must open the caret on it as
    // well as on a text box. Only a picture has nothing to type into — the canvas
    // now excludes that one kind instead of allowing two.
    assert.match(canvas, /onStageDoubleClick/);
    assert.match(canvas, /dataset\.objectType === 'image'/);
    assert.match(canvas, /beginEditing\(/);
});
