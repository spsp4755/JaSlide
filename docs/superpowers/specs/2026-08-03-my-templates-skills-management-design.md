# 내 템플릿/스킬 관리 화면 — Design Spec

Date: 2026-08-03

## Context

`Template`과 `PresentationSkill` 모두 최근 `userId`/`organizationId`/`isPublic`을 갖게 됐지만
(`Template.userId`는 `20260802000000_add_template_owner` 마이그레이션에서 추가), 이걸 실제로
관리할 수 있는 사용자용 화면/API는 전혀 없다.

- `POST /skills/import-pptx`로 PPTX를 올리면 `Template`+`PresentationSkill`이 항상
  `isPublic=false`로 한 쌍 생성된다 (`apps/core-api/internal/skills/handlers.go`의
  `createImported`).
- `apps/web/src/components/skills/skills-gallery.tsx`가 유일한 "내 것" 화면인데,
  검색/카테고리 필터와 일괄 선택-삭제(`skillsApi.deleteMany`)만 있고, 카드 하나를
  수정하거나 개별 삭제하는 기능, 공개 범위를 바꾸는 기능이 없다.
- `Template` 쪽은 사용자용 API가 아예 없다 (`apps/core-api/internal/templates/handlers.go`는
  공개 조회용 `listPublic`/`getPublic`과 관리자 전용 CRUD뿐).
- 결과적으로 사용자가 PPTX를 임포트해 만든 템플릿은 스킬 카드 뒤에 숨어 이름도
  못 바꾸고, 삭제도 스킬만 일괄로 지울 수 있을 뿐 템플릿은 고아로 남고, 다른
  사람과 공유할 방법도 없다.

관리자 페이지(`apps/web/src/app/admin/templates/page.tsx`)에는 이미 공개/비공개 토글
UI 패턴(`handleToggleTemplatePublic`, 배지 버튼)이 있어 이번 작업에서 그대로 참고한다.

## Scope

**포함:**
- `/skills` 페이지 확장 (새 페이지를 만들지 않음)
- 카드 단위로: 이름 변경, 개별 삭제, 공개 범위 변경(비공개/조직공개/전체공개),
  미리보기(임포트 시 이미 추출된 첫 슬라이드 HTML)
- PPTX 임포트로 만들어진 스킬+템플릿 쌍은 이름과 공개 범위를 **하나의 설정으로 동시에** 변경
- 조직이 없는 사용자(`User.organizationId IS NULL`)에게는 "조직공개" 선택지를 숨김
- 연결된 템플릿이 없는 스킬(수동 생성)은 스킬 자체의 설정만 적용, 미리보기 없음

**제외 (다음 단계로 미룸):**
- 특정 사용자를 지정해 공유하는 기능 — 새 조인 테이블(`TemplateShare` 등)이 필요해
  범위가 크게 늘어난다. 사용자에게 3단계(비공개/조직공개/전체공개)만 먼저 제공하고,
  사용자 지정 공유는 별도 스펙으로 다룬다.
- 조직(Organization) 개념 자체의 신설/관리 — 이미 있는 `organizationId` 컬럼만 사용한다.

## Architecture

### 1. 백엔드 — `apps/core-api/internal/skills/handlers.go`

**`PATCH /skills/{id}`** (신규):
```go
type skillUpdateInput struct {
    Name     *string `json:"name,omitempty"`
    IsPublic *bool   `json:"isPublic,omitempty"`
    // organizationId는 요청 바디로 받지 않는다 — "조직공개"를 켤 때는 항상
    // 요청한 사용자 자신의 organizationId를 쓰고, 끌 때는 NULL로 되돌린다.
    // 다른 조직으로 공유하는 기능은 스코프 밖이라 클라이언트가 organizationId를
    // 직접 지정할 이유가 없다.
    Scope *string `json:"scope,omitempty"` // "private" | "organization" | "public"
}
```
`scope` 필드 하나로 세 가지 상태를 표현한다 (`isPublic`/`organizationId` 두 컬럼을
클라이언트가 직접 조합하게 하면 "공개이면서 조직값도 차 있는" 무의미한 조합이
생길 수 있어, 서버가 `scope`를 해석해 두 컬럼을 함께 정한다):

```go
func scopeColumns(scope string, userOrgID *string) (isPublic bool, organizationID *string, err error) {
    switch scope {
    case "private":
        return false, nil, nil
    case "organization":
        if userOrgID == nil {
            return false, nil, errors.New("no organization to share with")
        }
        return false, userOrgID, nil
    case "public":
        return true, nil, nil
    default:
        return false, nil, errors.New("invalid scope")
    }
}
```

핸들러 본체:
```go
func (handler *handlers) update(writer http.ResponseWriter, request *http.Request) {
    user, _ := auth.PrincipalFromContext(request.Context())
    id := chi.URLParam(request, "id")
    var input skillUpdateInput
    // decode, validate Name != "" if present, scope in {private,organization,public} if present

    tx, err := handler.db.Pool().Begin(request.Context())
    // ...
    var templateID *string
    if err := tx.QueryRow(ctx,
        `SELECT "templateId" FROM "PresentationSkill" WHERE id=$1 AND "userId"=$2`,
        id, user.ID,
    ).Scan(&templateID); err != nil {
        // 404/403 — 소유자가 아니거나 존재하지 않음
    }

    sets, args := []string{}, []any{id, user.ID}
    if input.Name != nil { /* append "name"=$N */ }
    var isPublic *bool
    var organizationID *string
    if input.Scope != nil {
        value, orgID, scopeErr := scopeColumns(*input.Scope, user.OrganizationID)
        if scopeErr != nil { /* 400 */ }
        isPublic, organizationID = &value, orgID
        /* append "isPublic"=$N, "organizationId"=$N */
    }
    // UPDATE "PresentationSkill" SET ... WHERE id=$1 AND "userId"=$2

    if templateID != nil {
        // 같은 트랜잭션에서 UPDATE "Template" SET name/isPublic/organizationId
        // WHERE id=$templateID (Template에는 userId 소유권 체크가 이미 있으므로
        // AND "userId"=$user.ID도 같이 건다 — 방어적으로)
    }
    tx.Commit(ctx)
}
```

