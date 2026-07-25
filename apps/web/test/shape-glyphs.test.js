const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// The module is TypeScript and this runner is plain node, so evaluate the parts
// that matter as source: the kind lists and the glyph table must line up.
const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'shape-glyphs.ts'), 'utf8');

function kinds() {
    const groups = SOURCE.slice(SOURCE.indexOf('export const SHAPE_GROUPS'), SOURCE.indexOf('export const LINE_OPTIONS'));
    return [...groups.matchAll(/\['([A-Za-z0-9]+)', '/g)].map((match) => match[1]);
}

function lineKinds() {
    const lines = SOURCE.slice(SOURCE.indexOf('export const LINE_OPTIONS'), SOURCE.indexOf('const LINE_GLYPHS'));
    return [...lines.matchAll(/kind: '([A-Za-z0-9]+)'/g)].map((match) => match[1]);
}

function pathTable() {
    const table = SOURCE.slice(SOURCE.indexOf('const PATHS: Record<string, string> = {'), SOURCE.indexOf('export const SHAPE_GROUPS'));
    return new Set([...table.matchAll(/^ {4}([A-Za-z0-9]+):/gm)].map((match) => match[1]));
}

test('every shape in the picker has its own glyph, none silently falls back to a rectangle', () => {
    const table = pathTable();
    const missing = kinds().filter((kind) => !table.has(kind));

    // A kind with no entry renders as the generic rectangle, which is exactly the
    // bug this table replaced: 136 different shapes all drew the same icon.
    assert.deepEqual(missing, []);
});

// OOXML defines these flowchart presets with the same geometry as a basic shape,
// so sharing an outline is correct here and only here.
const SHARED_BY_SPEC = new Set(['flowChartProcess', 'flowChartDecision', 'flowChartInputOutput', 'flowChartConnector', 'flowChartExtract']);

test('no two shapes share the same outline', () => {
    const seen = new Map();
    const duplicates = [];
    const table = SOURCE.slice(SOURCE.indexOf('const PATHS: Record<string, string> = {'), SOURCE.indexOf('export const SHAPE_GROUPS'));
    for (const [, kind, value] of table.matchAll(/^ {4}([A-Za-z0-9]+): (.+),$/gm)) {
        const outline = value.trim();
        if (SHARED_BY_SPEC.has(kind)) continue;
        // Formula-built entries (polygon(6), star(8)) differ by argument, so compare literally.
        if (seen.has(outline)) duplicates.push(`${kind} === ${seen.get(outline)}`);
        else seen.set(outline, kind);
    }
    assert.deepEqual(duplicates, []);
});

test('every line option carries a glyph and the picker lists them all', () => {
    for (const kind of lineKinds()) {
        assert.match(SOURCE, new RegExp(`kind: '${kind}', label: '[^']+', glyph: 'M`), `${kind} has no glyph path`);
    }
    assert.ok(lineKinds().length >= 8, '구글 슬라이드 수준의 선 종류가 필요합니다');
});

test('the editor picker and the HTML insert path both draw the shared glyph', () => {
    const editor = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'editor', '[id]', 'page.tsx'), 'utf8');

    assert.match(editor, /from '@\/lib\/shape-glyphs'/);
    assert.match(editor, /glyphPath\(kind\)/);
    // The old zoom:0.065 trick scaled a full-size CSS box down to icon size and
    // lost every clip-path, which is why the icons looked broken.
    assert.doesNotMatch(editor, /zoom:0\.065/);
    assert.doesNotMatch(editor, /function shapeStyle/);
});
