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
    const manifest = fs.readFileSync(path.join(root, 'deploy', 'k8s', 'jaslide-k8s.yaml'), 'utf8');
    const namespaceManifest = fs.readFileSync(path.join(root, 'deploy', 'k8s', 'namespace.yaml'), 'utf8');
    const releaseScript = fs.readFileSync(path.join(root, 'scripts', 'release', 'build-amd64-images.sh'), 'utf8');

    assert.doesNotMatch(compose, /^\s*build:/m);
    assert.match(compose, new RegExp(`image: jaslide/core-api:\\$\\{JASLIDE_VERSION:-v${escapedVersion}\\}`));
    assert.match(compose, new RegExp(`image: jaslide/web:\\$\\{JASLIDE_VERSION:-v${escapedVersion}\\}`));
    assert.match(compose, new RegExp(`image: jaslide/renderer:\\$\\{JASLIDE_VERSION:-v${escapedVersion}\\}`));
    assert.equal((compose.match(/pull_policy: never/g) || []).length, 6);
    assert.match(guide, /build-amd64-images\.sh/);
    assert.doesNotMatch(guide, /pnpm (?:install|build)|nest build|prisma migrate/i);
    assert.match(releaseScript, /--platform linux\/amd64/);
    assert.match(releaseScript, /build_image core-api docker\/core-api\.Dockerfile/);
    assert.match(releaseScript, /jaslide\/postgres:\$\{release_version\}/);
    assert.match(releaseScript, /jaslide\/redis:\$\{release_version\}/);
    assert.match(guide, new RegExp(`jaslide-v${escapedVersion}-linux-amd64-images\\.tar\\.gz`));
    // No registry: each worker node imports the tar straight into containerd,
    // and the manifest references the bare image names the release script
    // already produces — no retagging/push step, no Harbor/Kustomize needed.
    assert.match(guide, /ctr -n k8s\.io images import/);
    assert.match(kubernetesGuide, /kubectl apply -f deploy\/k8s\/jaslide-k8s\.yaml/);
    assert.match(namespaceManifest, /name: jaslide/);
    assert.match(manifest, new RegExp(`jaslide/core-api:v${escapedVersion}`));
    assert.match(manifest, new RegExp(`jaslide/web:v${escapedVersion}`));
    assert.match(manifest, new RegExp(`jaslide/renderer:v${escapedVersion}`));
    assert.equal((manifest.match(/imagePullPolicy: Never/g) || []).length, 6);
});
