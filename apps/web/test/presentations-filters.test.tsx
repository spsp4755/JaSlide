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

        expect(screen.getByText('Q3 실적 보고')).toBeDefined();
        expect(screen.queryByText('신규 프로젝트 제안')).toBeNull();
    });

    it('narrows the list by status filter, and 전체 restores it', async () => {
        renderPage();
        await screen.findByText('Q3 실적 보고');

        fireEvent.click(screen.getByRole('button', { name: '완료' }));
        expect(screen.getByText('Q3 실적 보고')).toBeDefined();
        expect(screen.queryByText('신규 프로젝트 제안')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: '전체' }));
        expect(screen.getByText('신규 프로젝트 제안')).toBeDefined();
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

        expect(await screen.findByText('검색 결과가 없습니다')).toBeDefined();
        expect(screen.queryByText('첫 번째 프레젠테이션을 만들어보세요')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: '필터 초기화' }));
        expect(await screen.findByText('신규 프로젝트 제안')).toBeDefined();
    });

    it('still shows the original zero-presentations state when the account has none at all', async () => {
        listMock.mockResolvedValue({ data: { data: [] } });
        renderPage();
        expect(await screen.findByText('프레젠테이션이 없습니다')).toBeDefined();
    });
});
