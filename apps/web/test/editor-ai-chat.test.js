const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('editor provides whole-deck AI chat with numbered slide targeting', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'editor', '[id]', 'page.tsx'), 'utf8');

    assert.match(source, /function resolveAiEditTargets/);
    assert.match(source, /AI 채팅/);
    assert.match(source, /resolveAiEditTargets\(instruction, presentation\.slides\)/);
    assert.doesNotMatch(source, /showAiEditDialog/);
    assert.match(source, /const editedSlides = response\.data\.slides/);
    assert.match(source, /setPresentation\(\{[\s\S]*editedSlides/);
    // Refresh only the slides the AI actually edited, not the whole deck.
    assert.match(source, /invalidatePreviews\(targets\)/);
    assert.match(source, /role="separator"/);
    assert.match(source, /event\.key === 'Enter' && !event\.shiftKey/);
    assert.match(source, /new AbortController\(\)/);
    assert.match(source, /handleCancelAiChat/);
    assert.match(source, /previewCacheRef/);
    assert.match(source, /previewSlideIdRef\.current !== selectedSlideId/);
    // Neighbours only — module-resolution.test.js covers why the whole-deck loop went away.
    assert.match(source, /for \(const offset of \[1, -1\]\)/);
    assert.doesNotMatch(source, /<AiHintBar/);
});

test('presentation refresh keeps the selected slide when it still exists', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'stores', 'editor-store.ts'), 'utf8');

    assert.match(source, /setPresentation:\s*\(presentation\)\s*=>\s*\{\s*set\(\(state\)/s);
    assert.match(source, /presentation\.slides\.some\(\(slide\) => slide\.id === state\.selectedSlideId\)/);
});
