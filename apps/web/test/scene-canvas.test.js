const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// Source assertions, not behaviour: rendering React needs a DOM this repo has
// no runner for. Every check here pins a lesson the legacy slide-canvas.tsx
// paid for in real bugs across 11 commits — porting the fix forward, not just
// the shape, is the point of reading this file before writing scene-canvas.tsx.
const source = () => fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'editor', 'scene-canvas.tsx'), 'utf8');

test('renders from the shared SlideScene model, one command callback', () => {
    // The canvas is a controlled component: it emits SceneCommands and lets its
    // caller apply them (via applySceneCommand) and hand back a new scene —
    // exactly what Task 5's undo/redo needs to sit above this component rather
    // than inside it.
    const code = source();

    assert.match(code, /from '@jaslide\/shared'/);
    assert.match(code, /onCommand: \(command: SceneCommand\) => void/);
    assert.match(code, /scene: SlideScene/);
});

test('an SVG shape and a line share one renderer, and never receive fill on their wrapper', () => {
    // The exact bug fixed in 6ca5d80: painting element.style.background turned
    // an arrow or triangle into a colored rectangle because the wrapper, not
    // the path, took the fill.
    const code = source();

    assert.match(code, /shapeSvgMarkup\(/);
    assert.match(code, /querySelectorAll<SVGPathElement>\('svg path'\)/);
    assert.match(code, /path\.getAttribute\('fill'\) === 'none'/);
});

test('resize handles are a percentage ring, with lock-aspect and from-center modifiers', () => {
    const code = source();

    assert.match(code, /RESIZE_HANDLES/);
    assert.match(code, /LINE_RESIZE_HANDLES/);
    assert.match(code, /lockAspectRatio: moveEvent\.shiftKey/);
    assert.match(code, /fromCenter: moveEvent\.ctrlKey \|\| moveEvent\.metaKey/);
});

test('a drag is not armed until the pointer actually moves', () => {
    // Without this, a second click meant to open the caret in a table cell
    // (fix 40a15c5) was read as the start of a drag instead of a dblclick.
    const code = source();

    assert.match(code, /Math\.hypot\(dx, dy\) < 4/);
});

test('native text selection is driven explicitly, not left to the browser', () => {
    // The legacy canvas found native selection unreliable inside the scaled,
    // transformed stage (fix 6235623) and had to own it via caretRangeFromPoint
    // + Selection.modify. A transformed stage does not change between the two
    // canvases, so the same technique is required here too.
    const code = source();

    assert.match(code, /caretRangeFromPoint/);
    assert.match(code, /\.modify\?\.\(/);
});

test('a live selection survives the toolbar taking focus', () => {
    // Fix 0cc3447: a toolbar click blurs the editing element, which used to
    // collapse the selection before the format command could reach it.
    const code = source();

    assert.match(code, /savedRangeRef/);
    assert.match(code, /if \(editingRef\.current === element\) return;/);
});

test('character formatting walks text nodes, not direct span children', () => {
    // range.surroundContents nests the new span inside the run it split, not
    // beside it. Reading only direct children silently drops the very edit
    // just made — the bug caught in this session's own verification earlier.
    const code = source();

    assert.match(code, /createTreeWalker\(block, NodeFilter\.SHOW_TEXT/);
    assert.match(code, /range\.surroundContents\(span\)/);
});

test('formatting a selection that crosses an existing run boundary reaches every run inside it', () => {
    // Found in real-browser verification: selecting text spanning two
    // pre-existing runs makes surroundContents throw (its range isn't
    // wholly inside one element), so the code falls back to
    // extractContents+insertNode — which moves each run's own <span>,
    // explicit style and all, inside the new wrapper. Every run's own
    // font-weight/etc is set explicitly (buildParagraphElement never
    // leaves one to inherit), so that explicit value keeps winning over
    // the new wrapper's — the format silently never took effect until
    // the same update is also pushed onto each moved run directly.
    const code = source();

    assert.match(code, /span\.querySelectorAll<HTMLElement>\('\[style\]'\)\.forEach\(\(descendant\) => Object\.assign\(descendant\.style, runStyle\)\)/);
});

test('a table cell is edited in place, sharing the paragraph/run model with text objects', () => {
    const code = source();

    assert.match(code, /'td, th'/);
    assert.doesNotMatch(code, /<textarea/);
});

test('bullet and indent are toggled on the caret\'s own paragraph, from the shared pure helpers', () => {
    // toggleBullet/setParagraphLevel are pure and tested in packages/shared —
    // this only has to find the right paragraph block and hand it off.
    const code = source();

    assert.match(code, /import \{[\s\S]*?toggleBullet[\s\S]*?\} from '@jaslide\/shared'/);
    assert.match(code, /import \{[\s\S]*?setParagraphLevel[\s\S]*?\} from '@jaslide\/shared'/);
    assert.match(code, /toggleBulletAtCaret/);
    assert.match(code, /changeIndentAtCaret/);
});

test('the stage is built imperatively and skipped while a caret is live', () => {
    // Rendering scene.objects as JSX let React reconcile the paragraph markup
    // on every scene update — which happens on every keystroke — and React
    // resets the caret to the start of the text on each one, confirmed by
    // typing five characters in a row in the browser and watching them land
    // in reverse order at the front instead of appended at the caret. Building
    // real DOM nodes and skipping the rebuild entirely while editingRef is set
    // (the same guard the legacy canvas already validated) is what fixes it.
    const code = source();

    assert.match(code, /function buildObjectElement/);
    assert.match(code, /if \(!stage \|\| editingRef\.current\) return;/);
    assert.match(code, /stage\.replaceChildren\(\.\.\.scene\.objects\.map/);
    assert.doesNotMatch(code, /scene\.objects\.map\(\(object\) => \{[\s\S]{0,80}switch \(object\.type\)[\s\S]{0,80}return <Text/);
});

test('the object type union covers every SlideObject kind', () => {
    const code = source();

    for (const kind of ['text', 'table', 'shape', 'line', 'image']) {
        assert.match(code, new RegExp(`'${kind}'`), `no rendering branch for "${kind}"`);
    }
});
