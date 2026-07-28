const assert = require('node:assert/strict');
const test = require('node:test');
const { compileModule } = require('./compile-module');

// Real behaviour, not a source-pattern match — this reducer is the one thing
// both the PPTX and HTML-ZIP editing paths will share, so its edge cases
// (unknown id, duplicate id, degenerate geometry) matter more than usual.
const { applySceneCommand } = compileModule('src/slide-scene.ts');

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
