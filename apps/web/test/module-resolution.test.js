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

test('the native object overlay does not repaint text over the preview image', () => {
    const editor = fs.readFileSync(path.join(SRC, 'app', 'editor', '[id]', 'page.tsx'), 'utf8');
    const overlay = editor.slice(editor.indexOf('data-native-object'), editor.indexOf('htmlSelectionAreas.map'));

    // The preview PNG already contains the deck's text. Drawing it again in the
    // overlay showed every string twice, offset by the font difference.
    assert.doesNotMatch(overlay, /\{edit\.text \?\? object\.text \?\? ''\}<\/div>/);
    assert.doesNotMatch(overlay, />\{cellText\}<\/div>/);
    // The edit surfaces still carry the text.
    assert.match(overlay, /value=\{edit\.text \?\? object\.text \?\? ''\}/);
    assert.match(overlay, /value=\{cellText\}/);
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

test('an edit shows on the canvas before the new preview image arrives', () => {
    const editor = fs.readFileSync(path.join(SRC, 'app', 'editor', '[id]', 'page.tsx'), 'utf8');
    const overlay = editor.slice(editor.indexOf('data-native-object'), editor.indexOf('htmlSelectionAreas.map'));

    // Only while the image lags — painting over a current preview is the double-text bug.
    assert.match(overlay, /previewStale && editingNativeTextId !== object\.id && typeof edit\.text === 'string'/);
    assert.match(overlay, /previewStale && edit\.cells \? cellText : ''/);
});

test('the slide panel shows each slide, not the same grey icon', () => {
    const editor = fs.readFileSync(path.join(SRC, 'app', 'editor', '[id]', 'page.tsx'), 'utf8');
    const panel = editor.slice(editor.indexOf('function DraggableSlide'), editor.indexOf('interface EditableSlidePreviewProps'));

    assert.match(panel, /previewUrl\n?\s*\? <img src=\{previewUrl\}/);
    assert.match(editor, /previewUrl=\{thumbnails\[slide\.id\]\}/);
    // Filled one at a time so a thumbnail sweep never queues ahead of an edit.
    assert.match(editor, /await loadPreview\(index, presentation\.slides\[index\]\.id\)/);
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

test('shapes accept in-slide text editing, like Google Slides', () => {
    const editor = fs.readFileSync(path.join(SRC, 'app', 'editor', '[id]', 'page.tsx'), 'utf8');
    const overlay = editor.slice(editor.indexOf('data-native-object'), editor.indexOf('htmlSelectionAreas.map'));

    // An autoshape has a text frame, so double-click must open the editor on it too,
    // not only on text boxes.
    assert.match(overlay, /object\.kind !== 'text' && object\.kind !== 'shape'/);
    assert.doesNotMatch(overlay, /object\.kind === 'text' && editingNativeTextId/);
});
