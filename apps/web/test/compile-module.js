const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Compile one TypeScript module and require the result.
 *
 * Lets a test exercise real behaviour instead of matching source patterns.
 * Invokes tsc through `process.execPath` rather than `npx`: `spawnSync` does
 * not resolve `npx` on Windows (it is `npx.cmd`), so every test using this
 * pattern died with ENOENT before running a single assertion.
 *
 * @param {string} relativeSource e.g. 'src/lib/object-transform.ts'
 */
function compileModule(relativeSource) {
    const webRoot = path.join(__dirname, '..');
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaslide-compile-'));
    execFileSync(
        process.execPath,
        [require.resolve('typescript/bin/tsc'), relativeSource, '--outDir', outDir,
            '--module', 'commonjs', '--target', 'es2020'],
        { cwd: webRoot, stdio: 'pipe' },
    );
    return require(path.join(outDir, `${path.basename(relativeSource, '.ts')}.js`));
}

module.exports = { compileModule };
