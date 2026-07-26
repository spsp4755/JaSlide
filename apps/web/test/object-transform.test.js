const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

// Real behaviour, not a source-pattern match: eight handles with mirrored sign
// conventions is exactly where geometry bugs hide. Compile the module and run it.
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaslide-transform-'));
execFileSync('npx', ['tsc', 'src/lib/object-transform.ts', '--outDir', outDir, '--module', 'commonjs', '--target', 'es2020'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'pipe',
});
const { resizeBox, nudgeBox, RESIZE_HANDLES, MIN_WIDTH, MIN_HEIGHT } = require(path.join(outDir, 'object-transform.js'));

const box = { left: 100, top: 100, width: 200, height: 100 };

test('a full ring of eight handles is offered', () => {
    assert.deepEqual(
        RESIZE_HANDLES.map((item) => item.handle),
        ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'],
    );
});

test('dragging the right or bottom edge grows the box and leaves the origin alone', () => {
    assert.deepEqual(resizeBox(box, 'e', 50, 0), { left: 100, top: 100, width: 250, height: 100 });
    assert.deepEqual(resizeBox(box, 's', 0, 40), { left: 100, top: 100, width: 200, height: 140 });
    assert.deepEqual(resizeBox(box, 'se', 50, 40), { left: 100, top: 100, width: 250, height: 140 });
});

test('dragging the left or top edge moves the origin and keeps the far edge fixed', () => {
    // Right edge must stay at 300, bottom at 200 — the bug this replaces was a
    // box that jumped sideways because only width changed.
    const west = resizeBox(box, 'w', 50, 0);
    assert.deepEqual(west, { left: 150, top: 100, width: 150, height: 100 });
    assert.equal(west.left + west.width, 300);

    const north = resizeBox(box, 'n', 0, 30);
    assert.deepEqual(north, { left: 100, top: 130, width: 200, height: 70 });
    assert.equal(north.top + north.height, 200);
});

test('the two remaining corners move both axes at once', () => {
    assert.deepEqual(resizeBox(box, 'nw', 50, 30), { left: 150, top: 130, width: 150, height: 70 });
    assert.deepEqual(resizeBox(box, 'sw', 50, 30), { left: 150, top: 100, width: 150, height: 130 });
    assert.deepEqual(resizeBox(box, 'ne', 50, 30), { left: 100, top: 130, width: 250, height: 70 });
});

test('an edge dragged past its opposite stops at the minimum instead of inverting', () => {
    const collapsed = resizeBox(box, 'w', 9999, 9999);
    assert.equal(collapsed.width, MIN_WIDTH);
    // The right edge is still where it was, so the box did not flip through itself.
    assert.equal(collapsed.left + collapsed.width, 300);

    const flat = resizeBox(box, 'n', 0, 9999);
    assert.equal(flat.height, MIN_HEIGHT);
    assert.equal(flat.top + flat.height, 200);
});

test('arrow keys nudge by one pixel, or ten with shift', () => {
    assert.deepEqual(nudgeBox(box, 'ArrowLeft', false), { ...box, left: 99 });
    assert.deepEqual(nudgeBox(box, 'ArrowDown', false), { ...box, top: 101 });
    assert.deepEqual(nudgeBox(box, 'ArrowRight', true), { ...box, left: 110 });
    assert.deepEqual(nudgeBox(box, 'ArrowUp', true), { ...box, top: 90 });
    assert.equal(nudgeBox(box, 'Enter', false), null);
});
