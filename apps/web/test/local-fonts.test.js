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

test('the slide canvas can draw the fonts the renderer resolves to', () => {
    // The editor renders the slide itself now, and a PPTX names its runs in
    // Korean. The renderer resolves 나눔고딕 to NanumGothic.ttf; without the same
    // file the browser silently substitutes Malgun Gothic and the canvas stops
    // matching the export — the whole point of rendering it live.
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'globals.css'), 'utf8');
    const fonts = path.join(__dirname, '..', 'public', 'fonts');

    assert.match(css, /font-family:\s*'NanumGothic'/);
    assert.match(css, /font-family:\s*'나눔고딕'/);
    assert.match(css, /NanumGothicBold\.ttf/);
    assert.ok(fs.existsSync(path.join(fonts, 'NanumGothic.ttf')));
    assert.ok(fs.existsSync(path.join(fonts, 'NanumGothicBold.ttf')));
    // Redistributed under OFL-1.1, which requires the licence to travel with it.
    assert.ok(fs.existsSync(path.join(fonts, 'LICENSE-nanum.txt')));
});
