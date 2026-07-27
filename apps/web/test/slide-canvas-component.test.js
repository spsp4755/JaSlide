const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// Source assertions, not behaviour: rendering React needs a DOM this repo has
// no runner for. slide-canvas.test.js covers the arithmetic for real; these pin
// the structural decisions that made editing look like a notepad.
const source = () => fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'editor', 'slide-canvas.tsx'), 'utf8');

test('the slide is live DOM, scaled as one stage', () => {
    const code = source();

    assert.match(code, /dangerouslySetInnerHTML/);
    assert.match(code, /scale\(\$\{scale\}\)/);
    assert.match(code, /transformOrigin/);
    // The whole point: no picture beneath the editing surface, so the slide's
    // own background, cell fills and borders stay visible while typing.
    assert.doesNotMatch(code, /<img/);
});

test('objects are found by their native id', () => {
    assert.match(source(), /data-object-id="/);
});

test('text is edited in place, with nothing painted over the slide', () => {
    const code = source();

    assert.match(code, /contentEditable/);
    assert.doesNotMatch(code, /<textarea/);
    assert.doesNotMatch(code, /bg-white/);
});

test('pointer deltas convert once, through the shared scale helper', () => {
    const code = source();

    assert.match(code, /toSlidePx\(/);
    // The old canvas repeated this at every call site.
    assert.doesNotMatch(code, /1920 \/ bounds\.width/);
    assert.doesNotMatch(code, /\/ 19\.2/);
    assert.doesNotMatch(code, /\/ 10\.8/);
});

test('typing does not blow away the caret', () => {
    // Re-setting innerHTML on every keystroke would drop the selection mid-word.
    // The element being edited already holds the user's text, so it is skipped.
    assert.match(source(), /isEditing|editingRef|activeElement/);
});

test('a table cell is edited where it sits', () => {
    assert.match(source(), /td|cells/);
});
