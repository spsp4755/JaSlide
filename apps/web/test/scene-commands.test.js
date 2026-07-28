const assert = require('node:assert/strict');
const test = require('node:test');
const { compileModule } = require('./compile-module');

// Real behaviour: the undo stack is what Task 5 needs sitting above
// scene-canvas.tsx, which only ever emits commands and renders whatever
// scene it is handed — see that component's own doc comment.
const { initCommandStack, pushSceneCommand, undo, redo, canUndo, canRedo } = compileModule('src/lib/scene-commands.ts');

function scene(x) {
    return { width: 1920, height: 1080, objects: [{ id: 'a', type: 'shape', x, y: 0, width: 100, height: 100, rotation: 0, shape: 'rect', fill: '#fff', stroke: '#000', strokeWidth: 1 }] };
}

test('pushing a command moves the scene forward and clears redo', () => {
    let stack = initCommandStack(scene(0));
    stack = pushSceneCommand(stack, { objectId: 'a', patch: { x: 50 } });

    assert.equal(stack.present.objects[0].x, 50);
    assert.equal(canUndo(stack), true);
    assert.equal(canRedo(stack), false);
});

test('undo restores the previous scene and makes redo available', () => {
    let stack = initCommandStack(scene(0));
    stack = pushSceneCommand(stack, { objectId: 'a', patch: { x: 50 } });
    stack = undo(stack);

    assert.equal(stack.present.objects[0].x, 0);
    assert.equal(canUndo(stack), false);
    assert.equal(canRedo(stack), true);
});

test('redo replays what undo just took back', () => {
    let stack = initCommandStack(scene(0));
    stack = pushSceneCommand(stack, { objectId: 'a', patch: { x: 50 } });
    stack = undo(stack);
    stack = redo(stack);

    assert.equal(stack.present.objects[0].x, 50);
    assert.equal(canRedo(stack), false);
});

test('a new command after undo discards the abandoned redo branch', () => {
    // Undo to x=0, then take a different path (x=99) — the old x=50 branch
    // must not reappear on a later redo.
    let stack = initCommandStack(scene(0));
    stack = pushSceneCommand(stack, { objectId: 'a', patch: { x: 50 } });
    stack = undo(stack);
    stack = pushSceneCommand(stack, { objectId: 'a', patch: { x: 99 } });

    assert.equal(stack.present.objects[0].x, 99);
    assert.equal(canRedo(stack), false);
});

test('undo/redo on an empty stack is a no-op, not an error', () => {
    const stack = initCommandStack(scene(0));

    assert.equal(undo(stack).present.objects[0].x, 0);
    assert.equal(redo(stack).present.objects[0].x, 0);
});
