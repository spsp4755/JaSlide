# 내 발표함 검색/필터/정렬 — Design Spec

Date: 2026-08-02

## Context

This is the first sub-project of a broader "UI/UX 개선" initiative the user
kicked off, scoped down from two candidate screens (홈 대시보드, 내
발표함) to just 내 발표함 (`apps/web/src/app/presentations/page.tsx`, 154
lines) — the smaller, more clearly-scoped of the two. The 홈 대시보드
(`apps/web/src/app/dashboard/page.tsx`, 792 lines: prompt input, file
upload, template gallery, skills, recent works, generation progress,
outline review all in one component) is deliberately deferred to a later
sub-project.

Today the page fetches `presentationsApi.list()` with no arguments, which
defaults to `page=1, limit=10`
(`apps/web/src/lib/api.ts:54`) — every user only ever sees their 10 most
recently updated presentations, with no way to reach the rest, even though
the backend (`apps/core-api/internal/db/presentations.go:140`,
`ListPresentations`) already returns `total`/`page`/`limit`/`totalPages`
that the frontend simply never uses. There is no search box, no status
filter, and sort order is hardcoded to `updatedAt DESC` — the backend has
no search or filter query parameters at all.

## Scope

Frontend-only change to `apps/web/src/app/presentations/page.tsx`. No
backend changes.

1. **Fix the 10-item cap.** Fetch with a large limit (200) in a single call
   instead of the current no-argument default, so search/filter/sort have
   the user's real presentation list to work against, not just the last 10.
   Accounts with more than 200 presentations still see only the 200 most
   recently updated — documented below under Future Work, not solved here.
2. **Title search.** A text input that filters the in-memory list by
   case-insensitive substring match against `title`.
3. **Status filter.** Single-select chips: 전체 (default) / 완료 / 생성 중 /
   실패 / 초안, mapping to `status` values `COMPLETED` / `GENERATING` /
   `FAILED` / `DRAFT`.
4. **Sort.** A dropdown with three options: 최근 수정순 (default, matches
   today's behavior — `updatedAt` descending), 생성순 (`createdAt`
   descending), 제목순 (`title`, Korean-locale ascending via
   `localeCompare(b, 'ko')`).
5. **Dedicated empty-search-result state**, distinct from the existing
   "발표 자료가 없습니다" (zero presentations total) state: when
   search/filter narrows the list to zero items but the account has at
   least one presentation, show "검색 결과가 없습니다" with a button that
   resets the search text and status filter back to defaults.
6. **Responsive layout**, approved via the visual-companion mockups during
   brainstorming:
   - Desktop: search input full-width on its own row; below it, one row
     with status chips on the left and the sort dropdown right-aligned.
   - Mobile: the same elements stacked vertically in the same order
     (search → chips, horizontally scrollable → sort, right-aligned →
     cards) — every control stays visible at all times, nothing collapses
     into a secondary menu.

**Explicitly out of scope:** the card design itself (thumbnail, title,
status badge, `rounded-xl` border, hover shadow) — approved as-is during
brainstorming, no changes. Server-side search/filter/pagination — deferred
per the client-side-only decision below. The 홈 대시보드 sub-project.

## Architecture

All new state lives in `PresentationsPage` (the existing component) as
plain `useState` — no new store, no URL query-string sync (out of scope;
filters reset on navigation away, matching the page's current
no-persistence behavior for its other state).

```tsx
const [searchText, setSearchText] = useState('');
const [statusFilter, setStatusFilter] = useState<'ALL' | 'COMPLETED' | 'GENERATING' | 'FAILED' | 'DRAFT'>('ALL');
const [sortBy, setSortBy] = useState<'updatedAt' | 'createdAt' | 'title'>('updatedAt');
```

The existing `presentations` state (fetched once on mount) stays the raw,
unfiltered list. A derived value — computed inline in the render, no
`useMemo` needed at this list size (client-side filtering over at most 200
items) — applies search, then status filter, then sort, in that order:

```tsx
const visible = presentations
    .filter((item) => item.title.toLowerCase().includes(searchText.trim().toLowerCase()))
    .filter((item) => statusFilter === 'ALL' || item.status === statusFilter)
    .sort((a, b) => {
        if (sortBy === 'title') return a.title.localeCompare(b.title, 'ko');
        if (sortBy === 'createdAt') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
```

The existing fetch call changes from `presentationsApi.list()` to
`presentationsApi.list(1, 200)` — the function already accepts `(page,
limit)` (`apps/web/src/lib/api.ts:53-55`), so this is a call-site change
only, no `api.ts` edit needed.

## Empty States

Three distinct states, checked in this order:

1. `loading` (existing) — spinner, unchanged.
2. `presentations.length === 0` (existing) — "발표 자료가 없습니다" +
   "첫 번째 프레젠테이션을 만들어보세요", unchanged.
3. **New:** `presentations.length > 0 && visible.length === 0` — "검색
   결과가 없습니다" with a "필터 초기화" button that calls
   `setSearchText(''); setStatusFilter('ALL')` (sort order is not reset —
   it's a display preference, not a filter, so there's nothing to
   "un-narrow").
4. `visible.length > 0` — the existing card grid, now mapping over
   `visible` instead of `presentations`.

## Testing

Following the existing pattern in `apps/web/test/router.test.tsx`
(`@testing-library/react` + `vitest`, `jsdom` environment, `vi.mock` for
API modules): add `apps/web/test/presentations-filters.test.tsx` covering,
against a fixed fixture array of presentations with varied titles/statuses/
timestamps:

- Typing into the search box narrows the rendered cards to matching titles
  only (case-insensitive).
- Clicking a status chip narrows to that status only; clicking "전체"
  restores the full list.
- Each sort option reorders the rendered cards into the expected sequence.
- Combining a search term with a status filter that together match zero
  presentations renders the "검색 결과가 없습니다" state, and clicking its
  reset button restores the full list.
- The pre-existing "발표 자료가 없습니다" state (an empty fixture array)
  still renders as before — a regression guard proving the new zero-results
  branch doesn't shadow it.

`package.json`'s existing `test` script
(`vitest run ./test/router.test.tsx`) explicitly names one file — it will
need widening to pick up the new test file (e.g. `./test/*.test.tsx`),
covered as part of implementation, not a separate task.

## Future Work

Captured here per the pattern used in this session's other sub-projects —
each item would get its own brainstorming session before implementation:

1. Server-side search/filter/pagination — needed once an account's
   presentation count meaningfully exceeds 200 (this spec's client-side
   fetch cap), or once search needs to reach into fields a client-side
   substring match can't see cheaply (e.g. slide content).
2. 홈 대시보드 UI/UX 개선 — the larger, deferred sibling of this
   sub-project (visual design, usability, responsive — same four
   improvement categories requested for this screen).
3. URL query-string sync for search/filter/sort state, so a filtered view
   survives a page refresh or is shareable via link.
