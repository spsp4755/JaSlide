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
