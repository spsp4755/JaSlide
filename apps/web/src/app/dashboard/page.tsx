'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth-store';
import { authApi, presentationsApi, creditsApi } from '@/lib/api';
import {
    Plus,
    Sparkles,
    FileText,
    Clock,
    MoreVertical,
    LogOut,
    Wallet,
    Settings,
} from 'lucide-react';

interface Presentation {
    id: string;
    title: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    _count: { slides: number };
}

export default function DashboardPage() {
    const router = useRouter();
    const { user, isAuthenticated, hasHydrated, clearAuth } = useAuthStore();
    const [presentations, setPresentations] = useState<Presentation[]>([]);
    const [credits, setCredits] = useState<number>(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Wait for hydration before checking auth
        if (!hasHydrated) return;

        if (!isAuthenticated) {
            router.push('/login');
            return;
        }

        fetchData();
    }, [hasHydrated, isAuthenticated, router]);

    const fetchData = async () => {
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
    };

    const handleLogout = async () => {
        try {
            await authApi.logout();
        } catch (error) {
            console.error('Failed to end session:', error);
        } finally {
            clearAuth();
            router.push('/');
        }
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
    };

    if (!hasHydrated || !isAuthenticated || loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <header className="bg-white border-b">
                <div className="container mx-auto px-4 py-4 flex items-center justify-between">
                    <Link href="/dashboard" className="flex items-center gap-2">
                        <Sparkles className="h-6 w-6 text-purple-600" />
                        <span className="text-xl font-bold">JaSlide</span>
                    </Link>

                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 px-4 py-2 bg-purple-50 rounded-lg">
                            <Wallet className="h-4 w-4 text-purple-600" />
                            <span className="font-medium text-purple-600">{credits} 크레딧</span>
                        </div>

                        <div className="relative group">
                            <button className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100">
                                <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                                    <span className="text-purple-600 font-medium">
                                        {user?.name?.[0] || user?.email?.[0] || 'U'}
                                    </span>
                                </div>
                                <MoreVertical className="h-4 w-4 text-gray-500" />
                            </button>

                            <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-lg shadow-lg border opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all">
                                <Link href="/settings" className="flex items-center gap-2 px-4 py-3 hover:bg-gray-50 text-gray-700">
                                    <Settings className="h-4 w-4" />
                                    설정
                                </Link>
                                <button
                                    onClick={handleLogout}
                                    className="w-full flex items-center gap-2 px-4 py-3 hover:bg-gray-50 text-red-600"
                                >
                                    <LogOut className="h-4 w-4" />
                                    로그아웃
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            {/* Main */}
            <main className="container mx-auto px-4 py-8">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">내 프레젠테이션</h1>
                        <p className="text-gray-500 mt-1">
                            {presentations.length}개의 프레젠테이션
                        </p>
                    </div>

                    <Link href="/create">
                        <Button className="bg-purple-600 hover:bg-purple-700">
                            <Plus className="h-4 w-4 mr-2" />
                            새 프레젠테이션
                        </Button>
                    </Link>
                </div>

                {presentations.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-xl border-2 border-dashed">
                        <FileText className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 mb-2">
                            프레젠테이션이 없습니다
                        </h3>
                        <p className="text-gray-500 mb-6">
                            첫 번째 프레젠테이션을 만들어보세요
                        </p>
                        <Link href="/create">
                            <Button className="bg-purple-600 hover:bg-purple-700">
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
                                <div className="aspect-video bg-gradient-to-br from-purple-100 to-pink-100 flex items-center justify-center">
                                    <FileText className="h-12 w-12 text-purple-300" />
                                </div>
                                <div className="p-4">
                                    <h3 className="font-medium text-gray-900 truncate">
                                        {pres.title}
                                    </h3>
                                    <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                                        <span>{pres._count.slides} 슬라이드</span>
                                        <span className="flex items-center gap-1">
                                            <Clock className="h-3 w-3" />
                                            {formatDate(pres.updatedAt)}
                                        </span>
                                    </div>
                                    <div className="mt-2">
                                        <span
                                            className={`inline-flex px-2 py-1 text-xs rounded-full ${pres.status === 'COMPLETED'
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
            </main>
        </div>
    );
}
