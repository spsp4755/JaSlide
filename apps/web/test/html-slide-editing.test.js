const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('HTML slides expose text-only editing without replacing the template markup', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'editor', '[id]', 'page.tsx'), 'utf8');

    assert.match(source, /function getHtmlTextFields/);
    assert.match(source, /function updateHtmlText/);
    assert.match(source, /function addHtmlText/);
    assert.match(source, /html: updateHtmlText\(selectedSlide\.content\.html, index, \{ text: event\.target\.value \}\)/);
    assert.match(source, /const startHtmlTransform/);
    assert.match(source, /cursor-se-resize/);
    assert.match(source, /selectedHtmlTextIndex === area\.index/);
    assert.match(source, /function getHtmlSelectionAreas/);
    assert.doesNotMatch(source, /if \(previewUrl && content\.html\)/);
});