**`DELETE /skills/{id}`** (신규, 단건): `deleteMany`가 이미 하는 것과 같은 소유권
체크(`"userId"=$2`)로 스킬을 지우고, `templateId`가 있으면 같은 트랜잭션에서
`Template`도 지운다. `Presentation.templateId`가 `ON DELETE SET NULL`이라 이미
만들어진 발표자료는 안 깨지고 템플릿 참조만 사라진다 — 삭제 확인 문구에 이 점을
명시한다.

**미리보기 — 새 이미지 렌더링 없이, 이미 갖고 있는 첫 슬라이드 HTML을 재사용**:
`/api/extract/style`(PPTX 임포트 시 이미 호출됨)가 돌려주는 `config.htmlSlides`에
슬라이드별 HTML이 이미 들어있다 (`apps/renderer/src/services/pptx_to_html.py`).
새 렌더링 호출이나 이미지 생성 없이, `Template.config.htmlSlides[0]`을 그대로
저장해두고 미리보기 모달에서 축소된 `<iframe>`이나 `transform: scale()`된
컨테이너로 띄운다. `Template.thumbnail`/`PresentationSkill.thumbnail` 컬럼은
이번 스코프에서 쓰지 않는다 (이미지 렌더링 파이프라인을 새로 만들어야 해서
범위가 커짐 — 필요해지면 별도 스펙으로 다룬다).

### 2. 프론트엔드 — `apps/web/src/lib/api.ts` + `skills-gallery.tsx`

`skillsApi`에 추가:
```ts
update: (id: string, data: { name?: string; scope?: 'private' | 'organization' | 'public' }) =>
    api.patch(`/skills/${id}`, data),
delete: (id: string) => api.delete(`/skills/${id}`),
```

`skills-gallery.tsx` 카드(현재 `<article>` 블록)에 추가:
- 카드 우상단에 `⋯` 메뉴 버튼 (지금은 카드에 메뉴가 전혀 없으므로 새로 추가) —
  "이름 변경" / "삭제"
- 공개 범위 배지 — `admin/templates/page.tsx`의 `handleToggleTemplatePublic` 배지와
  같은 시각 스타일(초록 `공개`/회색 `비공개`)에 "조직공개"용 파란 배지를 추가한
  3단 버튼. 클릭하면 다음 상태로 순환(비공개→조직공개→전체공개→비공개)하거나
  작은 드롭다운으로 선택. 조직이 없는 사용자에겐 "조직공개" 옵션을 건너뛴다.
- 이름 변경은 기존 "생성" 모달과 같은 `role="dialog"` 패턴으로 이름 입력칸 하나만
  있는 모달을 새로 추가 (생성 폼 전체를 재사용하지 않음)
- 썸네일 영역 클릭 → 저장된 이미지를 크게 보여주는 미리보기 모달. `templateId`가
  없는 카드는 기본 아이콘을 그대로 두고 클릭해도 아무 동작 안 함
- 삭제는 확인 다이얼로그(기존 일괄삭제처럼) 후 `skillsApi.delete(id)`, 성공 시
  목록에서 카드 제거

**필터**: 기존 카테고리 필터 옆에 공개범위 필터(전체/내 비공개/내 조직공개/전체공개)를
추가. `skillsApi.list()`가 이미 `category`만 받으므로 이 필터는 클라이언트 사이드로
처리한다 (목록 자체가 이미 "내가 볼 수 있는 것"만 오므로 새 서버 파라미터 불필요).

## Testing

**Go (`apps/core-api/internal/skills`):**
- `PATCH`: 소유자만 성공, 타인은 404/403
- `PATCH scope="organization"`: `organizationId`가 없는 사용자는 에러
- `PATCH`가 연결된 `Template`의 name/isPublic/organizationId까지 같이 갱신하는지
- `PATCH name=""`: 400
- `DELETE /{id}`: 연결된 Template도 같이 지워지는지, 그 템플릿을 참조하던
  `Presentation.templateId`가 NULL로 남는지 (기존 FK 제약 그대로 동작하는지 확인)
- `DELETE /{id}`: 타인의 스킬은 404

**웹 (`apps/web/test/`):** 기존 skills 관련 테스트 파일 패턴을 따라 —
- 이름 변경 모달 제출 → `skillsApi.update` 호출 확인
- 공개범위 배지 클릭 → 다음 상태로 순환하는지, 조직 없는 사용자에겐 조직공개
  옵션이 안 보이는지
- 삭제 확인 다이얼로그 → 확인 시 `skillsApi.delete` 호출, 취소 시 미호출
- `templateId`가 없는 카드에는 편집/삭제만 있고 미리보기 버튼이 없는지

**실사용 검증:** 로컬 스택에서 PPTX 임포트 → 이름 변경 → 조직공개로 전환 →
(같은 조직의 다른 테스트 계정으로) 스킬 목록에 보이는지 → 전체공개로 전환 →
`/dashboard`의 공개 템플릿 갤러리에 나타나는지 → 삭제 → 이미 만든 발표자료가
안 깨지는지 확인.
