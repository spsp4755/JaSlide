# PPTX 불릿/들여쓰기 충실도 개선 — Design Spec

Date: 2026-08-03

## Context

PPTX 템플릿 기반 생성(native `objectEdits` 경로)에서 LLM이 만든 불릿 콘텐츠의
들여쓰기 레벨(`level`)이 실제 익스포트된 PPTX/PDF에 시각적으로 전혀 반영되지
않는 문제가 있었다. 이전 세션에서는 이를 "모델이 레벨을 잘 안 준다"는 모델
능력 한계로 결론지었으나, 이번에 GitHub의 다른 구현(`sjlee-netizen/my-agent-ppt`
저장소의 `apps/filler`, PPTX 채우기 파이프라인을 Go로 새로 짠 것)을 참고 검토하며
코드를 다시 확인한 결과, **엔진(렌더러) 설계 자체의 한계**라는 게 더 근본적인
원인으로 확인됐다.

`apps/renderer/src/generators/pptx_generator.py`의 `_write_paragraphs`(및
`_apply_native_edit` 안에 거의 동일하게 중복된 블록, 396~431줄)는 문단을
`frame.clear()` 후 매번 새로 만들고 `paragraph.level = N`만 세팅한다. 이건
python-pptx에서 `<a:pPr lvl="N">` 숫자만 바꾸는 것이고, 실제 불릿 기호·들여쓰기
간격(`marL`/`indent`/`buChar`)은 그 숫자에서 자동으로 나오지 않는다 — 슬라이드
레이아웃/마스터가 레벨별 리스트 스타일(`a:lstStyle`)을 따로 정의해둔 경우에만
반영되는데, 실무에서 손으로 디자인된 PPTX 템플릿 대부분은 문단마다 서식을
개별적으로 하드코딩해두고 레벨 기반 캐스케이딩 스타일을 정의하지 않는다. 그
결과 LLM이 정확한 레벨을 줘도 화면엔 반영이 안 된다.

참고한 저장소의 `apply.go`(`writeLines` 함수)는 다른 접근을 쓴다: 그 도형/셀에
원래 있던 문단들을 레벨별로 스캔해 원형(prototype)으로 보관하고, 모델이 준
`{level, text}` 줄마다 **그 레벨에 실제로 있던 원본 문단을 통째로 복제**한 뒤
텍스트 런만 바꿔치운다. `a:pPr`/`a:rPr`은 원본 그대로라 템플릿에 없던 서식을
새로 만들어낼 수가 없다. `draft.go`는 추가로 슬롯별 "실제 쓸 수 있는 레벨
집합"(`available_levels`)을 모델에게 알려주고, "이전 내용은 유지 대상이 아니라
참고용"이라는 프레이밍과 리터럴 불릿 문자 금지 지시를 프롬프트에 넣는다.

부수적으로, 에디터 미리보기(`apps/web/src/components/editor/scene-canvas.tsx:155`)는
`paragraph.level * 24px`로 들여쓰기를 계산해 템플릿 지원 여부와 무관하게 항상
시각적으로 들여써 보여준다는 것도 확인했다 — 미리보기/익스포트가 이 지점에서
서로 다르게 동작할 수 있는 별개의 문제이나, 이번 스코프에서는 다루지 않는다.

## Scope

**포함:**
- `apps/renderer/src/generators/pptx_generator.py`: `_write_paragraphs` 재작성
  (레벨별 원본 문단 복제 + 폴백), `_apply_native_edit`의 중복 로직을
  `_write_paragraphs` 재사용으로 정리
- `apps/core-api/internal/generation/llm.go` + `service.go`(또는
  `hierarchy_guidance.go`): 슬라이드에 있는 편집 가능 개체들의 실제 레벨
  집합을 합집합으로 계산해 `slidePrompt`에 반영
- `slidePrompt`의 시스템 프롬프트: "이전 내용은 유지 대상 아님" 프레이밍 강화,
  리터럴 불릿 기호 금지 지시 추가
