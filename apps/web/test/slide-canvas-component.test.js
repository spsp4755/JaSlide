const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// Source assertions, not behaviour: rendering React needs a DOM this repo has
// no runner for. slide-canvas.test.js covers the arithmetic for real; these pin
// the structural decisions that made editing look like a notepad.
const source = () => fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'editor', 'slide-canvas.tsx'), 'utf8');

test('the slide is live DOM, scaled as one stage', () => {
    const code = source();

    assert.match(code, /stage\.innerHTML = baseHtml/);
    assert.match(code, /scale\(\$\{scale\}\)/);
    // One writer of the stage's markup. Handing React the same job through
    // dangerouslySetInnerHTML gave the node two owners, and React's copy — the
    // template with none of the edits applied — is the one that survived.
    assert.doesNotMatch(code, /dangerouslySetInnerHTML=/);
    assert.match(code, /transformOrigin/);
    // The whole point: no picture beneath the editing surface, so the slide's
    // own background, cell fills and borders stay visible while typing.
    assert.doesNotMatch(code, /<img/);
});

test('objects are found by their native id', () => {
    assert.match(source(), /data-object-id="/);
});

test('inserted shapes and lines create their own live canvas object', () => {
    const code = source();

    assert.match(code, /function createInsertedObject\(stage: HTMLElement, edit: ObjectEdit\)/);
    assert.match(code, /edit\.addShape \?\? edit\.addLine/);
    assert.match(code, /shapeSvgMarkup\(kind/);
    assert.match(code, /createInsertedObject\(stage, edit\)/);
});

test('shape fill changes update the live SVG before a preview refresh', () => {
    const code = source();

    assert.match(code, /setFillColor: \(objectId: string, fillColor: string\) => boolean/);
    assert.match(code, /querySelectorAll<SVGPathElement>\('svg path'\)/);
    assert.match(code, /path\.setAttribute\('fill', fillColor\)/);
});

test('text is edited in place, with nothing painted over the slide', () => {
    const code = source();

    assert.match(code, /contentEditable/);
    assert.doesNotMatch(code, /<textarea/);
    assert.doesNotMatch(code, /bg-white/);
});

test('pointer deltas convert once, through the shared scale helper', () => {
    const code = source();

    assert.match(code, /toSlidePx\(/);
    // The old canvas repeated this at every call site.
    assert.doesNotMatch(code, /1920 \/ bounds\.width/);
    assert.doesNotMatch(code, /\/ 19\.2/);
    assert.doesNotMatch(code, /\/ 10\.8/);
});

test('typing does not blow away the caret', () => {
    // Re-setting innerHTML on every keystroke would drop the selection mid-word.
    // The element being edited already holds the user's text, so it is skipped.
    assert.match(source(), /isEditing|editingRef|activeElement/);
});

test('a table cell is edited where it sits', () => {
    assert.match(source(), /td|cells/);
});

test('a second click can enter text editing without arming an immediate object drag', () => {
    const code = source();
    const doubleClickHandler = code.match(/const onStageDoubleClick = \(event: React\.MouseEvent\) => \{[\s\S]*?\n    \};/)?.[0] ?? '';

    // The old pointer-down handler called preventDefault before the browser had
    // a chance to dispatch dblclick. Its leftover window pointermove listener
    // then moved the table while the user was selecting a word.
    assert.match(code, /let dragging = Boolean\(handle\)/);
    assert.match(code, /if \(!dragging && Math\.hypot\(dx, dy\) < 4\) return;/);
    assert.match(code, /if \(handle\) event\.preventDefault\(\);/);
    assert.doesNotMatch(doubleClickHandler, /event\.preventDefault\(\)/);
    assert.match(code, /function selectWordAt\(element: HTMLElement, clientX: number, clientY: number\)/);
    assert.match(doubleClickHandler, /selectWordAt\(editTarget, event\.clientX, event\.clientY\)/);
});

test('a drag-selection is released when the caret leaves', () => {
    // Dropping contentEditable does not drop the highlight, so a selection
    // stayed lit across the slide until the next keystroke replaced it.
    const code = source();

    assert.match(code, /getSelection\(\)\?\.removeAllRanges\(\)/);
    // Blur is not delivered reliably when the pointer goes down elsewhere, so
    // the stage ends editing itself rather than waiting for it.
    assert.match(code, /stopEditing\(\);\s*\n\s*const object = target\.closest/);
});

test('Escape steps out of the text, then out of the selection', () => {
    const code = source();

    assert.match(code, /event\.key !== 'Escape'/);
    assert.match(code, /if \(editingRef\.current\) \{ stopEditing\(\); return; \}/);
    assert.match(code, /if \(selectedObjectId\) onSelectObject\(null\)/);
});

test('the canvas reports how the selection is formatted, for the toolbar', () => {
    const code = source();

    assert.match(code, /function readFormat/);
    assert.match(code, /onSelectionFormat\(element \? readFormat\(element, selectionRun\(element\)\) : null\)/);
    // Points, the unit the deck states and python-pptx wants back. CSS pt is
    // 1.333px, not the canvas 2px-per-point, so the conversion is explicit.
    assert.match(code, /parseFloat\(runStyle\.fontSize\) \/ CANVAS_PX_PER_PT/);
});

test('the toolbar reads the highlighted run instead of the object’s first run', () => {
    const code = source();

    assert.match(code, /function readFormat\(element: HTMLElement, preferredRun\?: HTMLElement\)/);
    assert.match(code, /selectionRun\(element\)/);
    assert.match(code, /onSelectionFormat\(element \? readFormat\(element, selectionRun\(element\)\) : null\)/);
});

test('a selected word can be formatted without formatting the whole object', () => {
    const code = source();

    // Same technique the ZIP HTML editor already uses for the same reason.
    assert.match(code, /range\.surroundContents\(span\)/);
    assert.match(code, /range\.extractContents\(\)/);
    assert.match(code, /function formatSelection|const formatSelection/);
    // Exposed imperatively so the toolbar (outside this component) can drive it.
    assert.match(code, /useImperativeHandle\(ref, \(\) => \(\{ formatSelection, setFillColor \}\)/);
    // Falls back to whole-object formatting when there is no live selection —
    // this is the caller's job, so formatSelection must report which happened.
    assert.match(code, /if \(!selection \|\| !range \|\| !element\.contains\(range\.commonAncestorContainer\)\) return false;/);
});

test('a toolbar click restores the text range it moved focus away from', () => {
    const code = source();

    // The HTML editor already keeps a saved Range. Without the same state on
    // the PPTX canvas, clicking a size button collapsed the selection and the
    // caller silently formatted the entire table object instead.
    assert.match(code, /const savedRangeRef = useRef<Range \| null>\(null\)/);
    assert.match(code, /document\.addEventListener\('selectionchange', onSelectionChange\)/);
    assert.match(code, /savedRangeRef\.current = selection\.isCollapsed \? null : range\.cloneRange\(\)/);
    assert.match(code, /const range = liveRange \?\? savedRangeRef\.current/);
    assert.match(code, /editingRef\.current\?\.getAttribute\('contenteditable'\) === 'true'/);
    assert.match(code, /function beginTextSelection\(element: HTMLElement, event: React\.PointerEvent\)/);
    assert.match(code, /beginTextSelection\(editingRef\.current, event\); return;/);
    assert.match(code, /if \(editingRef\.current === element\) return;/);
    assert.match(code, /editingRef\.current = null;[\s\S]*element\.blur\(\)/);
});

test('a table cell serializes character formatting through the same run path', () => {
    const code = source();
    assert.match(code, /onChangeCells\(objectId, readCells\(owner\)\)/);
    assert.doesNotMatch(code, /element\.tagName === 'TD' \|\| element\.tagName === 'TH'\) return false;/);
});

test('character formatting persists across the paragraphs data path, not flat text', () => {
    const code = source();

    assert.match(code, /function readParagraphs/);
    assert.match(code, /function writeParagraphs/);
    // Paragraphs win over flat text in the merge effect — see ObjectEdit.paragraphs.
    assert.match(code, /\} else if \(edit\.paragraphs\) \{/);
    // Every keystroke re-serializes the whole object, so a run bolded earlier
    // survives continued typing instead of being flattened to one run per line.
    assert.match(code, /onChangeParagraphs\(objectId, readParagraphs\(owner\)\)/);
});

test('reading runs back walks actual text nodes, not just direct span children', () => {
    // range.surroundContents nests the new span INSIDE the run it split, e.g.
    // <span run><span bold>AI</span> 엔지니어링…</span> — not a sibling. Reading
    // only the block's direct span children would see the outer run and miss
    // the nested one, silently discarding the formatting just applied.
    const code = source();

    assert.match(code, /function textNodesIn/);
    assert.match(code, /createTreeWalker\(block, NodeFilter\.SHOW_TEXT\)/);
    assert.match(code, /textNodesIn\(block\)\.map\(readRun\)/);
    assert.doesNotMatch(code, /Array\.from\(block\.childNodes\)\.map\(readRun\)/);
});
