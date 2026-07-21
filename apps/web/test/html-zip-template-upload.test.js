const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('admin templates exposes an HTML ZIP import action', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'admin', 'templates', 'page.tsx'), 'utf8');

    assert.match(source, /import-html-zip/);
    assert.match(source, /accept="\.zip,application\/zip/);
});

test('editor passes the selected template to its slide preview', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'editor', '[id]', 'page.tsx'), 'utf8');

    // Falls back to fetching the template by ID when the presentation response omits it.
    assert.match(source, /const template = response\.data\.template \|\| \(response\.data\.templateId/);
    assert.match(source, /templatesApi\.get\(response\.data\.templateId\)/);
    assert.match(source, /template,\s*\n\s*\}\);/);
});
