const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('layout uses bundled Korean fonts instead of Google Fonts', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'layout.tsx'), 'utf8');

    assert.doesNotMatch(source, /next\/font\/google/);
    assert.match(source, /next\/font\/local/);
    assert.match(source, /NotoSansKR-Regular\.otf/);
});
