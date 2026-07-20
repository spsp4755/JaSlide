const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const webRoot = path.join(__dirname, '..');

test('home requests an editable outline before starting generation', () => {
    const dashboard = fs.readFileSync(path.join(webRoot, 'src', 'app', 'dashboard', 'page.tsx'), 'utf8');

    // Submit generates an outline draft, not a job.
    assert.match(dashboard, /generationApi\.outline\(/);
    // A review step exists with its own approve handler.
    assert.match(dashboard, /handleApproveOutline/);
    assert.match(dashboard, /아웃라인 검토/);
    // Approval submits the edited outline to start.
    assert.match(dashboard, /outline:\s*cleaned/);
    // Order is renumbered on submit.
    assert.match(dashboard, /order:\s*index \+ 1/);
    // Editing affordances are present.
    assert.match(dashboard, /addKeyPoint/);
    assert.match(dashboard, /moveSlide/);
    assert.match(dashboard, /removeSlide/);
});

test('generation api client exposes the outline endpoint', () => {
    const api = fs.readFileSync(path.join(webRoot, 'src', 'lib', 'api.ts'), 'utf8');
    assert.match(api, /outline:\s*\(data: any\) => api\.post\('\/generation\/outline', data\)/);
});
