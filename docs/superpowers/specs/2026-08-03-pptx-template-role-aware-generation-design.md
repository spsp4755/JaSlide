# PPTX 템플릿 역할 기반 생성 배정 설계

## 배경 및 문제

PPTX 템플릿으로 슬라이드를 생성할 때, 어떤 도형에 생성된 제목/본문을 넣을지는 지금 순전히 **폰트 크기 순위**로 결정된다 (`apps/core-api/internal/generation/service.go:672-717`, `pptxObjectEdits`).

- 그 슬라이드의 텍스트 도형을 폰트 크기 내림차순 정렬 후, 가장 큰 도형에 제목을, 두 번째로 큰 도형에 본문/불릿 전체를 넣는다.
- 표는 `kind == "table"`이기만 하면 전부 `populateCells`로 채워진다.
- 그 외 텍스트 도형(3번째 이후)은 지금도 건드리지 않지만, 그건 "인식해서 보존"하는 게 아니라 단순히 `textLimit`(표가 있으면 1, 없으면 2)을 넘어서 우연히 제외되는 것뿐이다.

실제 템플릿은 날짜/부제목/장식용 표 같은 도형이 본문보다 큰 폰트를 쓰는 경우가 흔해서, 생성된 본문 전체가 날짜 박스에 덮어써지는 등 "템플릿을 어기는" 결과가 나온다. 원인은 어떤 도형이 실제로 무엇을 의미하는지에 대한 정보가 추출 단계부터 전혀 없기 때문이다 (`grep`으로 `Role`/`PlaceholderType`/`slotType`/`fieldType` 확인 결과 코드베이스 전체에 0건, `placeholder_format` 등 python-pptx의 placeholder API도 미사용).

## 목표

각 도형(텍스트/표)이 어떤 역할을 하는지 인식하고, 그 역할에 맞는 생성 콘텐츠만 배정한다. 폰트 크기 휴리스틱을 역할 기반 배정으로 교체하고, 지금 생성되지 않는 부제목/날짜/강조수치 콘텐츠도 새로 생성해서 채운다.

## 1. 역할 어휘 및 분류

닫힌 목록 6종:

| 역할 | 대상 도형 | 의미 |
|---|---|---|
| `title` | text | 슬라이드 제목 |
| `subtitle` | text | 부제목/태그라인 |
| `body` | text, table | 본문/불릿 텍스트, 또는 채워야 할 표 |
| `date` | text | 날짜 값 |
| `kpi` | text | 강조 수치/지표 |
| `static` | text, table | 절대 건드리지 않음 (로고, 푸터, 페이지번호, 장식/범례용 표 등) |

- table 도형은 `body`(채울 표) 또는 `static`(보존)만 허용 — 분류 프롬프트에 도형 종류(`kind`)를 함께 보여줘서 표에 `title`/`kpi` 같은 부적합한 역할이 나오지 않게 제한한다.
- 분류는 템플릿당 **LLM 호출 1회**로 처리한다: 그 템플릿의 모든 레이아웃 슬라이드에 대해, 슬라이드 인덱스·도형 id·kind·position·fontSize·원본 예시 텍스트(첫 문단)를 한 번에 보여주고, 도형 id → 역할 매핑을 받는다. 기존 콘텐츠 생성에 쓰는 `OpenAIClient`를 재사용한다.
- 분류 결과는 사용자 확인 없이 즉시 저장한다.

## 2. 데이터 흐름 / 저장 / 백필

- 역할은 `Template.config.source.slides[].objects[].role` 문자열 필드로 저장한다. 새 테이블/컬럼 없이 기존 JSON(`templateData.Source`, `service.go:606-620`의 `objects()`가 읽는 바로 그 구조)에 병합한다.
- **신규 템플릿(PPTX 업로드)**: `apps/core-api/internal/templates/handlers.go`의 `importPPTX`가 렌더러의 `/api/extract/style` 응답을 받은 직후, `config`를 DB에 저장하기 전에 분류를 실행하고 `role`을 병합해서 저장한다.
- **기존 템플릿(백필)**: `generation/service.go`의 `Process()`가 슬라이드를 처리하기 전, 그 템플릿의 `objects()`에 `role`이 하나라도 없으면 그 템플릿 전체를 한 번 분류해서 DB에 갱신하고, 이후 이번 요청과 다음 요청부터는 갱신된 데이터를 사용한다.
- **실패 안전장치**: 분류 LLM 호출이 실패하거나(타임아웃, JSON 파싱 실패) 결과가 불완전하면, 해당 슬라이드/템플릿은 `role`이 비어있는 상태로 남고 아래 3절의 "역할 없음 폴백"이 적용된다 — 분류 실패가 생성 자체를 막지 않는다.

