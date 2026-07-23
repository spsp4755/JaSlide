'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, FileText, Grid2X2, Home, Image, Menu, MessageSquareText, MoreHorizontal, Plus, Presentation, Sparkles, UserRound } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';

const apps = [
    { name: 'AI 슬라이드', description: '프레젠테이션 만들기', icon: Presentation, href: '/dashboard?focus=1', active: true },
    { name: 'AI 문서', description: '문서 작성과 요약', icon: FileText },
    { name: 'AI 회의록', description: '회의 내용 정리', icon: MessageSquareText },
    { name: 'AI 이미지', description: '이미지 생성', icon: Image },
];

export default function WorkspaceHomePage() {
    const router = useRouter();
    const { isAuthenticated, hasHydrated, user } = useAuthStore();
    const [prompt, setPrompt] = useState('');

    useEffect(() => {
        if (hasHydrated && !isAuthenticated) router.replace('/login');
    }, [hasHydrated, isAuthenticated, router]);

    const openSlides = () => router.push('/dashboard?focus=1');
    const submitPrompt = () => {
        if (!prompt.trim()) return;
        router.push(`/dashboard?focus=1&prompt=${encodeURIComponent(prompt.trim())}`);
    };

    if (!hasHydrated || !isAuthenticated) {
        return <div className="min-h-screen bg-white" />;
    }

    return (
        <div className="min-h-screen bg-white text-zinc-950">
            <aside className="fixed inset-y-0 left-0 z-10 flex w-14 flex-col items-center border-r border-zinc-200 bg-zinc-50 py-3">
                <Link href="/home" aria-label="TaeSlide 홈" className="grid h-8 w-8 place-items-center rounded-lg bg-zinc-950 text-white">
                    <Sparkles className="h-4 w-4" />
                </Link>
                <nav className="mt-8 flex flex-1 flex-col items-center gap-5 text-[10px] text-zinc-600">
                    <button type="button" onClick={openSlides} className="flex w-11 flex-col items-center gap-1 rounded-lg py-1 hover:bg-zinc-200" aria-label="새 AI 슬라이드">
                        <Plus className="h-5 w-5" /><span>새로</span>
                    </button>
                    <Link href="/home" className="flex w-11 flex-col items-center gap-1 rounded-lg bg-white py-1 text-zinc-950 shadow-sm" aria-current="page">
                        <Home className="h-4 w-4 fill-current" /><span>홈</span>
                    </Link>
                    <Link href="/skills" className="flex w-11 flex-col items-center gap-1 rounded-lg py-1 hover:bg-zinc-200">
                        <BookOpen className="h-4 w-4" /><span>Skills</span>
                    </Link>
                    <span className="flex w-11 flex-col items-center gap-1 py-1 text-zinc-400"><Grid2X2 className="h-4 w-4" /><span>앱</span></span>
                    <span className="flex w-11 flex-col items-center gap-1 py-1 text-zinc-400"><MoreHorizontal className="h-4 w-4" /><span>더보기</span></span>
                </nav>
                <Link href="/settings" className="flex w-11 flex-col items-center gap-1 rounded-lg py-1 text-[10px] text-zinc-600 hover:bg-zinc-200">
                    <UserRound className="h-4 w-4" /><span>{user?.name?.slice(0, 6) || '계정'}</span>
                </Link>
            </aside>

            <header className="fixed inset-x-14 top-0 z-10 flex h-14 items-center border-b border-zinc-200 bg-white px-6">
                <Menu className="h-5 w-5 text-zinc-600" />
                <span className="ml-4 text-sm font-semibold tracking-tight">TaeSlide Workspace</span>
            </header>

            <main className="ml-14 flex min-h-screen flex-col items-center px-6 pt-14">
                <section className="flex w-full max-w-5xl flex-1 flex-col items-center justify-center pb-28">
                    <h1 className="mb-9 text-center text-4xl font-bold tracking-[-0.04em] sm:text-5xl">TaeSlide AI 워크스페이스</h1>
                    <div className="w-full max-w-3xl rounded-2xl border border-zinc-200 bg-white p-3 shadow-[0_16px_38px_rgba(0,0,0,0.06)]">
                        <textarea
                            value={prompt}
                            onChange={(event) => setPrompt(event.target.value)}
                            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitPrompt(); } }}
                            placeholder="무엇이든 물어보고 만들어보세요"
                            rows={3}
                            className="w-full resize-none px-2 py-1 text-base outline-none placeholder:text-zinc-400"
                        />
                        <div className="mt-2 flex items-center justify-between">
                            <button type="button" onClick={openSlides} className="grid h-9 w-9 place-items-center rounded-full border border-zinc-200 text-zinc-700 hover:bg-zinc-50" aria-label="AI 슬라이드에 파일 추가">
                                <Plus className="h-4 w-4" />
                            </button>
                            <button type="button" onClick={submitPrompt} className="rounded-full bg-zinc-950 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-85">
                                AI 슬라이드 만들기
                            </button>
                        </div>
                    </div>

                    <div className="mt-12 grid w-full max-w-4xl grid-cols-2 divide-x divide-zinc-200 md:grid-cols-4">
                        {apps.map(({ name, description, icon: Icon, href, active }) => (
                            active ? (
                                <Link key={name} href={href!} className="group flex flex-col items-center px-5 py-4 text-center">
                                    <span className="grid h-14 w-14 place-items-center rounded-2xl border-2 border-zinc-950 bg-white transition-transform group-hover:-translate-y-1"><Icon className="h-7 w-7" /></span>
                                    <span className="mt-3 text-sm font-semibold">{name}</span><span className="mt-1 text-xs text-zinc-500">{description}</span>
                                    <span className="mt-3 text-xs font-medium text-zinc-950">● 사용 가능</span>
                                </Link>
                            ) : (
                                <div key={name} className="flex flex-col items-center px-5 py-4 text-center text-zinc-400">
                                    <span className="grid h-14 w-14 place-items-center rounded-2xl border border-zinc-200"><Icon className="h-7 w-7" /></span>
                                    <span className="mt-3 text-sm font-medium">{name}</span><span className="mt-1 text-xs">{description}</span>
                                    <span className="mt-3 rounded-full border border-zinc-200 px-2 py-0.5 text-[11px]">준비 중</span>
                                </div>
                            )
                        ))}
                    </div>
                </section>
            </main>
        </div>
    );
}
