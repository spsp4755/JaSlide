const assert = require('node:assert/strict');
const test = require('node:test');
const { compileModule } = require('./compile-module');

// Real behaviour, not a source-pattern match: eight handles with mirrored sign
// conventions is exactly where geometry bugs hide. Compile the module and run it.
const { resizeBox, nudgeBox, snapBox, RESIZE_HANDLES, MIN_WIDTH, MIN_HEIGHT, SLIDE_WIDTH } = compileModule('src/lib/object-transform.ts');

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

test('a dragged box snaps onto another object\'s edge and reports the guide', () => {
    const other = { left: 500, top: 400, width: 200, height: 100 };
    // Left edge 5px short of the other's left edge — inside the threshold.
    const result = snapBox({ left: 495, top: 800, width: 100, height: 50 }, [other]);

    assert.equal(result.box.left, 500);
    assert.deepEqual(result.guides.vertical, [500]);
    assert.equal(result.box.top, 800, 'an axis with nothing to snap to must not move');
});

test('centres snap to each other, not just edges', () => {
    const other = { left: 0, top: 500, width: 400, height: 100 };  // centre y = 550
    const result = snapBox({ left: 900, top: 522, width: 100, height: 50 }, [other]); // centre y = 547

    assert.equal(result.box.top + 25, 550);
    assert.deepEqual(result.guides.horizontal, [550]);
});

test('the slide centre is always a snap target', () => {
    const result = snapBox({ left: SLIDE_WIDTH / 2 - 6, top: 100, width: 200, height: 100 }, []);

    assert.equal(result.box.left, SLIDE_WIDTH / 2);
    assert.deepEqual(result.guides.vertical, [SLIDE_WIDTH / 2]);
});

test('a box further away than the threshold is left exactly where it was', () => {
    const other = { left: 500, top: 400, width: 200, height: 100 };
    const box = { left: 460, top: 800, width: 100, height: 50 };
    const result = snapBox(box, [other]);

    assert.deepEqual(result.box, box);
    assert.deepEqual(result.guides, { vertical: [], horizontal: [] });
});

test('the closest alignment wins when several are in range', () => {
    const near = { left: 502, top: 0, width: 10, height: 10 };
    const far = { left: 507, top: 0, width: 10, height: 10 };
    const result = snapBox({ left: 500, top: 800, width: 100, height: 50 }, [far, near]);

    assert.equal(result.box.left, 502);
});