## 3. 프롬프트 & 배정 로직 변경

### 3.1 요청 역할 계산

`service.go`의 슬라이드별 루프(현재 `availableLevels`를 계산하는 지점, `chooseTemplateIndex` 직후)에서 `template.objects(templateIndex)`를 스캔해 그 슬라이드에 실제로 존재하는 `subtitle`/`date`/`kpi` 역할 집합을 계산하고, `SlideRequest`에 새 필드 `RequestedRoles []string`로 전달한다. (`title`/`body`는 지금도 항상 요청하므로 별도 계산 불필요.)

### 3.2 프롬프트 확장

`llm.go`의 `slidePrompt`가 `RequestedRoles`에 포함된 역할에 대해서만 조건부로 응답 필드를 요청한다:
- `subtitle`: 한 줄 부제목 문자열.
- `date`: 이미 모든 프롬프트에 포함되는 `dateGuidance()`(`llm.go:743-757`)의 실제 날짜값을 그대로 쓰도록 지시 — 새 날짜 계산 로직 불필요.
- `kpi`: 슬라이드 주제에 맞는 짧은 강조 수치/지표 문자열 한 개.

해당 역할이 그 슬라이드에 없으면 필드 자체를 요청하지 않아, 없는 슬롯에 억지로 내용을 지어내지 않는다.

### 3.3 배정 로직 재작성

`pptxObjectEdits(objects, slide, title, lines)`를 역할 인지형으로 재작성한다:

- 각 object의 `role`로 그룹화한다 (title/subtitle/date/kpi/body-text/body-table/static).
- `title`/`subtitle`/`date`/`kpi`: 생성된 값이 있고 해당 역할의 도형이 있으면, 그 도형에 한 줄 텍스트 edit을 추가한다 (지금 제목에 하던 것과 동일한 형태).
- `body` 역할 text 도형: 지금처럼 `paragraphs: paragraphsFromLines(lines)`.
- `body` 역할 table 도형: 지금처럼 `populateCells`.
- `static` 역할(text/table 무관): edit 목록에서 완전히 제외 — export 시 원본 그대로 남는다.
- 한 슬라이드에 같은 역할 도형이 여러 개면, 같은 생성값을 전부에 broadcast한다 (아래 범위 밖 참고).
- **역할 없음 폴백**: 이 슬라이드/템플릿에 `role` 데이터가 전혀 없으면(분류 실패/백필 전), 지금과 완전히 동일한 폰트 크기 순위 로직으로 동작한다 — 동작 회귀 없음.

## 4. 범위 밖

- 같은 역할 도형이 여러 개일 때 개별적으로 다른 값을 배정하는 것 (예: KPI 박스 2개에 서로 다른 수치) — 전부 같은 값을 broadcast하는 것으로 충분히 안전한 기본값으로 본다.
- 표 셀 단위 라벨/데이터 구분(`isTableLabel`, `service.go:772-775`) — 이번 변경은 표 전체(shape) 단위의 `body`/`static` 배정만 다루고, 셀 단위 휴리스틱은 그대로 둔다.
- 분류 결과에 대한 수동 검수/수정 UI.
- 비-PPTX(HTML 기반) 생성 경로(`heading`/`columns`/`chart`/`timeline` 등) — 이번 변경은 `template.PPTX`가 참인 네이티브 PPTX 편집 경로에만 적용된다.

## 5. 테스트 계획

- 분류 결과가 `config.source.slides[].objects[].role`로 올바르게 병합되는 단위 테스트.
- `pptxObjectEdits`가 역할별로 올바르게 배정/제외하는 단위 테스트: static 제외, title/subtitle/date/kpi 단일값 배정, 같은 역할 다중 도형 broadcast, role 없음 폴백(기존 폰트 순위 동작과 동일한지).
- `RequestedRoles`가 실제로 `slidePrompt`에 반영되는지 테스트 (`AvailableLevels` 테스트, `llm_test.go`의 `TestSlidePromptUsesAvailableLevelsWhenPresent`와 동일한 패턴).
- 실제 fill-in report 스타일 템플릿으로 수동 종단 검증: 날짜/KPI 박스가 더 이상 본문으로 덮어써지지 않고, 부제목/날짜/KPI가 실제로 채워지는지 확인.
