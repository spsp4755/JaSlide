# Scene 엔진을 실제 편집기에 연결하기

**Goal:** `docs/superpowers/plans/2026-07-28-google-slides-grade-editor.md`에서 독립적으로만 만들어진 `SlideScene`/`scene-canvas.tsx`를 실제 서비스 중인 편집기(`apps/web/src/app/editor/[id]/page.tsx`)에 연결한다. PPTX 소스 덱과 HTML ZIP 소스 덱 모두 대상이다.

**Context:** 이전 계획의 6개 작업은 `SlideScene` 모델, PPTX/HTML ZIP importer, `scene-canvas.tsx` 렌더링·선택·변형, 부분 서식, undo/redo, `scene_to_pptx` exporter를 각각 독립된 유닛 테스트와 함께 만들었지만 실제 데이터와 전혀 연결되지 않았다: 저장된 프레젠테이션의 슬라이드를 `SlideScene`으로 읽는 API가 없고, 편집한 scene을 저장하는 API가 없고, PPTX 내보내기도 여전히 기존 `objectEdits` 파이프라인을 쓴다. 기존에 저장된 모든 프레젠테이션은 legacy 포맷(`content.html` 또는 `content.objectEdits`)을 쓰고 있어 마이그레이션 없이 안전하게 전환해야 한다.

## 아키텍처 원칙

DB 저장 포맷은 바꾸지 않는다. `content.html`(HTML ZIP)과 `content.objectEdits`(PPTX)가 계속 유일한 저장 원본(source of truth)이다. `SlideScene`은 편집기가 화면에 띄우고 조작하는 동안만 존재하는 **뷰**이며, 저장·내보내기 시점에 다시 legacy 포맷으로 변환된다.

이 결정으로:
- `export.service.ts`, `PPTXGenerator`, Prisma 스키마, 기존 저장된 모든 프레젠테이션 — 전부 무변경.
- PPTX 실제 내보내기는 지금 코드 그대로 `content.objectEdits`를 사용한다.
- 새로 필요한 것은 legacy ↔ scene 양방향 변환기와, 그 변환기를 호출하는 얇은 API 두 개뿐이다.

## 기존 코드 재사용 근거

`pptx_scene.py`의 독스트링이 이미 이렇게 설명한다: `pptx_to_html.py`의 `source.slides[].objects[]`는 "라이브 캔버스용 얕은 객체 맵"이고, `pptx_scene.py`는 "저장 원본"(전체 텍스트 run, 정확한 geometry, `sourceRef`)이다. 두 표현 모두 같은 `shape.shape_id`로 키가 걸려 있고, 기존 `content.objectEdits`의 `objectId`도 같은 shape id를 쓴다. 따라서 PPTX 슬라이드를 매번 실제로 재생성(PPTXGenerator 호출)하지 않고도, **순수 데이터 변환만으로** "원본 scene + 저장된 objectEdits = 현재 편집된 scene"을 만들 수 있다.

`scene_to_pptx.py`는 이미 `scene_to_edits(scene) -> list[dict]`(scene을 legacy objectEdits 모양으로 변환)를 내부에 갖고 있고, 그 결과를 기존 `PPTXGenerator`에 넘기는 얇은 shim이다. 이 함수는 새 저장 경로에서 그대로 재사용한다.

## 데이터 흐름 — 불러오기

**PPTX 소스 덱:**
1. `pptx_to_scene(source_pptx)["slides"][templateIndex]` (기존 함수) → 원본 `SlideScene`.
2. **(신규)** `apply_edits_to_scene(base_scene, object_edits) -> SlideScene` — `scene_to_edits`의 역함수. 저장된 각 `objectEdits` 항목을 대응하는 `objectId`의 patch로 적용하고, 신규 삽입 객체(`addText`/`addShape`/`addLine`/`addTable`/`duplicate`)는 새 `SlideObject`로 추가하고, `delete: true`인 항목은 제거한다.

**HTML ZIP 소스 덱:**
1. `html_to_scene([content.html])["slides"][0]` (기존 함수, 그대로 재사용) — `content.html`이 이미 "현재 편집된 완전한 HTML"이므로 별도 edit 적용 단계가 필요 없다.

**신규 NestJS 엔드포인트:** `GET /presentations/:id/slides/:slideId/scene` — 위 두 경로 중 하나를 태워 `SlideScene` JSON을 반환한다. 기존 `presentationsApi.slideTemplateHtml`과 동일한 자리, 동일한 호출 패턴(슬라이드 전환 시 온디맨드 fetch).

## 데이터 흐름 — 저장

커밋된 `SceneCommand`마다(기존 디바운스 저장 스케줄러 재사용, 500ms):

**PPTX 소스 덱:** 현재 scene을 렌더러의 기존 `scene_to_edits(scene)`에 태워 `objectEdits` 배열을 받고, 기존 `slides.service.ts`의 `update()`로 `content.objectEdits`만 갱신한다.

**HTML ZIP 소스 덱:** **(신규)** `scene_to_html(scene) -> str` — `html_to_scene`의 `_slide_to_scene`이 만드는 것과 동일한 DOM 계약(`data-object="true"`, `data-object-type`, absolute position)으로 역직렬화한다. 결과 문자열을 기존 `update()`로 `content.html`에 통째로 교체 저장한다.

