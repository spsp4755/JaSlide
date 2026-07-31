# AI 생성 슬라이드에 표(TABLE)와 다단계 불렛 지원 추가

**Goal:** LLM 기반 프레젠테이션 생성 파이프라인이 표 형태 데이터를 실제 표로, 다단계 들여쓰기 목록을 실제 다단계 불렛으로 만들 수 있게 한다. 등록된 템플릿/스킬을 "무시"하는 것처럼 보이는 현재 동작의 근본 원인을 고친다.

**Context:** "0730 업무보고" 생성 재현 결과, 등록된 스킬(`박태지_0723` 템플릿 연결)로 아웃라인은 생성되지만 이후 콘텐츠 생성 단계에서 표 구조와 다단계 불렛이 모두 사라진다는 사용자 보고를 조사했다.

원인은 스킬/템플릿이 무시당하는 게 아니라, 생성 엔진의 데이터 모델 자체에 표현할 방법이 없었기 때문이다:
- `PresentationSkill`은 `outlineGuidance`라는 자유 텍스트 하나를 아웃라인 프롬프트 뒤에 덧붙이는 것뿐이며, 구조적 서식 규칙을 담을 수 없다(`apps/core-api/internal/generation/service.go`).
- `slideTypes`(`apps/core-api/internal/generation/service.go:848`)에 `TITLE, CONTENT, BULLET_LIST, TWO_COLUMN, IMAGE, CHART, QUOTE, COMPARISON, SECTION_HEADER, BLANK` 10종만 있고 `TABLE`이 없어, LLM이 아무리 잘 응답해도 표를 선택할 방법이 없다.
- `parseSlideContent`(`apps/core-api/internal/generation/llm.go`)가 불렛의 `level`을 0 또는 1로만 강제 클램핑해서, 원본에 있던 다단계 들여쓰기가 항상 뭉개진다.
- 반대로 PPTX/HTML ZIP을 그대로 가져와 수동 편집 없이 재출력하는 경로(scene 기반 편집·재출력)는 표·다단계 들여쓰기·폰트를 그대로 보존한다는 것을 이전 마이그레이션 검증(`task-8-report.md`)에서 이미 확인했다 — 문제는 AI가 새 콘텐츠를 생성하는 경로에만 있다.

## 범위

생성 엔진 전체(`apps/core-api/internal/generation`, `apps/renderer/src/generators/pptx_generator.py`)에 정식 기능으로 추가한다. 특정 템플릿(`박태지_0723`)에만 임시로 표를 강제하는 우회는 채택하지 않는다.

## 1. 아웃라인 생성 — 사용 가능한 타입을 LLM에게 알려주기

`outlinePrompt`(`apps/core-api/internal/generation/llm.go`)는 현재 예시로 `"type":"CONTENT"` 하나만 보여준다. 모델이 스스로 `TABLE`/`CHART` 같은 타입 이름을 추측해서 쓰는 경우는 실질적으로 없다.

프롬프트에 슬라이드 타입 선택 기준을 명시적으로 추가한다:
- 행/열 구조의 데이터(표, 비교표, 일정표 등) → `TABLE`
- 수치 비교/추이 → `CHART`
- 단순 목록 → `BULLET_LIST`
- 그 외 서술형 → `CONTENT`
- (기존 `TITLE`, `TWO_COLUMN`, `IMAGE`, `QUOTE`, `COMPARISON`, `SECTION_HEADER`, `BLANK`은 현행 유지)

이 변경 없이 `TABLE`을 스키마에만 추가하면 실제로는 거의 선택되지 않으므로, 아래 2번과 반드시 함께 적용한다.

## 2. 콘텐츠 스키마 — `TABLE` 타입 신설

