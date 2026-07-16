'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Sparkles, FileText, Palette, Download, ArrowRight, User, LogOut, LayoutDashboard, Settings } from 'lucide-react';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';

export default function HomePage() {
    const router = useRouter();
    const { user, isAuthenticated, hasHydrated, clearAuth } = useAuthStore();

    const handleLogout = async () => {
        try {
            await authApi.logout();
        } catch (error) {
            console.error('Failed to end session:', error);
        } finally {
            clearAuth();
            router.refresh();
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
            {/* Header */}
            <header className="container mx-auto px-4 py-6">
                <nav className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-8 w-8 text-purple-400" />
                        <span className="text-2xl font-bold text-white">JaSlide</span>
                    </div>
                    <div className="flex items-center gap-4">
                        {!hasHydrated ? (
                            // Loading state - show skeleton
                            <div className="flex items-center gap-4">
                                <div className="w-16 h-9 bg-white/10 rounded animate-pulse" />
                                <div className="w-20 h-9 bg-white/10 rounded animate-pulse" />
                            </div>
                        ) : isAuthenticated && user ? (
                            // Logged in state
                            <>
                                <Link href="/dashboard">
                                    <Button variant="ghost" className="text-white hover:text-purple-300">
                                        <LayoutDashboard className="h-4 w-4 mr-2" />
                                        대시보드
                                    </Button>
                                </Link>
                                <div className="flex items-center gap-2">
                                    <div className="flex items-center gap-2 px-3 py-1.5 bg-white/10 rounded-full">
                                        <User className="h-4 w-4 text-purple-400" />
                                        <span className="text-sm text-white">{user.name || user.email}</span>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-gray-400 hover:text-white"
                                        onClick={handleLogout}
                                    >
                                        <LogOut className="h-4 w-4" />
                                    </Button>
                                </div>
                            </>
                        ) : (
                            // Not logged in state
                            <>
                                <Link href="/login">
                                    <Button variant="ghost" className="text-white hover:text-purple-300">
                                        로그인
                                    </Button>
                                </Link>
                                <Link href="/register">
                                    <Button className="bg-purple-600 hover:bg-purple-700">
                                        시작하기
                                    </Button>
                                </Link>
                            </>
                        )}
                    </div>
                </nav>
            </header>

            {/* Hero */}
            <main className="container mx-auto px-4 py-20">
                <div className="text-center max-w-4xl mx-auto">
                    <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 leading-tight">
                        AI로 <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">프레젠테이션</span>을
                        <br />자동으로 생성하세요
                    </h1>
                    <p className="text-xl text-gray-300 mb-10 max-w-2xl mx-auto">
                        주제나 문서를 입력하면 AI가 자동으로 목차를 생성하고,
                        전문적인 슬라이드를 만들어 드립니다.
                        몇 분 안에 완성된 프레젠테이션을 받아보세요.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <Link href="/dashboard">
                            <Button size="lg" className="bg-purple-600 hover:bg-purple-700 text-lg px-8 py-6">
                                무료로 시작하기
                                <ArrowRight className="ml-2 h-5 w-5" />
                            </Button>
                        </Link>
                        <Link href="/demo">
                            <Button size="lg" variant="outline" className="text-white border-purple-400/50 bg-purple-600/20 hover:bg-purple-600/40 text-lg px-8 py-6">
                                데모 보기
                            </Button>
                        </Link>
                    </div>
                </div>

                {/* Features */}
                <div className="mt-32 grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-8 border border-white/10">
                        <div className="w-14 h-14 bg-purple-500/20 rounded-xl flex items-center justify-center mb-6">
                            <FileText className="h-7 w-7 text-purple-400" />
                        </div>
                        <h3 className="text-xl font-semibold text-white mb-3">
                            다양한 입력 지원
                        </h3>
                        <p className="text-gray-400">
                            텍스트, DOCX, PDF, Markdown 등 다양한 형식의 문서를
                            입력으로 사용할 수 있습니다.
                        </p>
                    </div>

                    <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-8 border border-white/10">
                        <div className="w-14 h-14 bg-pink-500/20 rounded-xl flex items-center justify-center mb-6">
                            <Palette className="h-7 w-7 text-pink-400" />
                        </div>
                        <h3 className="text-xl font-semibold text-white mb-3">
                            전문적인 디자인
                        </h3>
                        <p className="text-gray-400">
                            다양한 템플릿과 자동 레이아웃 시스템으로
                            전문적인 디자인을 적용합니다.
                        </p>
                    </div>

                    <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-8 border border-white/10">
                        <div className="w-14 h-14 bg-blue-500/20 rounded-xl flex items-center justify-center mb-6">
                            <Download className="h-7 w-7 text-blue-400" />
                        </div>
                        <h3 className="text-xl font-semibold text-white mb-3">
                            다양한 내보내기
                        </h3>
                        <p className="text-gray-400">
                            PPTX, PDF, Google Slides 등 원하는 형식으로
                            바로 내보낼 수 있습니다.
                        </p>
                    </div>
                </div>

                {/* Stats */}
                <div className="mt-32 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
                    <div>
                        <div className="text-4xl font-bold text-white mb-2">10+</div>
                        <div className="text-gray-400">슬라이드 템플릿</div>
                    </div>
                    <div>
                        <div className="text-4xl font-bold text-white mb-2">5초</div>
                        <div className="text-gray-400">슬라이드당 생성 시간</div>
                    </div>
                    <div>
                        <div className="text-4xl font-bold text-white mb-2">100+</div>
                        <div className="text-gray-400">무료 크레딧</div>
                    </div>
                    <div>
                        <div className="text-4xl font-bold text-white mb-2">한/영</div>
                        <div className="text-gray-400">다국어 지원</div>
                    </div>
                </div>
            </main>

            {/* Footer */}
            <footer className="container mx-auto px-4 py-8 mt-20 border-t border-white/10">
                <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-purple-400" />
                        <span className="text-white font-semibold">JaSlide</span>
                    </div>
                    <div className="text-gray-400 text-sm">
                        © 2024 JaSlide. All rights reserved.
                    </div>
                </div>
            </footer>
        </div>
    );
}
