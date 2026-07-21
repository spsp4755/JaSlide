const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..', '..', '..');
// Read the current release version instead of hardcoding one, so this test
// doesn't go stale every time build-amd64-images.sh's default is bumped.
const currentVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const escapedVersion = currentVersion.replace(/\./g, '\\.');

test('offline deployment uses imported images and documents the required verification', () => {
    const compose = fs.readFileSync(path.join(root, 'docker-compose.offline.yml'), 'utf8');
    const guide = fs.readFileSync(path.join(root, 'docs', 'offline-deployment.md'), 'utf8');
    const kubernetesGuide = fs.readFileSync(path.join(root, 'docs', 'deployment.md'), 'utf8');
    const kustomization = fs.readFileSync(path.join(root, 'deploy', 'k8s', 'kustomization.yaml'), 'utf8');
    const manifest = fs.readFileSync(path.join(root, 'deploy', 'k8s', 'jaslide-k8s.yaml'), 'utf8');
    const releaseScript = fs.readFileSync(path.join(root, 'scripts', 'release', 'build-amd64-images.sh'), 'utf8');

    assert.doesNotMatch(compose, /^\s*build:/m);
    assert.match(compose, /image: jaslide\/api:offline/);
    assert.match(compose, /image: jaslide\/web:offline/);
    assert.match(compose, /image: jaslide\/renderer:offline/);
    assert.match(guide, /build-amd64-images\.sh/);
    assert.match(guide, /--offline --frozen-lockfile --trust-lockfile/);
    assert.match(releaseScript, /--platform linux\/amd64/);
    assert.match(releaseScript, /jaslide\/postgres:\$\{release_version\}/);
    assert.match(releaseScript, /jaslide\/redis:\$\{release_version\}/);
    assert.match(guide, new RegExp(`jaslide-v${escapedVersion}-linux-amd64-images\\.tar\\.gz`));
    assert.match(guide, /podman load -i/);
    assert.match(kubernetesGuide, /kubectl apply -k deploy\/k8s/);
    assert.match(kustomization, /namespace: jaslide/);
    assert.match(manifest, new RegExp(`jaslide/api:v${escapedVersion}`));
    assert.match(manifest, new RegExp(`jaslide/web:v${escapedVersion}`));
    assert.match(manifest, new RegExp(`jaslide/renderer:v${escapedVersion}`));
});
