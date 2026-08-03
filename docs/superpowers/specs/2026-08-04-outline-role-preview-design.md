# 아웃라인 역할 미리보기 및 고정(static) 강제 기능 설계

## 배경

v0.8.1에서 실사용 중 두 가지 문제가 드러났다:

1. PPTX 템플릿 역할 기반 생성 기능(`role_classification.go`, `roles.go`)이 도형을 `subtitle` 등으로 분류하면 매 생성마다 새 텍스트로 덮어쓴다. 그런데 실제로는 부서명 라벨처럼 "절대 안 바뀌어야 하는" 도형이 `subtitle`로 분류돼 매번 재작성되는 사례가 나왔다. 사용자가 명시적으로 바꾸라고 하기 전까지는 그런 도형을 건드리면 안 된다.
2. 지금은 어떤 도형이 title/subtitle/body/date/kpi/static 중 무엇으로 분류됐는지, 생성 시 무엇이 채워지고 무엇이 그대로 유지되는지 사용자가 전혀 볼 수 없다. 아웃라인 검토 시점에 이걸 미리 보고 싶어한다.

## 목표

- 아웃라인 검토 화면에서, 선택한 템플릿의 각 슬라이드가 어떤 역할 구조를 가졌는지(무엇이 채워질 예정이고 무엇이 고정됐는지) 텍스트 목록으로 보여준다.
- 사용자가 특정 도형을 "고정하기"로 지정하면, 그 도형은 이후 모든 생성에서 영구적으로 건드리지 않는다. 고정 해제도 가능하다(원래 LLM 분류로 복귀).

## 범위 밖

- 도형 역할을 static 외의 다른 값으로 임의로 재지정하는 기능(예: body를 title로 바꾸기) — 이번 스코프는 "고정하기/고정 해제"만 다룬다.
- 슬라이드 위에 시각적으로 겹쳐 그리는 오버레이 미리보기 — 텍스트 목록으로 대체한다(브레인스토밍에서 확정).
- 실제 생성될 본문/KPI 텍스트 값을 아웃라인 시점에 미리 생성해서 보여주는 것 — 구조(역할 이름 + 고정 여부)만 보여준다. 값 자체는 여전히 `Process()`의 LLM 호출에서만 만들어진다.
- 비-PPTX(HTML) 템플릿의 역할 미리보기 — HTML 템플릿은 도형/역할 개념이 없으므로 이 기능은 PPTX 템플릿에만 적용된다.

## 아키텍처

트리거는 새로운 "템플릿 선택" 이벤트를 만들지 않는다. 현재 프론트엔드(`apps/web/src/app/dashboard/page.tsx`의 `handleGenerate`)는 템플릿 선택과 아웃라인 생성 요청(`generationApi.outline`)을 한 번의 흐름으로 묶어서 보낸다. 이 흐름 직후, 아웃라인이 화면에 표시되는 시점에 프론트엔드가 새 미리보기 엔드포인트를 호출하면서 분류를 트리거한다.

- 미분류 템플릿이면 그 호출이 백그라운드 고루틴으로 분류를 즉시 시작시키고 `pending` 상태로 바로 응답한다(v0.8.0에서 고친 "LLM 호출이 동기 HTTP 경로를 막으면 안 된다" 원칙 유지 — 요청 자체가 끝날 때까지 기다리지 않는다).
- 프론트엔드는 아웃라인이 화면에 떠 있는 동안 이 엔드포인트를 약 2초 간격으로 폴링해 `pending` → `ready` 전환을 감지한다.
- 각 아웃라인 슬라이드가 실제로 어느 템플릿 슬라이드에 배정될지는 `chooseTemplateIndex(item.TemplateIndex, index, capable)`(`service.go:383,693`)로 확정되는데, 아웃라인 단계에서는 `TemplateIndex`가 `nil`일 수 있다. 이 로직을 프론트에서 재구현하지 않고, 새 엔드포인트가 아웃라인 슬라이드 목록을 입력받아 서버가 직접 동일한 함수로 해석해서 응답한다.

## 데이터 모델 변경

`Template.config.source.slides[].objects[]`에 필드 하나를 추가한다:

```json
{
  "id": "shape-12",
  "kind": "text",
  "role": "subtitle",
  "locked": true
}
```

- `locked` 없음 또는 `false`: 기존과 동일하게 `role` 값을 그대로 사용한다.
- `locked: true`: 실제 생성 시 이 도형은 `role` 값과 무관하게 무조건 `static`(절대 미편집) 취급한다. `role` 필드 자체는 덮어쓰지 않고 그대로 보존한다 — 고정 해제 시 원래 LLM 분류로 복귀하기 위함이다.

