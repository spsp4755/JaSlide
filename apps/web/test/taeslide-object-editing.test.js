const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('TaeSlide editor persists generic HTML object styles', () => {
    const root = path.join(__dirname, '..', 'src');
    const editor = fs.readFileSync(path.join(root, 'app', 'editor', '[id]', 'page.tsx'), 'utf8');
    const layout = fs.readFileSync(path.join(root, 'app', 'layout.tsx'), 'utf8');

    assert.match(editor, /function updateHtmlObject/);
    assert.match(editor, /function htmlTextElements/);
    assert.match(editor, /const generatedText/);
    assert.match(editor, /AI 텍스트/);
    assert.match(editor, /fontSize/);
    assert.match(editor, /backgroundColor/);
    assert.match(editor, /addHtmlShape/);
    assert.match(editor, /addHtmlTable/);
    assert.match(editor, /addHtmlImage/);
    assert.match(editor, /addHtmlList/);
    assert.match(editor, /borderColor/);
    assert.match(editor, /fontFamily/);
    assert.match(editor, /fontWeight/);
    assert.match(editor, /fontStyle/);
    assert.match(editor, /textDecoration/);
    assert.match(editor, /ribbonTab/);
    assert.match(editor, /deleteHtmlObject/);
    assert.match(editor, /deleteSelectedHtmlObject/);
    assert.match(editor, /duplicateSelectedHtmlObject/);
    assert.match(editor, /function duplicateHtmlObject/);
    assert.match(editor, /function setHtmlList/);
    assert.match(editor, /setSelectedHtmlList/);
    assert.match(editor, /const EDITOR_COLORS/);
    assert.match(editor, /function ColorSwatches/);
    assert.match(editor, /\$\{label\} 메뉴/);
    // On-slide text editing moved into the canvas, where a caret goes into the
    // slide's own markup instead of into a labelled textarea drawn over a PNG.
    assert.match(
        fs.readFileSync(path.join(root, 'components', 'editor', 'slide-canvas.tsx'), 'utf8'),
        /contentEditable = 'true'/,
    );
    assert.match(editor, /persistHistoryState/);
    assert.match(editor, /saveSchedulerRef\.current\?\.cancelAll\(\)/);
    assert.doesNotMatch(editor, /onBlur=\{\(\) => \{ setInlineTextIndex\(null\); onSave\(\); \}\}/);
    assert.match(editor, /data-html-editor-frame/);
    assert.match(editor, /document\.body\.contentEditable = 'true'/);
    assert.match(editor, /contentEditable = 'true'/);
    assert.match(editor, /dataset\.taeslideEditorIndex/);
    assert.match(editor, /selectionchange/);
    assert.match(editor, /execCommand\(/);
    assert.match(editor, /event\.altKey/);
    assert.match(editor, /pointermove/);
    assert.match(editor, /selectedElement/);
    assert.match(editor, /selectedElement\.remove\(\)/);
    assert.match(editor, /candidate\?\.nodeType === 1/);
    // A ZIP deck edits its own generated markup in the iframe; only a PPTX deck,
    // whose content lives in objectEdits against a template layout, falls through
    // to the canvas. Reversing these two would hand ZIP slides a canvas that
    // renders the template instead of the deck.
    assert.ok(editor.indexOf('if (content.html && !nativeObjects.length)') < editor.indexOf('if (baseHtml)'));
    assert.match(editor, /startSlideSwipe/);
    assert.match(editor, /onNavigate/);
    assert.match(editor, /kind = 'rect'/);
    // The shape catalogue and its glyphs live in @/lib/shape-glyphs now, so the
    // picker, the HTML insert path and the exported PPTX cannot disagree.
    // shape-glyphs.test.js owns the assertions about the catalogue itself.
    assert.match(editor, /SHAPE_GROUPS, LINE_OPTIONS, glyphPath, isStrokeOnly, shapeSvgMarkup/);
    assert.match(editor, /function ShapePickerGlyph/);
    // The picker icon reads against the panel, so it tracks the theme. The shape
    // that lands on the slide keeps its own fixed colors via shapeSvgMarkup.
    const glyphMarkup = editor
        .slice(editor.indexOf('function ShapePickerGlyph'), editor.indexOf('function addHtmlShape'))
        .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
    assert.match(glyphMarkup, /stroke="currentColor"/);
    assert.doesNotMatch(glyphMarkup, /#202124|#FFFFFF/);
    // On-slide editing happens at the object's real size. This used to need a
    // container query and a /5.4 divisor to map points onto a scaled image;
    // the canvas renders the slide at 1920x1080 and scales the whole stage, so
    // a point is simply a point. slide-canvas.test.js checks the arithmetic.
    assert.doesNotMatch(editor, /function nativeTextStyle/);
    assert.doesNotMatch(editor, /cqh/);
    // A fresh blob handed straight to <img src> blanks for a frame; decode first.
    assert.match(editor, /image\.decode/);
    assert.match(editor, /shapeSvgMarkup\(kind, width, height\)/);
    assert.match(editor, /box-shadow:0 0 0 2px/);
    // Chrome follows the theme (bg-card); only the slide surface stays literally white.
    assert.match(editor, /overflow-visible border-b bg-card/);
    assert.match(editor, /w-\[1100px\] min-w-\[960px\]/);
assert.match(editor, /isFocusMode/);
assert.match(editor, /집중 보기/);
assert.match(editor, /window\.innerWidth < 1180/);
assert.match(editor, /isLeftPanelOpen/);
assert.match(editor, /isRightPanelOpen/);
assert.match(editor, /슬라이드 패널 접기/);
assert.match(editor, /AI 패널 접기/);
    assert.match(editor, /const nextIndex = getHtmlTextFields\(selectedSlide\.content\.html\)\.length/);
    assert.match(editor, /setRibbonTab\('home'\)/);
    assert.match(editor, /e\.key === 'Delete'/);
    assert.match(editor, /selectedNativeObjectId/);
    assert.match(editor, /updateNativeObject/);
    assert.match(editor, /nativeObjects/);
    // Objects used to be transparent boxes stacked on a PNG and marked with this
    // attribute. They are the slide's own elements now, found by the shape id the
    // extractor writes into the markup.
    assert.doesNotMatch(editor, /data-native-object/);
    assert.match(
        fs.readFileSync(path.join(root, 'components', 'editor', 'slide-canvas.tsx'), 'utf8'),
        /data-object-id="/,
    );
    assert.match(editor, /selectedNativeObject\.fontFamily/);
    assert.match(editor, /fontSize: Number/);
    assert.match(editor, /bold:/);
    assert.match(editor, /italic:/);
    assert.match(editor, /fillColor/);
    assert.match(editor, /lineColor/);
    assert.match(editor, /lineWidth/);
    assert.match(editor, /deleteNativeObject/);
    // Hiding a deleted object is the canvas's job now; the export still reads the
    // same `delete` flag off the edit.
    assert.match(
        fs.readFileSync(path.join(root, 'components', 'editor', 'slide-canvas.tsx'), 'utf8'),
        /edit\.delete/,
    );
    assert.match(editor, /item\.kind === 'image'/);
    assert.match(editor, /new-image-\$\{crypto\.randomUUID\(\)\}/);
    assert.match(editor, /imageData/);
    assert.match(editor, /insertNativeText/);
    assert.match(editor, /new-text-\$\{crypto\.randomUUID\(\)\}/);
    assert.match(editor, /id: item\.objectId/);
    assert.match(editor, /item\.addText/);
    assert.match(editor, /item\.imageData/);
    assert.match(editor, /taeslide-format/);
    assert.match(editor, /range\.surroundContents/);
    assert.match(editor, /span\.style\.fontSize/);
    assert.match(editor, /insertOrderedList/);
    assert.match(editor, /IndentIncrease/);
    assert.match(editor, /event\.key === 'Tab'/);
    assert.doesNotMatch(editor, /표 내용 \(줄마다 첫 번째 열\)/);

    // Text and table cells are edited in the slide itself. The overlay needed
    // separate editing state per object and per cell, plus a CSS grid rebuilt
    // from rowHeights and columnWidths to stand in for the table. The canvas
    // renders the deck's own <table>, so a cell is just a <td> with a caret in it.
    const canvas = fs.readFileSync(path.join(root, 'components', 'editor', 'slide-canvas.tsx'), 'utf8');
    assert.doesNotMatch(editor, /editingNativeTextId|editingNativeCell/);
    assert.doesNotMatch(editor, /gridTemplateRows|gridTemplateColumns/);
    assert.match(canvas, /contentEditable = 'true'/);
    assert.match(canvas, /'td, th'/);
    assert.match(canvas, /function writeCells/);
    assert.match(canvas, /function readCells/);
    assert.match(layout, /TaeSlide/);
});