- 렌더러 쪽 방어적 스트리핑: 모델이 그래도 `-`/`•`/`·` 등을 텍스트 앞에 써넣으면
  제거

**제외 (다음 단계로 미룸):**
- 에디터 미리보기(`scene-canvas.tsx`)의 `level*24px` 방식 — 사용자가 명시적으로
  이번 범위에서 제외하기로 결정
- 슬롯별(개체별) 진짜 정밀 지정 스키마로 재설계 (참고 저장소의 `draft.go`
  수준의 정밀도) — 지금은 슬라이드당 통짜 `bullets` 배열 하나를 여러 개체에
  나눠 붓는 구조라, 이걸 개체별 스키마로 바꾸는 건 스코프가 훨씬 크다. 이번
  개선의 효과를 보고 필요하면 별도 스펙으로 다룬다
- 표 행 늘리기/줄이기 로직 — 손 안 댐
- XML을 파싱 안 하고 바이트 오프셋으로만 자르고 붙이는 방식 — 렌더러 전체를
  다시 짜야 해서 범위가 너무 크다

## Architecture

### 1. 렌더러 — `apps/renderer/src/generators/pptx_generator.py`

**`_write_paragraphs(frame, paragraphs)` 재작성:**

```python
def _write_paragraphs(self, frame: Any, paragraphs: list) -> None:
    prototypes_by_level: dict[int, list] = {}
    for paragraph in frame.paragraphs:
        prototypes_by_level.setdefault(paragraph.level or 0, []).append(
            copy.deepcopy(paragraph._p)
        )
    used: dict[int, int] = {}

    def pick_prototype(level: int):
        if not prototypes_by_level:
            return None
        same = prototypes_by_level.get(level)
        if not same:
            nearest = min(prototypes_by_level, key=lambda existing: abs(existing - level))
            same = prototypes_by_level[nearest]
        index = used.get(level, 0)
        used[level] = index + 1
        return same[min(index, len(same) - 1)]

    frame.clear()
    # frame.clear() leaves one empty default paragraph behind — remove it so
    # appending prototype clones doesn't leave a stray blank line first.
    frame._txBody.remove(frame.paragraphs[0]._p)

    for item in paragraphs:
        if not isinstance(item, dict):
            continue
        runs = item.get("runs")
        level = max(0, item["level"]) if isinstance(item.get("level"), int) else 0
        is_simple = (not isinstance(runs, list) or len(runs) <= 1) and not _run_has_explicit_style(
            runs[0] if isinstance(runs, list) and runs else None
        )

        if is_simple and (prototype := pick_prototype(level)) is not None:
            text = str(runs[0].get("text", "")) if isinstance(runs, list) and runs else str(item.get("text", ""))
            text = _strip_leading_bullet_marker(text)
            clone = copy.deepcopy(prototype)
            _set_first_run_text(clone, text)
            frame._txBody.append(clone)
            continue

        # 사용자가 특정 부분에 직접 서식을 지정한 경우(런 여러 개 또는 명시적
        # 스타일) — 기존 방식대로 새로 만든다. 템플릿 원형 복제 대상이 아니다.
        paragraph = frame.add_paragraph()
        if isinstance(item.get("level"), int):
            paragraph.level = level
        # ... (기존 align/runs 처리 그대로)
```

`_run_has_explicit_style`는 `bold`/`italic`/`underline`/`color`/`fontSize`/`fontFamily`
중 하나라도 참(true)/값이 있으면 `True`를 반환하는 작은 헬퍼다. `_set_first_run_text`는
복제된 문단 엘리먼트에서 첫 `a:r`만 남기고 나머지를 지운 뒤 그 안의 `a:t` 텍스트를
바꾼다 (참고 저장소의 `setParagraphText`와 동일한 발상, python-pptx의 `oxml`
API로 구현).