`role_classification.go`와 `roles.go`에서 `obj["role"]`을 직접 읽던 모든 지점(`anyObjectHasRole`, `rolePptxObjectEdits`, `requestedGenerativeRoles`, `needsRoleClassification`, `mergeTemplateRoles` 등)은 새 헬퍼 `effectiveRole(object map[string]any) string`을 거치도록 바꾼다:

```go
func effectiveRole(object map[string]any) string {
    if locked, _ := object["locked"].(bool); locked {
        return "static"
    }
    role, _ := object["role"].(string)
    return role
}
```

`needsRoleClassification`은 `locked` 여부와 무관하게 "role 필드가 하나라도 있으면 분류 완료"라는 기존 기준을 유지한다(고정 여부는 분류 완료 여부와 별개 개념).

## 백엔드 API

두 엔드포인트를 `apps/core-api/internal/generation/handlers.go`에 추가한다(생성 서비스가 이미 `template()`, `classifyTemplateRoles()`, `chooseTemplateIndex()`, `capableIndexes()`를 갖고 있으므로 이 패키지에 둔다). `/generation`에 마운트되므로 최종 경로는 다음과 같다.

### `POST /generation/templates/{templateId}/role-preview`

요청 바디 — 아웃라인 슬라이드를 **현재 화면에 보이는 배열 순서 그대로** 보낸다. 아웃라인은 승인 전에 사용자가 순서 변경/추가/삭제를 할 수 있고 `order` 필드는 승인 시점(`handleApproveOutline`)에만 재번호가 매겨지므로, 배열 위치 대신 `order` 필드로 슬라이드를 식별하지 않는다 — `chooseTemplateIndex`가 실제로 쓰는 것도 `order` 필드가 아니라 배열 내 위치(range 루프의 0-based index)다:

```json
{
  "slides": [
    { "type": "intro", "templateIndex": null },
    { "type": "content", "templateIndex": 2 }
  ]
}
```

응답 — 요청과 동일한 배열 순서로 1:1 대응(프론트엔드는 배열 인덱스로 zip한다, 별도 식별자 매칭 없음):

```json
{
  "status": "pending"
}
```

또는 (분류 완료 시)

```json
{
  "status": "ready",
  "slides": [
    {
      "items": [
        { "objectId": "shape-1", "role": "title", "locked": false },
        { "objectId": "shape-2", "role": "static", "locked": true },
        { "objectId": "shape-3", "role": "body", "locked": false }
      ]
    }
  ]
}
```

또는 (HTML 템플릿) `{"status": "unavailable"}`.

동작:
1. `service.template(ctx, &templateID, userID, false)`로 템플릿을 로드한다(분류는 트리거하지 않는 호출 — 기존 `false` 경로 그대로).
2. `source["kind"] != "pptx"`이면 `unavailable`.
3. `needsRoleClassification(source)`가 true면: 이 템플릿 ID가 이미 진행 중인 분류가 없을 때만(서비스에 `sync.Map`으로 in-flight 템플릿 ID 추적) `context.Background()`로 새 고루틴을 띄워 `service.classifyTemplateRoles`를 실행하고, `pending`으로 즉시 응답한다.
4. 이미 분류돼 있으면(`needsRoleClassification`이 false): 요청 바디 `slides` 배열을 순회하며(배열 인덱스를 `index`로 사용) `capable := template.capableIndexes()`, `templateIndex := chooseTemplateIndex(item.TemplateIndex, index, capable)`를 계산하고, `template.objects(templateIndex)`의 각 객체를 `{objectId: id, role: effectiveRole(object), locked: object["locked"]}`로 매핑해 같은 배열 순서로 `ready` 응답에 담는다.

### `PATCH /generation/templates/{templateId}/objects/{objectId}/lock`

요청 바디: `{"locked": true}` 또는 `{"locked": false}`.

동작: 템플릿 config를 로드하고, `source.slides[].objects[]`에서 `id == objectId`인 객체를 찾아 `locked` 필드를 설정한 뒤 `service.repo.UpdateTemplateConfig`로 영구 저장한다. 객체를 못 찾으면 404. 응답은 갱신된 `{objectId, role, locked}` 하나.

## 프론트엔드

`apps/web/src/app/dashboard/page.tsx`의 아웃라인 카드 목록(현재 404-466줄, 순수 텍스트 편집 폼) 각 슬라이드 카드 안에, 역할 미리보기 데이터가 있으면 작은 목록 블록을 추가한다:

