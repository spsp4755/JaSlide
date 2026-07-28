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
 * The output directory lives inside `apps/web`, not the OS temp directory —
 * `object-transform.ts` and friends have no dependencies and worked fine
 * compiled anywhere, but the moment a module imports `@jaslide/shared`,
 * requiring it from a directory outside this workspace can never resolve that
 * package: Node's module resolution walks up from the file's own location
 * looking for `node_modules`, and a real OS temp dir has none of this
 * project's. Compiling under `apps/web/.test-compile/` keeps that walk inside
 * the workspace, where `node_modules/@jaslide/shared` actually exists.
 *
 * @param {string} relativeSource e.g. 'src/lib/object-transform.ts'
 */
function compileModule(relativeSource) {
    const webRoot = path.join(__dirname, '..');
    const compileRoot = path.join(webRoot, '.test-compile');
    fs.mkdirSync(compileRoot, { recursive: true });
    const outDir = fs.mkdtempSync(path.join(compileRoot, 'c-'));
    execFileSync(
        process.execPath,
        [require.resolve('typescript/bin/tsc'), relativeSource, '--outDir', outDir,
            '--module', 'commonjs', '--target', 'es2020'],
        { cwd: webRoot, stdio: 'pipe' },
    );
    return require(path.join(outDir, `${path.basename(relativeSource, '.ts')}.js`));
}

module.exports = { compileModule };
