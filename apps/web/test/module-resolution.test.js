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
