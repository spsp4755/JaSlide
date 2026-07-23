const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('home accepts PPTX uploads and exposes the upload mode', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'dashboard', 'page.tsx'), 'utf8');
    const api = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'api.ts'), 'utf8');

    assert.match(source, /presentationml\.presentation/);
    assert.match(source, /내용으로 사용/);
    assert.match(source, /Skill\/템플릿으로 등록/);
    assert.match(source, /generationApi\.extractSource\(sourceFile\)/);
    assert.match(source, /sourceType:\s*'TEXT'/);
    assert.match(api, /extractSource:\s*async \(file: File\)/);
    assert.match(api, /generation\/source\/extract/);
    assert.match(source, /setPptxMode\('skill'\)/);
    assert.match(source, /const importedSkill = await handleImportSkill\(\)/);
    assert.match(source, /skillId: generationSkillId/);
    assert.match(source, /setOutlineContext\(\{ skillId: generationSkillId, templateId: generationTemplateId \}\)/);
    assert.match(source, /templateId: outlineContext\?\.templateId \?\? selectedTemplateId/);
});
