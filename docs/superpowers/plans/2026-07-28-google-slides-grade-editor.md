# Google Slides 수준 편집기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PPTX와 HTML ZIP 템플릿을 같은 슬라이드 객체 모델로 편집·저장·내보내기하여 Google Slides의 핵심 편집 흐름을 제공한다.

**Architecture:** HTML은 화면 표현물이며 저장 원본은 공통 `SlideScene`이다. PPTX와 HTML ZIP import가 scene을 만들고, 편집기와 PPTX/PDF export가 같은 scene을 사용한다. SVG 도형은 경로만 채우며 일반 HTML 객체만 CSS 박스 배경을 사용한다.

**Tech Stack:** Next.js 16 / React 19, NestJS, FastAPI + python-pptx, PostgreSQL, Docker. 외부 SaaS와 CDN은 사용하지 않는다.

## Global Constraints

- 폐쇄망 배포: Google Slides API·외부 폰트 호스트·CDN은 사용하지 않는다.
- 새 브라우저 플러그인은 필수가 아니다. 실시간 협업이 필요해질 때만 Yjs를 번들 의존성으로 검토한다.
- PPTX 원본의 위치, 크기, 표·도형·글꼴·서식을 가능한 한 보존하고, 미지원 요소는 업로드 결과에 표시한다.
- 각 작업은 관련 테스트, 실제 브라우저 확인, 독립 커밋으로 끝낸다.
- 새 객체도 선택, 이동, resize, 회전, 서식, 삭제, undo/redo가 가능해야 한다.

## 파일 및 책임 경계

- `packages/shared/src/slide-scene.ts`: `SlideScene`, 텍스트 run, 표 셀, 도형, 선, 이미지 타입과 command reducer.
- `apps/renderer/src/services/pptx_scene.py`: PPTX를 scene과 원본 shape mapping으로 변환.
- `apps/renderer/src/services/html_scene.py`: HTML ZIP을 scene과 원본 CSS/DOM fallback으로 변환.
- `apps/web/src/components/editor/scene-canvas.tsx`: scene의 DOM/SVG 렌더, 선택, in-place 편집, 변형.
- `apps/web/src/lib/scene-commands.ts`: move/resize/style/text/table 명령 및 undo/redo.
- `apps/renderer/src/services/scene_to_pptx.py`: scene을 원본 PPTX에 적용하거나 신규 객체로 export.

## 장면 모델 계약

```ts
export interface SlideScene {
  width: number;
  height: number;
  objects: SlideObject[];
}

export interface ShapeObject {
  id: string; type: 'shape'; shape: string;
  x: number; y: number; width: number; height: number; rotation: number;
  fill: string; stroke: string; strokeWidth: number;
}

export interface SceneCommand {
  objectId: string;
  patch: Partial<SlideObject>;
}
```

---

### Task 1: 공통 장면 모델과 명령 기반 저장

**Files:**
- Create: `packages/shared/src/slide-scene.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/api/src/modules/presentations/presentations.service.ts`
- Test: `packages/shared/test/slide-scene.test.ts`

**Produces:** `applySceneCommand(scene, command): SlideScene`. 존재하지 않는 id, 중복 id, 1 미만 width/height를 거부한다.

- [ ] **Step 1: 실패 테스트 작성**

```ts
it('moves only the requested object and preserves the rest', () => {
  const next = applySceneCommand(scene, { objectId: 'shape-1', patch: { x: 240 } });
  expect(next.objects.find((item) => item.id === 'shape-1')?.x).toBe(240);
  expect(next.objects.find((item) => item.id === 'text-1')).toEqual(scene.objects[1]);
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @jaslide/shared test -- slide-scene`

- [ ] **Step 3: 최소 구현**

객체 id를 한 번 찾고 patch 대상만 immutable merge한다. geometry는 scene 좌표로 유지하고 validation 실패는 명시적인 오류를 반환한다.

- [ ] **Step 4: 테스트와 커밋**

```bash
pnpm --filter @jaslide/shared test
git add packages/shared apps/api/src/modules/presentations
git commit -m "feat(scene): add canonical slide object model"
```

### Task 2: PPTX/HTML ZIP import를 장면 모델로 통일

