const assert = require('node:assert/strict');
const test = require('node:test');
const { compileModule } = require('./compile-module');

// Real behaviour, not a source-pattern match. Every "notepad" symptom the old
// canvas had was arithmetic: /5.4cqh here, fontSize/4 there, a 12px floor on
// top. Compile the module and check the numbers.
const {
    objectEditBoxStyle, objectEditTextStyle, objectEditAlign, objectEditText,
    textRunStyle, paragraphPlainText,
    canvasScale, toSlidePx, SLIDE_W, SLIDE_H,
} = compileModule('src/lib/slide-canvas.ts');

test('the stage is the slide\'s own size and scales as one unit', () => {
    assert.equal(SLIDE_W, 1920);
    assert.equal(SLIDE_H, 1080);
    assert.equal(canvasScale(960), 0.5);
    assert.equal(canvasScale(1920), 1);
});

test('a pointer delta converts once, through the stage scale', () => {
    // A 40px drag on a half-scale canvas is an 80px move on the slide. The old
    // code repeated `* 1920 / bounds.width` at every call site instead.
    assert.equal(toSlidePx(40, 0.5), 80);
    assert.equal(toSlidePx(40, 1), 40);
    // A container measured before layout must not divide by zero.
    assert.equal(toSlidePx(40, 0), 40);
});

test('geometry is emitted in the slide\'s own pixels, not a derived percentage', () => {
    assert.deepEqual(
        objectEditBoxStyle({ objectId: '6', left: 140, top: 120, width: 800, height: 200 }),
        { left: '140px', top: '120px', width: '800px', height: '200px' },
    );
});

// The deck states its type on the runs, so an extracted slide carries
// <span style="font-size:44px"> inside the object. Styling only the container
// looked like nothing happened when the size or colour changed.
test('text formatting is kept apart from the box, because the runs carry it', () => {
    const edit = { objectId: '6', fontSize: 13, color: '#1A1A1A', left: 10, fillColor: '#FFF' };

    assert.deepEqual(objectEditBoxStyle(edit), { left: '10px', background: '#FFF' });
    assert.deepEqual(objectEditTextStyle(edit), { fontSize: '26px', color: '#1A1A1A' });
});

test('font size is the deck\'s point size, with no divisor and no floor', () => {
    // The old canvas divided by 5.4 or by 4 and clamped at 12px, so a 13pt
    // caption and a 22pt heading came out nearly the same size on screen.
    assert.deepEqual(objectEditTextStyle({ objectId: '6', fontSize: 13 }), { fontSize: '26px' });
    assert.deepEqual(objectEditTextStyle({ objectId: '6', fontSize: 22 }), { fontSize: '44px' });
});

test('only the properties an edit actually sets are emitted', () => {
    assert.deepEqual(objectEditBoxStyle({ objectId: '6' }), {});
    assert.deepEqual(objectEditTextStyle({ objectId: '6' }), {});
    assert.deepEqual(objectEditTextStyle({ objectId: '6', color: '#1A1A1A', bold: true }), {
        color: '#1A1A1A', fontWeight: '700',
    });
    // false is a real value: unbolding must emit 400, not nothing.
    assert.deepEqual(objectEditTextStyle({ objectId: '6', bold: false }), { fontWeight: '400' });
    assert.deepEqual(objectEditTextStyle({ objectId: '6', italic: false }), { fontStyle: 'normal' });
    assert.deepEqual(objectEditTextStyle({ objectId: '6', underline: true }), { textDecoration: 'underline' });
});

test('alignment is a paragraph property, reported on its own', () => {
    assert.equal(objectEditAlign({ objectId: '6', align: 'center' }), 'center');
    assert.equal(objectEditAlign({ objectId: '6' }), null);
    // It must not leak into the run styling, where it would do nothing.
    assert.deepEqual(objectEditTextStyle({ objectId: '6', align: 'center' }), {});
});

test('fill, line and rotation reach the element', () => {
    assert.deepEqual(
        objectEditBoxStyle({ objectId: '9', fillColor: '#FFEEEE', lineColor: '#202124', lineWidth: 2, rotation: 90 }),
        {
            background: '#FFEEEE', borderColor: '#202124', borderStyle: 'solid',
            borderWidth: '2px', transform: 'rotate(90deg)',
        },
    );
});

test('a zero line width is a hidden border, not a missing property', () => {
    assert.deepEqual(objectEditBoxStyle({ objectId: '9', lineWidth: 0 }), {
        borderWidth: '0px', borderStyle: 'solid',
    });
});

test('a run\'s style converts through the same point-to-pixel scale as the object', () => {
    // Same conversion, run grain instead of object grain — this is what lets
    // "select a word, bold it" land on that word alone.
    assert.deepEqual(textRunStyle({ text: 'bold', bold: true, fontSize: 20, color: '#FF0000' }), {
        fontWeight: '700', fontSize: '40px', color: '#FF0000',
    });
    assert.deepEqual(textRunStyle({ text: 'plain' }), {});
});

test('a paragraph\'s plain text is its runs joined in order', () => {
    assert.equal(paragraphPlainText({ text: '', runs: [{ text: 'Plain ' }, { text: 'bold', bold: true }] }), 'Plain bold');
    assert.equal(paragraphPlainText({ text: '', runs: [] }), '');
});

test('text is reported only when the edit carries it', () => {
    assert.equal(objectEditText({ objectId: '6', text: '주간 업무 보고' }), '주간 업무 보고');
    assert.equal(objectEditText({ objectId: '6' }), null);
    // An empty string is a real edit — the user cleared the box.
    assert.equal(objectEditText({ objectId: '6', text: '' }), '');
});
