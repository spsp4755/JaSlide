const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const webRoot = path.join(__dirname, '..');

test('generation api client exposes role-preview and lock endpoints', () => {
    const api = fs.readFileSync(path.join(webRoot, 'src', 'lib', 'api.ts'), 'utf8');
    assert.match(api, /rolePreview:\s*\(templateId: string/);
    assert.match(api, /\/generation\/templates\/\$\{templateId\}\/role-preview/);
    assert.match(api, /lockObject:\s*\(templateId: string/);
    assert.match(api, /\/generation\/templates\/\$\{templateId\}\/objects\/\$\{objectId\}\/lock/);
});

test('outline review polls role-preview by array position and stops once ready', () => {
    const dashboard = fs.readFileSync(path.join(webRoot, 'src', 'app', 'dashboard', 'page.tsx'), 'utf8');

    assert.match(dashboard, /generationApi\.rolePreview\(/);
    assert.match(dashboard, /attempts < 30/);
    assert.match(dashboard, /status === 'ready'/);
    assert.match(dashboard, /rolePreviewKey/);
});

test('outline review shows role labels with a lock/unlock toggle', () => {
    const dashboard = fs.readFileSync(path.join(webRoot, 'src', 'app', 'dashboard', 'page.tsx'), 'utf8');

    assert.match(dashboard, /ROLE_LABELS/);
    assert.match(dashboard, /고정하기/);
    assert.match(dashboard, /고정 해제/);
    assert.match(dashboard, /generationApi\.lockObject\(/);
});
