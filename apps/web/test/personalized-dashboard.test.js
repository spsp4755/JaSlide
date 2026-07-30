const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const webRoot = path.join(__dirname, '..');

test('the API client exposes a recent-works client matching the Go route shape', () => {
    const api = fs.readFileSync(path.join(webRoot, 'src', 'lib', 'api.ts'), 'utf8');

    assert.match(api, /recentWorksApi/);
    assert.match(api, /api\.get\('\/recent-works'/);
    assert.match(api, /api\.post\(`\/recent-works\/\$\{presentationId\}`\)/);
});

test('opening a presentation in the editor records it as a recent work', () => {
    const editor = fs.readFileSync(path.join(webRoot, 'src', 'app', 'editor', '[id]', 'page.tsx'), 'utf8');

    assert.match(editor, /recentWorksApi\.record\(presentationId\)/);
});

test('the home dashboard shows recent works and favorite templates, with a toggle to favorite one', () => {
    const dashboard = fs.readFileSync(path.join(webRoot, 'src', 'app', 'dashboard', 'page.tsx'), 'utf8');

    assert.match(dashboard, /recentWorksApi\.list/);
    assert.match(dashboard, /favoritesApi\.list\('template'\)/);
    assert.match(dashboard, /최근 작업/);
    assert.match(dashboard, /즐겨찾기 템플릿/);
    assert.match(dashboard, /toggleTemplateFavorite/);
    // Only the "template" resource type is valid for a Favorite row (see
    // apps/core-api/internal/userfeatures/handlers.go's favoriteTypes) — a
    // presentation itself can never be the favorited resource.
    assert.match(dashboard, /favoritesApi\.add\('template', templateId\)/);
});
