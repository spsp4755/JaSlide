const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const webRoot = path.join(__dirname, '..');

test('skills gallery provides the approved offline entry points', () => {
    const gallery = fs.readFileSync(path.join(webRoot, 'src', 'components', 'skills', 'skills-gallery.tsx'), 'utf8');

    assert.match(gallery, /PPTX\/PDF에서 만들기/);
    assert.match(gallery, /직접 만들기/);
    assert.match(gallery, /템플릿 갤러리에서 선택/);
    assert.match(gallery, /추천 Skill/);
    assert.doesNotMatch(gallery, /\.zip Skill/);
});

test('skills are available from the authenticated menu and a public preview route', () => {
    const shell = fs.readFileSync(path.join(webRoot, 'src', 'components', 'layout', 'app-shell.tsx'), 'utf8');
    const page = fs.readFileSync(path.join(webRoot, 'src', 'app', 'skills', 'page.tsx'), 'utf8');
    const preview = fs.readFileSync(path.join(webRoot, 'src', 'app', 'demo', 'skills', 'page.tsx'), 'utf8');

    assert.match(shell, /href: '\/skills'/);
    assert.match(page, /<SkillsGallery \/>/);
    assert.match(preview, /<SkillsGallery preview \/>/);
});
