const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

test('workspace home hands a prompt to AI Slide and root opens the workspace', () => {
    const home = read('src', 'app', 'home', 'page.tsx');
    const root = read('src', 'app', 'page.tsx');
    const dashboard = read('src', 'app', 'dashboard', 'page.tsx');

    assert.match(home, /AI 슬라이드/);
    assert.match(home, /router\.push\(`\/dashboard\?focus=1&prompt=/);
    assert.match(home, /if \(!prompt\.trim\(\)\) return/);
    assert.match(home, /router\.push\('\/dashboard\?focus=1'\)/);
    assert.match(root, /isAuthenticated \? '\/home' : '\/login'/);
    assert.match(dashboard, /searchParams\.get\('prompt'\)/);
});

test('AI Slide prompt does not require a purpose preset', () => {
    const dashboard = read('src', 'app', 'dashboard', 'page.tsx');

    assert.doesNotMatch(dashboard, /PURPOSE_OPTIONS/);
    assert.doesNotMatch(dashboard, /selectedPurpose/);
});
