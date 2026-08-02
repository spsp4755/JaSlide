'use client';

import { useEffect, useState } from 'react';
import Link, { useRouter } from '@/lib/router';
import { Button } from '@/components/ui/button';
import { AppShell } from '@/components/layout/app-shell';
import { useAuthStore } from '@/stores/auth-store';
import { presentationsApi } from '@/lib/api';
import { Plus, FileText, Clock, Trash2 } from 'lucide-react';

type PresentationStatus = 'COMPLETED' | 'GENERATING' | 'FAILED' | 'DRAFT';

interface Presentation {
    id: string;
    title: string;
    status: PresentationStatus;
    createdAt: string;
    updatedAt: string;
    _count: { slides: number };
}

export default function PresentationsPage() {
    const router = useRouter();
    const { isAuthenticated, hasHydrated } = useAuthStore();
    const [presentations, setPresentations] = useState<Presentation[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [searchText, setSearchText] = useState('');
    const [statusFilter, setStatusFilter] = useState<'ALL' | PresentationStatus>('ALL');
    const [sortBy, setSortBy] = useState<'updatedAt' | 'createdAt' | 'title'>('updatedAt');

    useEffect(() => {
        if (!hasHydrated) return;
        if (!isAuthenticated) {
            router.push('/login');
            return;
        }
        (async () => {
            try {
                const presResponse = await presentationsApi.list(1, 200);
                setPresentations(presResponse.data.data);
                setTotal(presResponse.data.total ?? presResponse.data.data.length);
            } catch (error) {
                console.error('Failed to fetch data:', error);
            } finally {
                setLoading(false);
            }
        })();
    }, [hasHydrated, isAuthenticated, router]);

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

    const formatDate = (dateString: string) =>
        new Date(dateString).toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });

    const deletePresentation = async (presentation: Presentation) => {
        if (!window.confirm(`"${presentation.title}" 발표 자료를 삭제할까요?`)) return;
        setDeletingId(presentation.id);
        try {
            await presentationsApi.delete(presentation.id);
            setPresentations((current) => current.filter((item) => item.id !== presentation.id));
        } finally {
            setDeletingId(null);
        }
    };

    if (!hasHydrated || !isAuthenticated || loading) {
        return (
            <div className="min-h-screen bg-secondary flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            </div>
        );
    }

    return (
        <AppShell>
            <div className="container mx-auto px-6 py-8">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">내 발표함</h1>
                        <div className="flex items-center gap-3 mt-1 text-muted-foreground">
                            <span role="status">
                                {searchText || statusFilter !== 'ALL'
                                    ? `전체 ${presentations.length}개 중 ${visible.length}개 표시`
                                    : total > presentations.length
                                      ? `총 ${total}개 중 최근 ${presentations.length}개 표시`
                                      : `${presentations.length}개의 프레젠테이션`}
                            </span>
                        </div>
                    </div>
                    <Link href="/dashboard">
                        <Button className="bg-primary hover:opacity-90">
                            <Plus className="h-4 w-4 mr-2" />
                            새 프레젠테이션
                        </Button>
                    </Link>
                </div>

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
                                type="search"
                                value={searchText}
                                onChange={(event) => setSearchText(event.target.value)}
                                placeholder="제목으로 검색"
                                aria-label="제목으로 검색"
                                className="w-full rounded-lg border border-input bg-background px-4 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex items-center gap-2 overflow-x-auto pb-1">
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
                                            aria-pressed={statusFilter === value}
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
                                    {(searchText || statusFilter !== 'ALL') && (
                                        <button
                                            type="button"
                                            onClick={resetFilters}
                                            className="whitespace-nowrap text-xs font-medium text-muted-foreground underline hover:text-foreground"
                                        >
                                            필터 초기화
                                        </button>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 sm:justify-end">
                                    <label htmlFor="presentations-sort" className="sr-only">정렬</label>
                                    <select
                                        id="presentations-sort"
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
            </div>
        </AppShell>
    );
}
