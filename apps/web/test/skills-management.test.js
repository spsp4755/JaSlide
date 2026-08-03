const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const webRoot = path.join(__dirname, '..');

test('the API client exposes update/delete/previewHtml for a single skill', () => {
    const api = fs.readFileSync(path.join(webRoot, 'src', 'lib', 'api.ts'), 'utf8');

    assert.match(api, /update:\s*\(id:\s*string,\s*data:\s*\{\s*name\?:\s*string;\s*scope\?:\s*'private'\s*\|\s*'organization'\s*\|\s*'public';?\s*\}\)\s*=>\s*\n?\s*api\.patch\(`\/skills\/\$\{id\}`,\s*data\)/);
    assert.match(api, /delete:\s*\(id:\s*string\)\s*=>\s*api\.delete\(`\/skills\/\$\{id\}`\)/);
    assert.match(api, /previewHtml:\s*\(id:\s*string\)\s*=>\s*api\.get\(`\/skills\/\$\{id\}\/preview-html`\)/);
});

test('the Skill type carries visibility and template linkage fields', () => {
    const gallery = fs.readFileSync(path.join(webRoot, 'src', 'components', 'skills', 'skills-gallery.tsx'), 'utf8');

    assert.match(gallery, /isPublic:\s*boolean;/);
    assert.match(gallery, /organizationId:\s*string \| null;/);
    assert.match(gallery, /templateId:\s*string \| null;/);
});

test('each skill card has a menu with rename and delete, backed by modals', () => {
    const gallery = fs.readFileSync(path.join(webRoot, 'src', 'components', 'skills', 'skills-gallery.tsx'), 'utf8');

    assert.match(gallery, /openMenuId/);
    assert.match(gallery, /MoreVertical/);
    assert.match(gallery, /이름 변경/);
    assert.match(gallery, /skillsApi\.update\(renamingSkill\.id,\s*\{\s*name:\s*renameValue\.trim\(\)\s*\}\)/);
    assert.match(gallery, /skillsApi\.delete\(skill\.id\)/);
    assert.match(gallery, /setSkills\(\(current\) => current\.filter\(\(item\) => item\.id !== (deletingSkill\.id|skill\.id)\)\)/);
});

test('a visibility badge cycles scope and a filter narrows by scope', () => {
    const gallery = fs.readFileSync(path.join(webRoot, 'src', 'components', 'skills', 'skills-gallery.tsx'), 'utf8');

    assert.match(gallery, /const scopeOf = \(skill: Skill\)/);
    assert.match(gallery, /const nextScope = \(/);
    assert.match(gallery, /usersApi\.getProfile\(\)/);
    assert.match(gallery, /scopeFilter/);
    assert.match(gallery, /cycleScope/);
});

test('clicking a card with a linked template opens a scaled preview iframe', () => {
    const gallery = fs.readFileSync(path.join(webRoot, 'src', 'components', 'skills', 'skills-gallery.tsx'), 'utf8');

    assert.match(gallery, /skillsApi\.previewHtml\(skill\.id\)/);
    assert.match(gallery, /skill\.templateId && openPreview\(skill\)/);
    assert.match(gallery, /srcDoc={previewHtml/);
    assert.match(gallery, /sandbox=""/);
    assert.match(gallery, /ResizeObserver/);
});
