const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

for (const page of ['dashboard/page.tsx', 'page.tsx']) {
    test(`${page} logs out on the server before clearing local auth`, () => {
        const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', page), 'utf8');

        assert.match(source, /import\s*{[^}]*authApi[^}]*}\s*from\s*['"]@\/lib\/api['"]/);
        assert.match(source, /const handleLogout = async \(\) =>\s*{[\s\S]*?await authApi\.logout\(\)[\s\S]*?finally\s*{[\s\S]*?clearAuth\(\)/);
    });
}