**Files:**
- Create: `apps/renderer/src/services/pptx_scene.py`
- Create: `apps/renderer/src/services/html_scene.py`
- Modify: `apps/renderer/src/services/pptx_to_html.py`
- Test: `apps/renderer/tests/test_pptx_scene.py`
- Test: `apps/renderer/tests/test_html_scene.py`

**Consumes:** Task 1의 `SlideScene` JSON 계약.

**Produces:** 모든 객체에 안정적인 id 및 `sourceRef`를 부여한다. PPTX는 shape id, HTML은 selector와 원본 CSS를 보존한다.

- [ ] **Step 1: 실패 테스트 작성**

```python
def test_pptx_table_keeps_cells_borders_and_source_reference():
    scene = pptx_to_scene(_weekly_report_deck())
    table = next(item for item in scene["objects"] if item["type"] == "table")
    assert table["sourceRef"]["shapeId"]
    assert table["cells"][0][0]["border"]["bottom"]["width"] >= 0
```

- [ ] **Step 2: 실패 확인**

Run: `docker compose exec -T renderer python -m pytest tests/test_pptx_scene.py -q`

- [ ] **Step 3: importer 구현**

PPTX text run, table cell, fill, line, rotation, geometry를 scene 객체로 추출한다. HTML ZIP은 기존 DOM/CSS fallback과 편집 가능한 요소 selector를 함께 저장한다.

- [ ] **Step 4: 회귀와 커밋**

```bash
docker compose exec -T renderer python -m pytest tests/test_pptx_scene.py tests/test_html_scene.py -q
git add apps/renderer/src/services apps/renderer/tests
git commit -m "feat(renderer): normalize PPTX and HTML templates into scenes"
```

### Task 3: 객체별 렌더러와 Google Slides식 선택·변형

**Files:**
- Create: `apps/web/src/components/editor/scene-canvas.tsx`
- Create: `apps/web/src/lib/scene-commands.ts`
- Modify: `apps/web/src/lib/object-transform.ts`
- Test: `apps/web/test/scene-canvas.test.js`

**Produces:** shape는 SVG path만 fill, line은 stroke만 변경하며 text/table은 선택된 객체 내부에서만 편집한다. 선택할 때만 eight-handle outline을 표시한다.

- [ ] **Step 1: 실패 테스트 작성**

```js
test('an SVG shape never receives fill on its rectangular wrapper', () => {
  const code = source();
  assert.match(code, /path\.setAttribute\('fill', fill\)/);
  assert.match(code, /if \(paths\.length\)/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @jaslide/web test -- scene-canvas`

- [ ] **Step 3: 캔버스 구현**

객체 type별 renderer를 사용하고, 포인터 좌표는 slide scale을 한 번만 역변환한다. resize는 `resizeBox`를 통해 command를 만들며 선택 상태는 저장 scene과 분리한다.

- [ ] **Step 4: 브라우저 검증**

PPTX와 ZIP 템플릿 각각에서 화살표·삼각형·선을 삽입해 채우기, 선색, 회전, 8방향 resize 후 새로고침해도 도형 윤곽대로 유지되는지 확인한다.

- [ ] **Step 5: 테스트·빌드·커밋**

```bash
pnpm --filter @jaslide/web test
pnpm --filter @jaslide/web build
git add apps/web/src/components/editor apps/web/src/lib apps/web/test
git commit -m "feat(editor): render editable slide scenes by object type"
```

### Task 4: 텍스트와 표 셀의 부분 서식

**Files:**
- Modify: `packages/shared/src/slide-scene.ts`
- Modify: `apps/web/src/components/editor/scene-canvas.tsx`
- Modify: `apps/web/src/app/editor/[id]/page.tsx`
- Test: `apps/web/test/text-runs.test.js`

**Produces:** 텍스트와 표 셀의 `TextRun[]`에 글꼴, 크기, 굵게, 기울기, 밑줄, 색, 글머리, 들여쓰기를 선택 범위 단위로 적용한다.

- [ ] **Step 1: 실패 테스트 작성**

```js
test('formatting a selected table-cell word leaves sibling runs unchanged', () => {
  const next = formatRuns(cell.runs, { start: 3, end: 5 }, { bold: true });
  assert.equal(next[0].bold, false);
  assert.equal(next.find((run) => run.text === '보안').bold, true);
});
```

