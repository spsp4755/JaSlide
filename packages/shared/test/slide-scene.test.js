const assert = require('node:assert/strict');
const { describe, it, test } = require('node:test');
const { compileModule } = require('./compile-module');

// Real behaviour, not a source-pattern match — this reducer is the one thing
// both the PPTX and HTML-ZIP editing paths will share, so its edge cases
// (unknown id, duplicate id, degenerate geometry) matter more than usual.
const { applySceneCommand, formatRuns, setParagraphLevel, toggleBullet } = compileModule('src/slide-scene.ts');

function scene() {
    return {
        width: 1920,
        height: 1080,
        objects: [
            { id: 'shape-1', type: 'shape', x: 100, y: 100, width: 200, height: 100, rotation: 0, shape: 'rect', fill: '#FF0000', stroke: '#000000', strokeWidth: 1 },
            { id: 'text-1', type: 'text', x: 400, y: 100, width: 300, height: 80, rotation: 0, paragraphs: [{ runs: [{ text: 'Hello' }] }] },
        ],
    };
}

test('moves only the requested object and preserves the rest', () => {
    const next = applySceneCommand(scene(), { objectId: 'shape-1', patch: { x: 240 } });

    assert.equal(next.objects.find((item) => item.id === 'shape-1').x, 240);
    assert.deepEqual(next.objects.find((item) => item.id === 'text-1'), scene().objects[1]);
});

test('rejects a command targeting an object that is not in the scene', () => {
    assert.throws(() => applySceneCommand(scene(), { objectId: 'missing', patch: { x: 0 } }), /missing/);
});

test('rejects a patch that would collide with another object\'s id', () => {
    assert.throws(
        () => applySceneCommand(scene(), { objectId: 'shape-1', patch: { id: 'text-1' } }),
        /duplicate|already/i,
    );
});

test('rejects width or height collapsing below 1', () => {
    assert.throws(() => applySceneCommand(scene(), { objectId: 'shape-1', patch: { width: 0 } }), /width/i);
    assert.throws(() => applySceneCommand(scene(), { objectId: 'shape-1', patch: { height: 0.5 } }), /height/i);
});

test('leaves the original scene untouched — commands never mutate in place', () => {
    const original = scene();
    const snapshotBefore = JSON.parse(JSON.stringify(original));

    applySceneCommand(original, { objectId: 'shape-1', patch: { x: 999 } });

    assert.deepEqual(original, snapshotBefore);
});

// formatRuns is the pure core behind selection-range formatting: given exactly
// where the user's caret was (character offsets), it must split runs at those
// boundaries and patch only the slice in range — independent of the DOM/
// browser quirks scene-canvas.tsx's surroundContents path has to work around.
describe('formatRuns', () => {
    const runs = () => [{ text: '보안 취약점 분석' }];

    it('formatting a selected word leaves the sibling text unchanged', () => {
        // "보안 " is 3 chars, "취약점" is the next 3.
        const next = formatRuns(runs(), { start: 3, end: 6 }, { bold: true });

        assert.equal(next.map((run) => run.text).join(''), '보안 취약점 분석');
        assert.equal(next.find((run) => run.text === '보안 ').bold, undefined);
        assert.equal(next.find((run) => run.text === '취약점').bold, true);
        assert.equal(next.find((run) => run.text === ' 분석').bold, undefined);
    });

    it('formatting across two existing runs splits both correctly', () => {
        const twoRuns = [{ text: 'Plain ', bold: false }, { text: 'already bold', bold: true }];

        // Select " already bo" — the space off the first run plus most of the second.
        const next = formatRuns(twoRuns, { start: 5, end: 16 }, { italic: true });

        assert.equal(next.map((run) => run.text).join(''), 'Plain already bold');
        assert.equal(next[0].text, 'Plain');
        assert.equal(next[0].italic, undefined);
        const middle = next.slice(1, -1).map((run) => run.text).join('');
        assert.equal(middle, ' already bo');
        assert.ok(next.slice(1, -1).every((run) => run.italic === true));
        assert.equal(next[next.length - 1].text, 'ld');
        assert.equal(next[next.length - 1].italic, undefined);
    });

    it('a range covering a whole run patches it without splitting', () => {
        const next = formatRuns(runs(), { start: 0, end: runs()[0].text.length }, { color: '#FF0000' });

        assert.equal(next.length, 1);
        assert.equal(next[0].color, '#FF0000');
    });

    it('an empty range leaves the runs untouched', () => {
        assert.deepEqual(formatRuns(runs(), { start: 2, end: 2 }, { bold: true }), runs());
    });
});

describe('paragraph-level bullet and indent', () => {
    const paragraph = () => ({ runs: [{ text: 'Point one' }], level: 0 });

    it('toggles a bullet on and back off', () => {
        const bulleted = toggleBullet(paragraph());
        assert.equal(bulleted.bulleted, true);
        assert.equal(toggleBullet(bulleted).bulleted, false);
    });

    it('increases and decreases indent level, never below zero', () => {
        assert.equal(setParagraphLevel(paragraph(), 1).level, 1);
        assert.equal(setParagraphLevel(paragraph(), -1).level, 0);
        assert.equal(setParagraphLevel({ ...paragraph(), level: 2 }, 1).level, 3);
    });
});
