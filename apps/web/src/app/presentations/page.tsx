'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { AppShell } from '@/components/layout/app-shell';
import { useAuthStore } from '@/stores/auth-store';
import { presentationsApi, creditsApi } from '@/lib/api';
import { Plus, FileText, Clock, Wallet } from 'lucide-react';

interface Presentation {
    id: string;
    title: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    _count: { slides: number };
}

export default function PresentationsPage() {
    const router = useRouter();
    const { isAuthenticated, hasHydrated } = useAuthStore();
    const [presentations, setPresentations] = useState<Presentation[]>([]);
    const [credits, setCredits] = useState<number>(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!hasHydrated) return;
        if (!isAuthenticated) {
            router.push('/login');
            return;
        }
        (async () => {
            try {
                const [presResponse, creditsResponse] = await Promise.all([
                    presentationsApi.list(),
                    creditsApi.balance(),
                ]);
                setPresentations(presResponse.data.data);
                setCredits(creditsResponse.data.available);
            } catch (error) {
                console.error('Failed to fetch data:', error);
            } finally {
                setLoading(false);
            }
        })();
    }, [hasHydrated, isAuthenticated, router]);

    const formatDate = (dateString: string) =>
        new Date(dateString).toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });

    if (!hasHydrated || !isAuthenticated || loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            </div>
        );
    }

    return (
        <AppShell>
            <div className="container mx-auto px-6 py-8">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">내 발표함</h1>
                        <div className="flex items-center gap-3 mt-1 text-gray-500">
                            <span>{presentations.length}개의 프레젠테이션</span>
                            <span className="flex items-center gap-1 text-gray-900">
                                <Wallet className="h-4 w-4" />
                                {credits} 크레딧
                            </span>
                        </div>
                    </div>
                    <Link href="/dashboard">
                        <Button className="bg-gray-900 hover:bg-gray-700">
                            <Plus className="h-4 w-4 mr-2" />
                            새 프레젠테이션
                        </Button>
                    </Link>
                </div>

                {presentations.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-xl border-2 border-dashed">
                        <FileText className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 mb-2">프레젠테이션이 없습니다</h3>
                        <p className="text-gray-500 mb-6">첫 번째 프레젠테이션을 만들어보세요</p>
                        <Link href="/dashboard">
                            <Button className="bg-gray-900 hover:bg-gray-700">
                                <Plus className="h-4 w-4 mr-2" />
                                새 프레젠테이션 만들기
                            </Button>
                        </Link>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {presentations.map((pres) => (
                            <Link
                                key={pres.id}
                                href={`/editor/${pres.id}`}
                                className="bg-white rounded-xl border hover:shadow-lg transition-shadow overflow-hidden"
                            >
                                <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                                    <FileText className="h-12 w-12 text-gray-500" />
                                </div>
                                <div className="p-4">
                                    <h3 className="font-medium text-gray-900 truncate">{pres.title}</h3>
                                    <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
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
                                                        : 'bg-gray-100 text-gray-700'
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
                        ))}
                    </div>
                )}
            </div>
        </AppShell>
    );
}
