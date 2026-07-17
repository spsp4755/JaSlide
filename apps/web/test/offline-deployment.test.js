const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..', '..', '..');

test('offline deployment uses imported images and documents the required verification', () => {
    const compose = fs.readFileSync(path.join(root, 'docker-compose.offline.yml'), 'utf8');
    const guide = fs.readFileSync(path.join(root, 'docs', 'offline-deployment.md'), 'utf8');

    assert.doesNotMatch(compose, /^\s*build:/m);
    assert.match(compose, /image: jaslide\/api:offline/);
    assert.match(compose, /image: jaslide\/web:offline/);
    assert.match(compose, /image: jaslide\/renderer:offline/);
    assert.match(guide, /docker save/);
    assert.match(guide, /docker load/);
    assert.match(guide, /--offline --frozen-lockfile --trust-lockfile/);
});