- `slideTypes`(`service.go:848`)에 `"TABLE": true` 추가.
- `slidePrompt`(`llm.go`)에 `TABLE` 타입일 때의 응답 스키마 안내를 추가: `{"table":{"headers":["열1","열2"],"rows":[["값","값"]]}}`.
- `parseSlideContent`에 `validTable(raw any) map[string]any` 추가. `validChart`(`llm.go`)와 동일한 검증 패턴을 따른다:
  - `headers`는 문자열 배열(1~8열), `rows`는 각 행이 `headers`와 같은 열 수를 가진 문자열 배열(1~12행).
  - 유효하지 않으면(모델이 스키마를 못 지켰으면) `chart`의 `isExample:true` 폴백과 동일한 방식으로 최소 예시 표(`headers:["항목","값"], rows:[["예시","-"]], isExample:true`)를 채워 넣어, 생성 자체가 실패하지 않게 한다.

## 3. 불렛 다단계 지원 — 인위적 제한 제거

`parseSlideContent`의 bullets 파싱부(`llm.go`)가 `level`을 0 또는 1로만 강제한다:
```go
level := 0
if bullet["level"] == float64(1) {
    level = 1
}
```
렌더러(`pptx_generator.py`)는 `paragraph.level = max(0, item["level"])`로 받은 정수를 그대로 그리기 때문에 이미 다단계를 지원한다 — Go 쪽의 인위적 클램핑만 제거하면 된다. `level`을 0~4 정수로 확장한다(PPTX 관행상 5단계 이상은 실질적 의미가 없어 안전 상한으로 둔다). 범위를 벗어나거나 정수가 아니면 0으로 폴백한다.

## 4. 렌더러 — `_add_table` 함수 추가

`_add_chart`(`pptx_generator.py:797`)와 동일한 패턴으로 `_add_table`을 추가한다:
- `content_slots` 중 가장 넓은 밝은(비어두운) 영역을 찾아 표를 배치할 좌표로 쓴다(차트와 동일 로직 재사용).
- 표 자체는 이미 존재하는 `_add_table_row`(`pptx_generator.py:755`, HTML 임포트 표 렌더링에 이미 쓰이는 헬퍼)를 헤더 행(`header=True`) 1회 + 데이터 행 N회 호출해 그린다.
- 슬라이드 타입 분기(`pptx_generator.py:687` 부근, 기존 `if ... == "CHART" and self._add_chart(...)` 옆)에 `elif ... == "TABLE" and self._add_table(slide, content, content_slots)`를 추가한다.

기존 헬퍼를 그대로 재사용하므로 렌더러 쪽 신규 로직은 표 데이터 → `_add_table_row` 호출 반복뿐이다.

## 영향받지 않는 부분

- `docs/html-template-contract.md`의 `title`/`subtitle`/`body`/`bullets` 슬롯 구조는 변경 없음. `TABLE`도 `CHART`처럼 body 영역을 동적으로 차지할 뿐, 새 슬롯 타입을 만들 필요 없다.
- PPTX/HTML ZIP 임포트 → scene 편집 → 재출력 경로(표 보존)는 이미 정상 동작하므로 무변경.
- 기존에 저장된 프레젠테이션과 기존 `CONTENT`/`BULLET_LIST`/`CHART` 생성 결과는 스키마상 완전히 하위 호환.

## 테스트 계획

**Go (`apps/core-api/internal/generation`):**
- `validTable`: 유효한 헤더/행, 유효하지 않은 경우(빈 헤더, 행 길이 불일치, 열/행 개수 초과) 각각의 케이스.
- `parseSlideContent`: `TABLE` 타입에서 유효한 table 응답이 그대로 통과하는 케이스, 무효 응답 시 `isExample:true` 폴백이 채워지는 케이스.
- `parseSlideContent`: bullet `level`이 0~4 범위에서 그대로 보존되고, 범위 밖/비정수는 0으로 폴백하는 케이스.

**Python (`apps/renderer/tests/test_pptx_generator.py`):**
- `_add_table`: 기존 `_add_chart` 테스트와 동일한 패턴으로, 유효한 `content["table"]`이 주어졌을 때 슬라이드에 표 도형이 추가되는지 확인.

**실사용 검증:**
- 현재 띄워둔 로컬 스택에서 표 형태가 자연스러운 소스(예: 기간별 실적 표)로 "0730 업무보고" 유형 생성을 재현하고, 내보낸 PPTX를 열어 실제 표와 다단계 불렛이 반영되는지 확인.