**`_apply_native_edit`의 396~431줄 중복 블록**은 삭제하고 `self._write_paragraphs(shape.text_frame, edit["paragraphs"])` 호출로 교체한다.

**리터럴 불릿 스트리핑**: `_strip_leading_bullet_marker(text)` — 줄 앞의
공백을 보존한 채 `-`, `–`, `—`, `•`, `·`, `∙`, `‣`, `▪`, `▫`, `◦`, `*` 등이
연속으로 나온 뒤 공백/탭이 오면 그 마커 구간만 잘라낸다. `_write_paragraphs`에서
프로토타입 복제 경로를 탈 때만 적용한다 (수동 서식 지정 경로는 사용자가 실제로
타이핑한 문자이므로 건드리지 않는다).

### 2. 프롬프트 근거화 — Go

**레벨 집합 계산** (`apps/core-api/internal/generation/hierarchy_guidance.go`에 추가):

```go
// availableLevels returns the union of indentation levels actually present
// across a slide's editable text/table objects, so the prompt can ground
// the model in what this specific template supports instead of a blanket
// 0-4 range.
func availableLevels(config map[string]any) []int {
    seen := map[int]bool{}
    for _, line := range hierarchyLinesFrom(config) {
        seen[line.Level] = true
    }
    if len(seen) == 0 {
        return nil
    }
    levels := make([]int, 0, len(seen))
    for level := range seen {
        levels = append(levels, level)
    }
    sort.Ints(levels)
    return levels
}
```

(`hierarchyLinesFrom`은 `bulletHierarchyExample`이 이미 쓰는 기존 헬퍼를 재사용한다.)

**`SlideRequest`에 필드 추가** (`service.go`): `AvailableLevels []int`, `Process()`에서
`bulletHierarchyExample`을 계산하는 것과 같은 자리에서 `availableLevels(configObject(...))`도
계산해 `SlideContent` 호출에 threading.

**`slidePrompt` 수정** (`llm.go`):
```go
levelGuidance := "level 0-4 for indentation"
if len(input.AvailableLevels) > 0 {
    parts := make([]string, len(input.AvailableLevels))
    for i, level := range input.AvailableLevels {
        parts[i] = strconv.Itoa(level)
    }
    levelGuidance = fmt.Sprintf("level — only these values are usable here: %s", strings.Join(parts, ", "))
}
```
그리고 시스템 프롬프트에 다음 두 문장을 추가한다:
```
"The previous content shown to you is reference material only, describing what kind of content that slot holds — it is not something to preserve or repeat verbatim.",
"Do not write bullet characters (-, •) as literal text; the template already draws them.",
```

### 3. 테스트

**Python (`apps/renderer/tests/test_pptx_generator.py`, 신규 또는 기존 파일에 추가):**
- 같은 레벨의 원본 문단이 있으면 그 서식(pPr/rPr)을 그대로 복제하는지
- 요청한 레벨이 템플릿에 없으면 가장 가까운 레벨로 폴백하는지
- 여러 런 + 명시적 스타일이 있는 문단은 기존 방식(새로 생성)을 그대로 쓰는지 (회귀 방지)
- 리터럴 불릿 마커가 스트리핑되는지 (프로토타입 복제 경로에서만)

**Go (`apps/core-api/internal/generation/hierarchy_guidance_test.go`, `llm_test.go`):**
- `availableLevels`가 슬라이드의 여러 개체를 합쳐 올바른 레벨 집합을 반환하는지 (레벨 정보 없으면 nil)
- `slidePrompt`가 `AvailableLevels`가 있을 때 그 집합을 프롬프트에 넣는지, 없을 때 기존 "0-4" 문구를 유지하는지
- 시스템 프롬프트에 새 프레이밍 문장들이 포함되는지

**실사용 검증:** 로컬 스택에서 박태지_0723 템플릿으로 재생성해, 실제 PDF/PPTX에서
불릿 레벨별 들여쓰기가 원본과 같은 서식으로 나오는지 육안 확인.
