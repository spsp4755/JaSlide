const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('HTML slides expose text-only editing without replacing the template markup', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'editor', '[id]', 'page.tsx'), 'utf8');

    assert.match(source, /function getHtmlTextFields/);
    assert.match(source, /function updateHtmlText/);
    assert.match(source, /function addHtmlText/);
    assert.match(source, /function getHtmlSelectionAreas/);
    assert.doesNotMatch(source, /if \(previewUrl && content\.html\)/);
    // A ZIP deck already edits its own markup in a scaled iframe; the overlay of
    // hit-boxes over a PNG that used to back it up is gone, and with it
    // startHtmlTransform. The eight-handle ring lives on the canvas now —
    // slide-canvas-component.test.js pins it, object-transform.test.js the geometry.
    assert.match(source, /srcDoc=\{frameHtml\}/);
    assert.doesNotMatch(source, /const startHtmlTransform/);
});

test('the editing surface is the slide itself, not a picture of it', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'editor', '[id]', 'page.tsx'), 'utf8');

    assert.match(source, /<SlideCanvas/);
    assert.match(source, /slideTemplateHtml/);
    // The three approximations that made on-slide editing read like a notepad:
    // a font size guessed from the container, an opaque cover for the stale
    // preview, and percentage geometry derived from the image's own size.
    assert.doesNotMatch(source, /function nativeTextStyle/);
    assert.doesNotMatch(source, /previewStale/);
    assert.doesNotMatch(source, /cqh/);
});

test('one formatting bar serves both deck kinds', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'editor', '[id]', 'page.tsx'), 'utf8');

    // The bar used to read selectedHtmlObject, which only a ZIP deck has. A
    // PPTX deck therefore showed "객체를 선택하면…" no matter what was selected,
    // and its font and size lived in a side panel behind 수동 편집.
    assert.match(source, /ribbonTab === 'home' \? \(activeFormat \?/);
    assert.match(source, /const activeFormat = canvasFormat \?\?/);
    assert.match(source, /const applyFormat = /);
    assert.doesNotMatch(source, /ribbonTab === 'home' \? \(selectedHtmlObject \?/);

    // Font family and size have to be on the bar, not behind a mode.
    assert.match(source, /aria-label="글꼴"[\s\S]{0,200}fontChoicesWith\(activeFormat\.fontFamily\)/);
    assert.match(source, /aria-label="글자 크기"/);
    assert.match(source, /aria-label="글자 크게"/);
    assert.match(source, /aria-label="글자 작게"/);
});

test('the toolbar formats a live text selection before it formats the whole object', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'editor', '[id]', 'page.tsx'), 'utf8');

    // Alignment and fill are paragraph/box properties, never per-character.
    assert.match(source, /const perCharacter = updates\.align === undefined && updates\.fillColor === undefined;/);
    assert.match(source, /if \(perCharacter && slideCanvasRef\.current\?\.formatSelection\(updates\)\) return;/);
    // A PPTX object's text is now paragraphs+runs, not a flat string — the
    // canvas serializes what it renders, so the object map never drifts from it.
    assert.match(source, /onChangeParagraphs=\{\(objectId, paragraphs\) => updateNativeObjectContent\(objectId, \{ paragraphs, text: undefined \}\)\}/);
    assert.doesNotMatch(source, /onChangeText=\{/);
});