- [ ] **Step 2: 실패 확인 후 `formatRuns` 구현**

Run: `pnpm --filter @jaslide/web test -- text-runs`

- [ ] **Step 3: 표 명령 구현**

행/열 추가·삭제, 셀 배경·테두리, 병합은 `TableObject` patch로만 변경한다. 텍스트 선택이 없을 때에만 셀 전체 서식을 허용한다.

- [ ] **Step 4: 회귀·브라우저 테스트·커밋**

```bash
pnpm --filter @jaslide/web test
git add packages/shared apps/web
git commit -m "feat(editor): preserve formatted text runs inside table cells"
```

### Task 5: 저장, undo/redo, PPTX/PDF export 통합

**Files:**
- Modify: `apps/api/src/modules/presentations/presentations.service.ts`
- Modify: `apps/web/src/lib/scene-commands.ts`
- Create: `apps/renderer/src/services/scene_to_pptx.py`
- Test: `apps/api/src/modules/presentations/presentations.service.spec.ts`
- Test: `apps/renderer/tests/test_scene_to_pptx.py`

**Produces:** command stack undo/redo, debounce 저장, export 전 flush, 원본 PPTX shape mapping 및 신규 객체 fallback.

- [ ] **Step 1: 실패 테스트 작성**

```python
def test_exported_shape_uses_scene_fill_not_bounding_box():
    pptx = scene_to_pptx(_scene_with_blue_arrow())
    shape = _first_shape(pptx)
    assert shape.fill.fore_color.rgb == RGBColor(37, 99, 235)
```

- [ ] **Step 2: 실패 확인 및 exporter 구현**

Run: `docker compose exec -T renderer python -m pytest tests/test_scene_to_pptx.py -q`

- [ ] **Step 3: export round-trip 검증**

export된 PPTX를 다시 import하여 geometry, text run, table border, fill/stroke를 비교한다. PDF는 non-empty 및 페이지 수를 검증한다.

- [ ] **Step 4: 전체 테스트·커밋**

```bash
pnpm --filter @jaslide/web test
docker compose exec -T renderer python -m pytest tests -q
git add apps/api apps/renderer apps/web/src/lib
git commit -m "feat(export): export the canonical editable slide scene"
```

### Task 6: 템플릿 충실도와 폐쇄망 운영 검증

**Files:**
- Modify: `apps/api/src/modules/templates/*`
- Create: `docs/template-fidelity-verification.md`
- Test: `apps/renderer/tests/test_template_fidelity.py`

**Produces:** 업로드 결과에 지원 객체 수, 미지원 요소, 누락 글꼴, 재추출 정보를 보여주고 시각 차이를 자동 검증한다.

- [ ] **Step 1: 실패 테스트 작성**

```python
def test_weekly_report_template_preserves_header_table_and_fonts():
    result = compare_template_and_scene("tests/fixtures/weekly-report.pptx")
    assert result["tableBorderMismatch"] == 0
    assert result["missingFontFamilies"] == []
```

- [ ] **Step 2: 관리자 결과 화면 구현**

템플릿 목록에 지원 객체 수, 경고 수, 재추출 버튼, 다중 삭제를 제공한다. 경고는 “표 병합 2개는 이미지 fallback”처럼 구체적으로 표시한다.

- [ ] **Step 3: 폐쇄망 검증과 커밋**

```bash
docker compose up -d --build
pnpm --filter @jaslide/web test
docker compose exec -T renderer python -m pytest tests/test_template_fidelity.py -q
git add apps/api apps/renderer apps/web docs
git commit -m "feat(templates): verify editable template fidelity offline"
```

## Self-Review

- 공통 원본 모델: Task 1
- PPTX/HTML ZIP import와 원본 보존: Task 2
- 도형·선·선택·resize UX: Task 3
- 부분 텍스트와 표 셀 서식: Task 4
- 저장, 실행 취소, PPTX/PDF export: Task 5
- 어떤 템플릿에도 필요한 지원 범위와 경고: Task 6

**의도적 범위:** 실시간 다중 사용자 협업은 단일 사용자 편집과 export가 안정화된 뒤 별도 Yjs 기반 단계로 진행한다.