**신규 NestJS 엔드포인트:** `PATCH /presentations/:id/slides/:slideId/scene` — body로 `{ scene: SlideScene }`을 받아 위 변환 후 기존 슬라이드 저장 경로를 호출한다. 브라우저는 렌더러를 직접 호출하지 않는다 (기존 아키텍처 경계 유지, admin-templates의 fidelity/reextract와 동일한 프록시 패턴).

## 프론트엔드 변경 범위 (`apps/web/src/app/editor/[id]/page.tsx`)

**삭제 대상** (legacy 포맷별로 따로 있던 편집 로직, scene-canvas + scene-commands로 대체):
- HTML 텍스트/도형/표/이미지 DOM 조작: `updateHtmlObject`, `addHtmlShape`, `addHtmlTable`, `addHtmlList`, `addHtmlImage`, `deleteHtmlObject`, `duplicateHtmlObject`, `setHtmlList`, `htmlTextElements`, `getHtmlTextFields`, `getHtmlSelectionAreas`, `editorFrameHtml`, `resolveTemplateValue`/`getTemplatePreviewStyle` 중 편집 전용 부분.
- PPTX 네이티브 객체 편집: `updateNativeObject`, `insertNativeText`/`insertNativeTable`/`insertNativeShape`, `duplicateNativeObject`, `deleteNativeObject`, `nativeObjects`/`selectedNativeObject` 파생 로직.

**교체:** `<SlideCanvas ref={slideCanvasRef} .../>` → `<SceneCanvas scene={scene} selectedObjectId={...} onSelectObject={...} onSelectionFormat={setCanvasFormat} onCommand={...} />`. 툴바의 `applyFormat`은 이미 `SceneCanvasHandle`(`formatSelection`/`paintColor`/`toggleBulletAtCaret`/`changeIndentAtCaret`)에 맞게 설계돼 있어 툴바 UI 마크업은 대부분 그대로 두고 핸들러 연결만 바꾼다.

**그대로 두는 것:** 슬라이드 목록/드래그 정렬, 버전 히스토리, 댓글 패널, 공유, 내보내기 메뉴, AI 채팅 패널 UI, 미리보기(PNG) 캐시 로직.

## Undo/Redo

슬라이드 단위(추가/삭제/순서변경) undo/redo는 기존 `useEditorStore`(서버 재동기화, `persistHistoryState`) 그대로 유지한다. `scene-commands.ts`의 `CommandStack`은 `SceneCanvas` 내부에서 드래그/리사이즈 중 부드러운 미리보기 용도로만 쓰이고, 커밋된 명령은 지금의 `updateSlide` + 디바운스 저장과 동일한 경로(새 scene PATCH)를 탄다. 두 undo 시스템은 서로 다른 레이어(프레젠테이션 구조 vs. 객체 속성)에 있어 충돌하지 않는다.

## AI 채팅 편집 연동

AI 편집은 이미 서버(`generation.service.ts`)에서 `objectEdits`/`html`을 직접 만들어 저장한다. scene은 그 legacy 콘텐츠를 다시 읽어오는 뷰이므로, AI 편집 응답이 도착하면 해당 슬라이드의 scene을 다시 fetch(현재 미리보기 캐시를 무효화하는 것과 동일한 패턴)하기만 하면 된다. AI 관련 코드는 변경하지 않는다.

## 에러 처리

- **scene 로드 실패** (렌더러 변환 실패, 손상된 objectEdits 등): 토스트로 알리고 해당 슬라이드는 기존 PNG 미리보기만 보여주는 읽기 전용 상태로 폴백한다. 편집기 전체를 죽이지 않는다.
- **scene→legacy 저장 변환 실패**: 저장을 막고 에러 토스트를 띄운다. 실패한 변환 결과를 legacy 포맷 없이 그대로 밀어넣지 않는다 (데이터 유실 방지가 최우선).

## 명시적 범위 밖

- 표 행/열 삽입·삭제·병합 (기존 계획에서도 명시적으로 범위 밖).
- 실시간 다중 사용자 협업 (기존 계획에서 Yjs 기반 별도 단계로 이미 명시).
- 기존 저장된 프레젠테이션의 일괄 마이그레이션 — 애초에 필요 없다 (legacy 포맷이 계속 저장 원본이므로).
- `config.source.slides[].objects`(구 "얕은 객체 맵")를 생성 파이프라인(`generation.service.ts`의 `pptxObjectEdits`)에서 제거하는 것 — 이 스펙은 편집기의 읽기 경로만 바꾸며, 생성 시점 objectEdits 합성 로직은 그대로 이 맵을 계속 사용한다.

## 테스트 계획

- 렌더러: `apply_edits_to_scene`, `scene_to_html` 각각 신규 pytest (`test_pptx_scene.py`/`test_html_scene.py` 패턴과 동일하게 실제 참조 덱 픽스처 사용).
- API: 신규 scene GET/PATCH 엔드포인트에 대한 jest 스펙 (`admin-templates.service.spec.ts`처럼 axios/storage mock 기반).
- 웹: 유닛 테스트보다 실제 브라우저 검증이 핵심 — 실제 DB의 PPTX 소스 덱 1개, HTML ZIP 소스 덱 1개를 열어 텍스트/표/도형 편집, undo/redo, 새로고침 후 유지, PPTX 내보내기까지 확인한다.
