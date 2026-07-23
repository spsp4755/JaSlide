const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const webRoot = path.join(__dirname, '..');

test('home requests an editable outline before starting generation', () => {
    const dashboard = fs.readFileSync(path.join(webRoot, 'src', 'app', 'dashboard', 'page.tsx'), 'utf8');

    assert.match(dashboard, /generationApi\.outline\(/);
    assert.match(dashboard, /handleApproveOutline/);
    assert.match(dashboard, /outline:\s*cleaned/);
    assert.match(dashboard, /order:\s*index \+ 1/);
    assert.match(dashboard, /addKeyPoint/);
    assert.match(dashboard, /addSlide/);
    assert.match(dashboard, /moveSlide/);
    assert.match(dashboard, /removeSlide/);
    assert.match(dashboard, /최소 1장 필요/);
    assert.match(dashboard, /slides\.length < 1/);
});

test('generation api client exposes the outline endpoint', () => {
    const api = fs.readFileSync(path.join(webRoot, 'src', 'lib', 'api.ts'), 'utf8');
    assert.match(api, /outline:\s*\(data: any\) => api\.post\('\/generation\/outline', data\)/);
});

test('skills page uses the shared application sidebar', () => {
    const skills = fs.readFileSync(path.join(webRoot, 'src', 'app', 'skills', 'page.tsx'), 'utf8');
    assert.match(skills, /import \{ AppShell \} from '@\/components\/layout\/app-shell';/);
    assert.match(skills, /<AppShell><SkillsGallery \/><\/AppShell>/);
});

test('presentations page exposes a confirmed delete action', () => {
    const page = fs.readFileSync(path.join(webRoot, 'src', 'app', 'presentations', 'page.tsx'), 'utf8');
    assert.match(page, /presentationsApi\.delete\(presentation\.id\)/);
    assert.match(page, /window\.confirm/);
});

test('editor resolves imported template CSS variables for editable content', () => {
    const editor = fs.readFileSync(path.join(webRoot, 'src', 'app', 'editor', '[id]', 'page.tsx'), 'utf8');

    assert.match(editor, /function resolveTemplateValue/);
    assert.match(editor, /matchAll/);
    assert.match(editor, /style=\{\{ color: previewStyle\.color, fontFamily: previewStyle\.fontFamily \}\}/);
    assert.match(editor, /exportApi\.preview\(presentationId, slideIndex\)/);
    assert.match(editor, /URL\.createObjectURL/);
    assert.match(editor, /<img src=\{previewUrl\}/);
});