- `outline`이 세팅되고 `outlineContext.templateId`가 있는 동안, `useEffect`로 2초 간격 폴링을 시작해 `POST /generation/templates/{id}/role-preview`를 호출한다(바디는 현재 `outline.slides` 배열의 순서 그대로 `type/templateIndex`만 추려서 보냄 — `order` 필드는 보내지 않는다). `status: "ready"`가 오면 폴링을 멈추고, 응답의 `slides` 배열을 `outline.slides` 배열과 같은 인덱스로 짝지어 state에 저장한다(사용자가 그 사이 슬라이드를 추가/삭제/재정렬했으면 배열 길이가 달라져 매칭이 안 맞을 수 있으므로, 그 경우 폴링을 다시 트리거해 최신 배열로 재요청한다). `outline`이 사라지거나(취소/승인) 컴포넌트가 언마운트되면 폴링을 정리한다.
- 폴링이 30회(약 1분)를 넘도록 `ready`가 안 되면 멈추고 조용히 아무것도 표시하지 않는다(분류 실패는 기존처럼 폰트순위 폴백으로 생성 자체는 정상 동작하므로, 미리보기를 못 보여주는 것 자체가 에러는 아니다).
- `status: "unavailable"`이면 그 슬라이드는 미리보기 블록을 렌더링하지 않는다.
- 각 슬라이드 카드에서 role-preview 데이터가 준비됐으면, 역할별 한 줄씩 렌더링:
  - `role`을 한글 라벨로 매핑: `title→제목, subtitle→부제목, body→본문, date→날짜, kpi→KPI, static→고정`.
  - `role !== "static"`: "채워질 예정" 텍스트 + "고정하기" 버튼. 클릭 시 `PATCH .../lock {locked:true}` 호출, 낙관적으로 해당 항목을 `locked:true, role:"static"` 표시로 갱신.
  - `role === "static" && locked === true`: "🔒 고정됨" + "고정 해제" 버튼. 클릭 시 `PATCH .../lock {locked:false}`, 응답의 원래 `role`로 되돌려 표시.
  - `role === "static" && locked !== true`(LLM이 원래 static으로 분류): "🔒 고정됨(템플릿 원본)"만 표시, 버튼 없음 — 이건 사용자가 강제한 게 아니라 분류 결과이므로 이번 스코프의 "고정 해제" 대상이 아니다.

## 에러 처리

- 분류 LLM 호출 실패/타임아웃: `classifyTemplateRoles`는 기존과 동일하게 조용히 실패하고 role 데이터 없이 남는다. role-preview 엔드포인트는 계속 `pending`을 반환하다가, 프론트엔드가 폴링을 포기하면 그냥 미리보기 없이 진행된다. 생성 자체는 기존 폰트순위 폴백으로 정상 동작 — 이 기능의 실패가 생성 실패로 이어지지 않는다.
- 동시에 같은 템플릿에 대해 role-preview가 여러 번 호출되는 경우(같은 사용자가 여러 탭, 또는 여러 사용자가 같은 템플릿 선택): in-flight `sync.Map`으로 중복 분류 고루틴 생성을 막는다. 서버 재시작 시 이 맵은 초기화되므로 최악의 경우 한 번의 중복 분류 호출이 더 발생할 수 있으나(비용 낭비일 뿐 정합성 문제 없음), 별도 영속화는 하지 않는다.
- `lock` PATCH는 멱등적이다 — 이미 같은 값이어도 그대로 저장하고 200을 반환한다.
- 존재하지 않는 `objectId`로 lock을 호출하면 404.

## 테스트 범위

- Go 단위 테스트(`apps/core-api/internal/generation`):
  - `effectiveRole` 헬퍼: `locked:true`면 role 값과 무관하게 `"static"`, 그 외엔 `role` 그대로.
  - role-preview 핸들러: 미분류 템플릿 → `pending` + in-flight 고루틴 트리거 확인, 이미 분류된 템플릿 → `ready`와 `chooseTemplateIndex`를 통한 올바른 슬라이드 배정, HTML 템플릿 → `unavailable`.
  - lock PATCH 핸들러: `locked` 설정/해제가 `UpdateTemplateConfig`로 영구 저장되는지, 이후 `effectiveRole`이 즉시 반영되는지, 존재하지 않는 objectId는 404.
  - 기존 `role_classification_test.go`/`roles_test.go`의 관련 테스트가 `effectiveRole` 경유로 여전히 통과하는지(회귀 없음).
- 프론트엔드: 폴링 로직과 렌더링에 대한 최소 단위 테스트(기존 vitest 설정 활용) — 폴링이 `ready`에서 멈추는지, 고정하기/고정 해제 버튼이 올바른 PATCH를 호출하는지.
- 수동 종단 검증: 기존에 이미 분류된 실제 템플릿(박태지_0723_업무보고_AI엔지니어링)으로 (1) 아웃라인 검토 화면에서 역할 목록이 뜨는지, (2) 부제목 도형을 "고정하기"로 지정한 뒤 생성해서 실제로 그 도형이 안 바뀌는지, (3) "고정 해제" 후 다시 생성하면 원래 분류(subtitle 등)로 정상 채워지는지 확인한다.
