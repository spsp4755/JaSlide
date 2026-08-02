# 내 발표함 검색/필터/정렬 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add client-side title search, status filter chips, and sort ordering to the 내 발표함 (My Presentations) list page, fix the bug that silently caps the list at 10 items, and add a dedicated empty-search-result state.

**Architecture:** Single-file frontend change to `apps/web/src/app/presentations/page.tsx` — no backend changes, no new dependencies, no new shared UI components. New filter/sort state is local `useState` in the existing component; a derived `visible` array (search → status filter → sort, in that order) replaces `presentations` as the source the card grid renders from.

**Tech Stack:** React 18 + TypeScript, Vite, Tailwind CSS, Vitest + `@testing-library/react` (jsdom environment).

## Global Constraints

- Frontend-only. Do not modify `apps/core-api` or `apps/web/src/lib/api.ts`'s `presentationsApi` signatures — only the call site in `page.tsx` changes, from `presentationsApi.list()` to `presentationsApi.list(1, 200)`.
- No new npm dependencies. `apps/web/src/components/ui/` has no select/dropdown primitive — use a plain native `<select>` for sort and plain `<button>` elements (styled like the existing `Button` component's `outline`/`default` variants via Tailwind classes, not the `Button` component itself, to match the compact chip look approved in brainstorming) for status filter chips.
- Card design (`apps/web/src/app/presentations/page.tsx` lines 102-149: the `aspect-video` thumbnail, title, slide-count/date row, status badge, `rounded-xl` border, hover shadow) must not change.
- Sort field values: `updatedAt` (default), `createdAt`, `title`. Status filter values: `ALL` (default), `COMPLETED`, `GENERATING`, `FAILED`, `DRAFT`.
- Desktop layout: search input full-width on its own row; below it, one row with status chips left-aligned and the sort `<select>` right-aligned.
- Mobile layout: same elements stacked vertically (search → chips, horizontally scrollable → sort, right-aligned → cards), nothing collapses into a secondary menu or popover.

---

### Task 1: Search, filter, sort, empty-search-state, and fetch-cap fix

**Files:**
- Modify: `apps/web/src/app/presentations/page.tsx` (entire file — read it first; it's 154 lines)
- Modify: `apps/web/package.json:9` (widen the `test` script's Vitest glob)
- Test: `apps/web/test/presentations-filters.test.tsx` (new file)

**Interfaces:**
- Consumes: `presentationsApi.list(page: number, limit: number)` (`apps/web/src/lib/api.ts:53-55`, unchanged signature — already accepts these two params, just wasn't being called with them), `useAuthStore` (`apps/web/src/stores/auth-store.ts`, has a `setState`-compatible Zustand store used directly in tests), `AppShell` (`apps/web/src/components/layout/app-shell.tsx`, unchanged, wraps the page — renders a sidebar and calls `authApi.logout()` only on an explicit click, no data fetching on mount, safe to render as-is in tests).
- Produces: nothing consumed by a later task — this is the only task in the plan.

- [ ] **Step 1: Write the failing test file**

Create `apps/web/test/presentations-filters.test.tsx`:

```tsx
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { presentationsApi } from '../src/lib/api';
import { useAuthStore } from '../src/stores/auth-store';
import PresentationsPage from '../src/app/presentations/page';

vi.mock('../src/lib/api', () => ({
    presentationsApi: {
        list: vi.fn(),
        delete: vi.fn(),
    },
}));

const listMock = vi.mocked(presentationsApi.list);

const fixture = [
    { id: '1', title: 'Q3 실적 보고', status: 'COMPLETED', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-03-01T00:00:00Z', _count: { slides: 8 } },
    { id: '2', title: '신규 프로젝트 제안', status: 'GENERATING', createdAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-15T00:00:00Z', _count: { slides: 5 } },
    { id: '3', title: '팀 온보딩 가이드', status: 'DRAFT', createdAt: '2026-01-15T00:00:00Z', updatedAt: '2026-01-20T00:00:00Z', _count: { slides: 3 } },
    { id: '4', title: '실패한 발표', status: 'FAILED', createdAt: '2026-03-05T00:00:00Z', updatedAt: '2026-03-06T00:00:00Z', _count: { slides: 1 } },
];

function renderPage() {
    return render(
        <MemoryRouter>
            <PresentationsPage />
        </MemoryRouter>
    );
}

describe('PresentationsPage filters', () => {
    beforeEach(() => {
        useAuthStore.setState({ isAuthenticated: true, hasHydrated: true, user: { id: 'u1', email: 'u@x.com', name: 'U', role: 'USER' } });
        listMock.mockResolvedValue({ data: { data: fixture } });
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('fetches with a 200 limit instead of the old 10-item default', async () => {
        renderPage();
        await waitFor(() => expect(listMock).toHaveBeenCalledWith(1, 200));
    });

    it('narrows the list by case-insensitive title search', async () => {
        renderPage();
        await screen.findByText('Q3 실적 보고');

        fireEvent.change(screen.getByPlaceholderText('제목으로 검색'), { target: { value: 'q3' } });

        expect(screen.getByText('Q3 실적 보고')).toBeInTheDocument();
        expect(screen.queryByText('신규 프로젝트 제안')).not.toBeInTheDocument();
    });

    it('narrows the list by status filter, and 전체 restores it', async () => {
        renderPage();
        await screen.findByText('Q3 실적 보고');

        fireEvent.click(screen.getByRole('button', { name: '완료' }));
        expect(screen.getByText('Q3 실적 보고')).toBeInTheDocument();
        expect(screen.queryByText('신규 프로젝트 제안')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '전체' }));
        expect(screen.getByText('신규 프로젝트 제안')).toBeInTheDocument();
    });

    it('reorders the list for each sort option', async () => {
        renderPage();
        await screen.findByText('Q3 실적 보고');

        const getTitles = () => screen.getAllByRole('heading', { level: 3 }).map((el) => el.textContent);

        // Default: 최근 수정순 (updatedAt desc) -> 실패한 발표 (03-06) first
        expect(getTitles()[0]).toBe('실패한 발표');

        fireEvent.change(screen.getByLabelText('정렬'), { target: { value: 'createdAt' } });
        // createdAt desc -> 실패한 발표 (03-05) first
        expect(getTitles()[0]).toBe('실패한 발표');

        fireEvent.change(screen.getByLabelText('정렬'), { target: { value: 'title' } });
        // title, ko locale ascending
        expect(getTitles()[0]).toBe('신규 프로젝트 제안');
    });

    it('shows a dedicated empty-search state distinct from the zero-presentations state, and its reset button restores the list', async () => {
        renderPage();
        await screen.findByText('Q3 실적 보고');

        fireEvent.change(screen.getByPlaceholderText('제목으로 검색'), { target: { value: '존재하지않는제목' } });

        expect(await screen.findByText('검색 결과가 없습니다')).toBeInTheDocument();
        expect(screen.queryByText('첫 번째 프레젠테이션을 만들어보세요')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '필터 초기화' }));
        expect(await screen.findByText('신규 프로젝트 제안')).toBeInTheDocument();
    });

    it('still shows the original zero-presentations state when the account has none at all', async () => {
        listMock.mockResolvedValue({ data: { data: [] } });
        renderPage();
        expect(await screen.findByText('프레젠테이션이 없습니다')).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `apps/web/`):
```bash
npx --yes pnpm@11.7.0 exec vitest run test/presentations-filters.test.tsx
```
Expected: FAIL — the search input, status chips, sort `<select>`, and empty-search state don't exist yet (`screen.getByPlaceholderText('제목으로 검색')` etc. will throw "Unable to find an element").

- [ ] **Step 3: Read the current file**

Read `apps/web/src/app/presentations/page.tsx` in full (154 lines) before editing — you need its exact current JSX to edit in place rather than guessing at it.

- [ ] **Step 4: Add filter/sort state and the derived `visible` list**

In `apps/web/src/app/presentations/page.tsx`, inside `PresentationsPage`, right after the existing `const [deletingId, setDeletingId] = useState<string | null>(null);` line, add:

```tsx
    const [searchText, setSearchText] = useState('');
    const [statusFilter, setStatusFilter] = useState<'ALL' | 'COMPLETED' | 'GENERATING' | 'FAILED' | 'DRAFT'>('ALL');
    const [sortBy, setSortBy] = useState<'updatedAt' | 'createdAt' | 'title'>('updatedAt');
```

Change the existing fetch call from:
```tsx
                const presResponse = await presentationsApi.list();
```
to:
```tsx
                const presResponse = await presentationsApi.list(1, 200);
```

Right before the existing `const formatDate = ...` line, add the derived list and the filter-reset handler:

```tsx
    const visible = presentations
        .filter((item) => item.title.toLowerCase().includes(searchText.trim().toLowerCase()))
        .filter((item) => statusFilter === 'ALL' || item.status === statusFilter)
        .sort((a, b) => {
            if (sortBy === 'title') return a.title.localeCompare(b.title, 'ko');
            if (sortBy === 'createdAt') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        });

    const resetFilters = () => {
        setSearchText('');
        setStatusFilter('ALL');
    };
```

- [ ] **Step 5: Add the toolbar UI and wire the three empty/list states**

Replace the existing block (currently lines 89-150 in the file — the ternary starting `{presentations.length === 0 ? (` through its closing `)}`) with:

```tsx
                {presentations.length === 0 ? (
                    <div className="text-center py-20 bg-card rounded-xl border-2 border-dashed">
                        <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-foreground mb-2">프레젠테이션이 없습니다</h3>
                        <p className="text-muted-foreground mb-6">첫 번째 프레젠테이션을 만들어보세요</p>
                        <Link href="/dashboard">
                            <Button className="bg-primary hover:opacity-90">
                                <Plus className="h-4 w-4 mr-2" />
                                새 프레젠테이션 만들기
                            </Button>
                        </Link>
                    </div>
                ) : (
                    <>
                        <div className="mb-6">
                            <input
                                type="text"
                                value={searchText}
                                onChange={(event) => setSearchText(event.target.value)}
                                placeholder="제목으로 검색"
                                className="w-full rounded-lg border border-input bg-background px-4 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex gap-2 overflow-x-auto pb-1">
                                    {([
                                        ['ALL', '전체'],
                                        ['COMPLETED', '완료'],
                                        ['GENERATING', '생성 중'],
                                        ['FAILED', '실패'],
                                        ['DRAFT', '초안'],
                                    ] as const).map(([value, label]) => (
                                        <button
                                            key={value}
                                            type="button"
                                            onClick={() => setStatusFilter(value)}
                                            className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                                                statusFilter === value
                                                    ? 'border-foreground bg-foreground text-background'
                                                    : 'border-input bg-background text-foreground hover:bg-accent'
                                            }`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                                <div className="flex items-center gap-2 sm:justify-end">
                                    <label htmlFor="presentations-sort" className="sr-only">정렬</label>
                                    <select
                                        id="presentations-sort"
                                        aria-label="정렬"
                                        value={sortBy}
                                        onChange={(event) => setSortBy(event.target.value as typeof sortBy)}
                                        className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm"
                                    >
                                        <option value="updatedAt">최근 수정순</option>
                                        <option value="createdAt">생성순</option>
                                        <option value="title">제목순</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {visible.length === 0 ? (
                            <div className="text-center py-20 bg-card rounded-xl border-2 border-dashed">
                                <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                                <h3 className="text-lg font-medium text-foreground mb-2">검색 결과가 없습니다</h3>
                                <p className="text-muted-foreground mb-6">다른 검색어나 필터를 시도해보세요</p>
                                <Button onClick={resetFilters} className="bg-primary hover:opacity-90">
                                    필터 초기화
                                </Button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {visible.map((pres) => (
                                    <div key={pres.id} className="relative bg-card rounded-xl border hover:shadow-lg transition-shadow overflow-hidden">
                                    <Link href={`/editor/${pres.id}`} className="block">
                                        <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                                            <FileText className="h-12 w-12 text-muted-foreground" />
                                        </div>
                                        <div className="p-4">
                                            <h3 className="font-medium text-foreground truncate">{pres.title}</h3>
                                            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                                                <span>{pres._count.slides} 슬라이드</span>
                                                <span className="flex items-center gap-1">
                                                    <Clock className="h-3 w-3" />
                                                    {formatDate(pres.updatedAt)}
                                                </span>
                                            </div>
                                            <div className="mt-2">
                                                <span
                                                    className={`inline-flex px-2 py-1 text-xs rounded-full ${
                                                        pres.status === 'COMPLETED'
                                                            ? 'bg-green-100 text-green-700'
                                                            : pres.status === 'GENERATING'
                                                              ? 'bg-yellow-100 text-yellow-700'
                                                              : pres.status === 'FAILED'
                                                                ? 'bg-red-100 text-red-700'
                                                                : 'bg-secondary text-foreground'
                                                    }`}
                                                >
                                                    {pres.status === 'COMPLETED' && '완료'}
                                                    {pres.status === 'GENERATING' && '생성 중'}
                                                    {pres.status === 'FAILED' && '실패'}
                                                    {pres.status === 'DRAFT' && '초안'}
                                                </span>
                                            </div>
                                        </div>
                                    </Link>
                                    <button
                                        type="button"
                                        aria-label={`${pres.title} 삭제`}
                                        disabled={deletingId === pres.id}
                                        onClick={() => deletePresentation(pres)}
                                        className="absolute right-3 top-3 rounded-md bg-card/90 p-2 text-red-600 shadow hover:bg-red-50 disabled:opacity-50"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}
```

Note the heading tag for each card stays `<h3>` (unchanged) — the sort-order test relies on `getAllByRole('heading', { level: 3 })` matching only the card titles, so do not introduce another `<h3>` anywhere else in this block.

- [ ] **Step 6: Widen the test script to pick up the new test file**

In `apps/web/package.json`, change line 9 from:
```json
        "test": "node --test ./test/*.test.js && vitest run ./test/router.test.tsx",
```
to:
```json
        "test": "node --test ./test/*.test.js && vitest run ./test/router.test.tsx ./test/presentations-filters.test.tsx",
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd apps/web
npx --yes pnpm@11.7.0 exec vitest run test/presentations-filters.test.tsx test/router.test.tsx
```
Expected: PASS, all tests in both files (confirms this change didn't break the existing router test, which also touches authenticated routes).

If the local Node version is below 22.13 (check with `node -v`), use `/opt/homebrew/opt/node@24/bin/node` on PATH first, e.g.:
```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
```

- [ ] **Step 8: Manually verify in the browser**

The Vite dev server should already be running at `http://localhost:3010` (started via the `web-dev` launch config, proxying `/api` to the core-api Docker container on port 4000). Log in with the test account (`test@koreacb.com` / `test1234`), navigate to 내 발표함 (`/presentations`), and confirm: the search box narrows the grid as you type, clicking a status chip filters the grid and highlights the active chip, the sort dropdown reorders cards, and typing a nonsense search term shows "검색 결과가 없습니다" with a working "필터 초기화" button. If the account has zero presentations, create one or two first (via 홈 대시보드) so there's something to filter.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/app/presentations/page.tsx apps/web/package.json apps/web/test/presentations-filters.test.tsx
git commit -m "feat(web): add search/filter/sort to the presentations list page"
git push origin feature/presentations-list-search-filter
```
