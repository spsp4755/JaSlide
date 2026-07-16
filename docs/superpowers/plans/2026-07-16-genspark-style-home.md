# Genspark-Style Home Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard + 5-step create wizard with a sidebar shell, prompt-first home screen, and template gallery — front-end only, reusing existing APIs and components.

**Architecture:** A new `AppShell` client component (sidebar + content) wraps the home (`/dashboard`), presentations list (`/presentations`), and settings pages. The home page hosts the prompt input, purpose tabs, file attach, options popover, template gallery, and inline generation-progress view. `/create` becomes a redirect.

**Tech Stack:** Next.js 14 App Router, Tailwind, existing `lucide-react` icons, `react-dropzone`, `zustand` auth store, existing `generationApi`/`templatesApi`/`presentationsApi`/`creditsApi` from `apps/web/src/lib/api.ts`.

## Global Constraints

- No backend/API changes; only files under `apps/web/src`.
- No new npm dependencies.
- All user-facing copy in Korean, matching existing tone (e.g. "내 발표함", "새로 만들기").
- `/editor`, `/login`, `/register`, `/admin/*` layouts unchanged.
- Purple-600 remains the primary accent color (existing convention).
- No test runner exists in `apps/web`; each task's verification is `pnpm --filter @jaslide/web build` (must pass with no type errors) plus stated manual checks.

---

### Task 1: AppShell sidebar layout component

**Files:**
- Create: `apps/web/src/components/layout/app-shell.tsx`

**Interfaces:**
- Consumes: `useAuthStore` from `@/stores/auth-store` (fields: `user`, `clearAuth`), `isAdminRole` from `@/stores/auth-store`, `authApi.logout` from `@/lib/api`.
- Produces: `export function AppShell({ children }: { children: React.ReactNode })` — later tasks wrap page content in `<AppShell>...</AppShell>`.

- [ ] **Step 1: Create the component**

```tsx
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore, isAdminRole } from '@/stores/auth-store';
import { authApi } from '@/lib/api';
import { Plus, Home, FolderOpen, Settings, Shield, LogOut, Sparkles } from 'lucide-react';

const NAV_ITEMS = [
    { href: '/dashboard', label: '홈', icon: Home },
    { href: '/presentations', label: '내 발표함', icon: FolderOpen },
    { href: '/settings', label: '설정', icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const { user, clearAuth } = useAuthStore();

    const handleLogout = async () => {
        try {
            await authApi.logout();
        } catch {
            // ignore; clear local state regardless
        } finally {
            clearAuth();
            router.push('/');
        }
    };

    return (
        <div className="min-h-screen flex bg-gray-50">
            <aside className="w-56 flex-shrink-0 border-r bg-white flex flex-col">
                <Link href="/dashboard" className="flex items-center gap-2 px-4 py-4 border-b">
                    <Sparkles className="h-6 w-6 text-purple-600" />
                    <span className="text-lg font-bold">JaSlide</span>
                </Link>

                <div className="p-3">
                    <Link
                        href="/dashboard?focus=1"
                        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 text-sm font-medium"
                    >
                        <Plus className="h-4 w-4" />
                        새로 만들기
                    </Link>
                </div>

                <nav className="flex-1 px-3 space-y-1">
                    {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
                        <Link
                            key={href}
                            href={href}
                            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${
                                pathname === href
                                    ? 'bg-purple-50 text-purple-700 font-medium'
                                    : 'text-gray-600 hover:bg-gray-100'
                            }`}
                        >
                            <Icon className="h-4 w-4" />
                            {label}
                        </Link>
                    ))}
                    {isAdminRole(user?.role) && (
                        <Link
                            href="/admin"
                            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
                        >
                            <Shield className="h-4 w-4" />
                            관리자
                        </Link>
                    )}
                </nav>

                <div className="p-3 border-t">
                    <div className="flex items-center gap-2 px-3 py-2">
                        <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0">
                            <span className="text-purple-600 font-medium text-sm">
                                {user?.name?.[0] || user?.email?.[0] || 'U'}
                            </span>
                        </div>
                        <span className="text-sm text-gray-700 truncate">{user?.name || user?.email}</span>
                    </div>
                    <button
                        onClick={handleLogout}
                        className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50"
                    >
                        <LogOut className="h-4 w-4" />
                        로그아웃
                    </button>
                </div>
            </aside>

            <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
        </div>
    );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter @jaslide/web build`
Expected: build succeeds. (If `user?.role` type errors: `useAuthStore`'s user type has `role: UserRole` — check `apps/web/src/stores/auth-store.ts:11` and adjust the optional chain, not the store.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/layout/app-shell.tsx
git commit -m "feat(web): add AppShell sidebar layout"
```

---

### Task 2: 내 발표함 page (move existing dashboard grid)

**Files:**
- Create: `apps/web/src/app/presentations/page.tsx` (content moved from `apps/web/src/app/dashboard/page.tsx`)

**Interfaces:**
- Consumes: `AppShell` from Task 1; `presentationsApi.list()`, `creditsApi.balance()` from `@/lib/api`; `useAuthStore`.
- Produces: route `/presentations` rendering the presentation card grid inside the shell.

- [ ] **Step 1: Create the page**

Copy the body of the current `apps/web/src/app/dashboard/page.tsx` with these changes: wrap content in `<AppShell>`, delete the old `<header>` block entirely (logo, credits pill, avatar dropdown, logout — the shell owns nav/logout now), keep the credits display as a small inline badge next to the page title, and point "새 프레젠테이션" buttons at `/dashboard`.

```tsx
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
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
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
                            <span className="flex items-center gap-1 text-purple-600">
                                <Wallet className="h-4 w-4" />
                                {credits} 크레딧
                            </span>
                        </div>
                    </div>
                    <Link href="/dashboard">
                        <Button className="bg-purple-600 hover:bg-purple-700">
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
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter @jaslide/web build`
Expected: build succeeds; `/presentations` appears in the route list.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/presentations/page.tsx
git commit -m "feat(web): add presentations library page"
```

---

### Task 3: New home page — prompt box, purpose tabs, options, generation flow

**Files:**
- Modify: `apps/web/src/app/dashboard/page.tsx` (full replacement)

**Interfaces:**
- Consumes: `AppShell` (Task 1); `PURPOSE_OPTIONS`, `PurposeOption` from `@/components/purpose-onboarding`; `GenerationProgress` from `@/components/generation-progress` (props: `currentStep: string`, `progress: number`, `status: 'idle'|'generating'|'completed'|'failed'`, `onCancel`, `estimatedTime`, `startTime`); `generationApi.start/status/cancel`, `templatesApi.list/defaults` from `@/lib/api`; `useDropzone`; `toast` from `@/hooks/use-toast`.
- Produces: `/dashboard` as the Genspark-style home. Template gallery renders from the `templates` state populated here (Task 4 extends the same file's gallery section — this task includes the full gallery markup so Task 4 is only category filtering).

- [ ] **Step 1: Replace the dashboard page**

Full replacement of `apps/web/src/app/dashboard/page.tsx`:

```tsx
'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDropzone } from 'react-dropzone';
import { AppShell } from '@/components/layout/app-shell';
import { useAuthStore } from '@/stores/auth-store';
import { generationApi, templatesApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { GenerationProgress } from '@/components/generation-progress';
import { PURPOSE_OPTIONS, PurposeOption } from '@/components/purpose-onboarding';
import {
    Plus, Send, Settings2, X, FileText, Check, Loader2,
} from 'lucide-react';

interface Template {
    id: string;
    name: string;
    description?: string;
    thumbnail?: string;
    category: string;
    config?: {
        colors?: { primary?: string; background?: string; text?: string };
        backgrounds?: { value?: string };
    };
}

export default function HomePage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { isAuthenticated, hasHydrated } = useAuthStore();
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Prompt state
    const [textContent, setTextContent] = useState('');
    const [selectedPurpose, setSelectedPurpose] = useState<PurposeOption>(PURPOSE_OPTIONS[0]);
    const [uploadedFile, setUploadedFile] = useState<File | null>(null);

    // Options popover state
    const [showOptions, setShowOptions] = useState(false);
    const [slideCount, setSlideCount] = useState(10);
    const [language, setLanguage] = useState('ko');
    const [includeImages, setIncludeImages] = useState(true);
    const [includeCharts, setIncludeCharts] = useState(true);

    // Template gallery state
    const [templates, setTemplates] = useState<Template[]>([]);
    const [loadingTemplates, setLoadingTemplates] = useState(false);
    const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

    // Generation state
    const [jobId, setJobId] = useState<string | null>(null);
    const [progress, setProgress] = useState(0);
    const [generationStatus, setGenerationStatus] = useState<'idle' | 'generating' | 'completed' | 'failed'>('idle');
    const [generationStartTime, setGenerationStartTime] = useState<Date | null>(null);

    useEffect(() => {
        if (!hasHydrated) return;
        if (!isAuthenticated) router.push('/login');
    }, [hasHydrated, isAuthenticated, router]);

    useEffect(() => {
        if (searchParams.get('focus')) inputRef.current?.focus();
    }, [searchParams]);

    useEffect(() => {
        (async () => {
            setLoadingTemplates(true);
            try {
                const [apiRes, defaultsRes] = await Promise.all([
                    templatesApi.list().catch(() => ({ data: [] })),
                    templatesApi.defaults().catch(() => ({ data: [] })),
                ]);
                const apiTemplates = Array.isArray(apiRes.data) ? apiRes.data : [];
                const defaultTemplates = Array.isArray(defaultsRes.data) ? defaultsRes.data : [];
                setTemplates([...defaultTemplates, ...apiTemplates]);
            } catch (err) {
                console.error('Failed to fetch templates:', err);
            } finally {
                setLoadingTemplates(false);
            }
        })();
    }, []);

    const onDrop = useCallback((acceptedFiles: File[]) => {
        if (acceptedFiles.length > 0) setUploadedFile(acceptedFiles[0]);
    }, []);

    const { getRootProps, getInputProps, open: openFilePicker } = useDropzone({
        onDrop,
        accept: {
            'application/pdf': ['.pdf'],
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
            'text/plain': ['.txt'],
            'text/markdown': ['.md'],
            'text/csv': ['.csv'],
        },
        maxFiles: 1,
        maxSize: 50 * 1024 * 1024,
        noClick: true,
        noKeyboard: true,
    });

    const getSourceType = () => {
        if (!uploadedFile) return 'TEXT';
        const ext = uploadedFile.name.split('.').pop()?.toLowerCase();
        const typeMap: Record<string, string> = {
            pdf: 'PDF', docx: 'DOCX', doc: 'DOCX', txt: 'TEXT', md: 'MARKDOWN', csv: 'CSV',
        };
        return typeMap[ext || ''] || 'TEXT';
    };

    const handleGenerate = async () => {
        if (!textContent.trim() && !uploadedFile) {
            toast({ title: '오류', description: '내용을 입력하거나 파일을 첨부해주세요.', variant: 'destructive' });
            return;
        }
        setGenerationStatus('generating');
        setGenerationStartTime(new Date());
        setProgress(0);
        try {
            const content = uploadedFile ? `File: ${uploadedFile.name}` : textContent;
            const response = await generationApi.start({
                sourceType: getSourceType(),
                content,
                slideCount,
                language,
                templateId: selectedTemplateId,
                options: {
                    includeImages,
                    includeCharts,
                    style: 'professional',
                    tone: 'informative',
                    purpose: selectedPurpose.id,
                },
            });
            setJobId(response.data.jobId);
            pollJobStatus(response.data.jobId, response.data.presentationId);
        } catch (error: any) {
            toast({
                title: '생성 실패',
                description: error.response?.data?.message || '프레젠테이션 생성에 실패했습니다.',
                variant: 'destructive',
            });
            setGenerationStatus('failed');
        }
    };

    const handleCancelGeneration = async () => {
        if (!jobId) return;
        try {
            await generationApi.cancel(jobId);
            setGenerationStatus('idle');
            toast({ title: '생성 취소됨', description: '프레젠테이션 생성을 취소했습니다.' });
        } catch (error: any) {
            toast({
                title: '취소 실패',
                description: error.response?.data?.message || '생성 작업을 취소할 수 없습니다.',
                variant: 'destructive',
            });
        }
    };

    const pollJobStatus = (jobId: string, presentationId: string) => {
        const poll = async () => {
            try {
                const response = await generationApi.status(jobId);
                const { status: jobStatus, progress: jobProgress } = response.data;
                setProgress(jobProgress);
                if (jobStatus === 'COMPLETED') {
                    setGenerationStatus('completed');
                    toast({ title: '생성 완료', description: '프레젠테이션이 생성되었습니다!' });
                    setTimeout(() => router.push(`/editor/${presentationId}`), 1000);
                } else if (jobStatus === 'FAILED') {
                    setGenerationStatus('failed');
                    toast({ title: '생성 실패', description: '프레젠테이션 생성에 실패했습니다.', variant: 'destructive' });
                } else if (jobStatus === 'CANCELLED') {
                    setGenerationStatus('idle');
                } else {
                    setTimeout(poll, 2000);
                }
            } catch {
                toast({ title: '오류', description: '상태 확인에 실패했습니다.', variant: 'destructive' });
                setGenerationStatus('failed');
            }
        };
        poll();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleGenerate();
        }
    };

    if (!hasHydrated || !isAuthenticated) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
            </div>
        );
    }

    // Generation in progress: full-width progress view
    if (generationStatus === 'generating' || generationStatus === 'completed') {
        return (
            <AppShell>
                <div className="container mx-auto px-6 py-16 max-w-3xl">
                    <GenerationProgress
                        currentStep=""
                        progress={progress}
                        status={generationStatus}
                        onCancel={handleCancelGeneration}
                        estimatedTime={slideCount * 3}
                        startTime={generationStartTime || undefined}
                    />
                </div>
            </AppShell>
        );
    }

    const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

    return (
        <AppShell>
            <div {...getRootProps()} className="container mx-auto px-6 py-16 max-w-4xl">
                <input {...getInputProps()} />

                {/* Hero */}
                <div className="text-center mb-8">
                    <h1 className="text-4xl font-bold text-gray-900 mb-2">JaSlide AI 슬라이드</h1>
                    <p className="text-gray-500">누구나 전문가처럼 덱을 만들 수 있도록.</p>
                </div>

                {/* Purpose tabs */}
                <div className="flex flex-wrap items-center justify-center gap-2 mb-4">
                    {PURPOSE_OPTIONS.map((purpose) => (
                        <button
                            key={purpose.id}
                            onClick={() => {
                                setSelectedPurpose(purpose);
                                if (purpose.recommendedSlideCount) setSlideCount(purpose.recommendedSlideCount);
                            }}
                            className={`px-4 py-1.5 rounded-full text-sm border transition-colors ${
                                selectedPurpose.id === purpose.id
                                    ? 'bg-gray-900 text-white border-gray-900'
                                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                            }`}
                        >
                            {purpose.title}
                        </button>
                    ))}
                </div>

                {/* Prompt box */}
                <div className="bg-white rounded-2xl border shadow-sm p-4 mb-3">
                    <textarea
                        ref={inputRef}
                        value={textContent}
                        onChange={(e) => setTextContent(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="발표 주제와 요구 사항을 입력하세요..."
                        rows={3}
                        className="w-full resize-none focus:outline-none text-gray-900 placeholder:text-gray-400"
                    />
                    <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={openFilePicker}
                                title="파일 첨부 (PDF, DOCX, TXT, MD, CSV)"
                                className="p-2 rounded-full border text-gray-500 hover:bg-gray-50"
                            >
                                <Plus className="h-4 w-4" />
                            </button>
                            <div className="relative">
                                <button
                                    onClick={() => setShowOptions((v) => !v)}
                                    className="flex items-center gap-1.5 px-3 py-2 rounded-full border text-sm text-gray-600 hover:bg-gray-50"
                                >
                                    <Settings2 className="h-4 w-4" />
                                    {slideCount}장 · {language === 'ko' ? '한국어' : 'English'}
                                </button>
                                {showOptions && (
                                    <div className="absolute left-0 bottom-full mb-2 w-72 bg-white rounded-xl border shadow-lg p-4 space-y-4 z-10">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                슬라이드 수: {slideCount}장
                                            </label>
                                            <input
                                                type="range" min={3} max={30} value={slideCount}
                                                onChange={(e) => setSlideCount(Number(e.target.value))}
                                                className="w-full accent-purple-600"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">언어</label>
                                            <div className="flex gap-2">
                                                {(['ko', 'en'] as const).map((lang) => (
                                                    <button
                                                        key={lang}
                                                        onClick={() => setLanguage(lang)}
                                                        className={`px-3 py-1.5 rounded-lg text-sm border ${
                                                            language === lang
                                                                ? 'bg-purple-600 text-white border-purple-600'
                                                                : 'bg-white text-gray-600 border-gray-200'
                                                        }`}
                                                    >
                                                        {lang === 'ko' ? '한국어' : 'English'}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="flex items-center gap-2 text-sm">
                                                <input
                                                    type="checkbox" checked={includeImages}
                                                    onChange={(e) => setIncludeImages(e.target.checked)}
                                                    className="rounded accent-purple-600"
                                                />
                                                이미지 포함
                                            </label>
                                            <label className="flex items-center gap-2 text-sm">
                                                <input
                                                    type="checkbox" checked={includeCharts}
                                                    onChange={(e) => setIncludeCharts(e.target.checked)}
                                                    className="rounded accent-purple-600"
                                                />
                                                차트 포함
                                            </label>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                        <button
                            onClick={handleGenerate}
                            disabled={!textContent.trim() && !uploadedFile}
                            className="p-2.5 rounded-full bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40"
                            title="생성 시작"
                        >
                            <Send className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                {/* Attached file / selected template chips */}
                <div className="flex flex-wrap gap-2 mb-12 min-h-[28px]">
                    {uploadedFile && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-50 text-purple-700 rounded-full text-sm">
                            <FileText className="h-3.5 w-3.5" />
                            {uploadedFile.name}
                            <button onClick={() => setUploadedFile(null)}>
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </span>
                    )}
                    {selectedTemplate && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm">
                            템플릿: {selectedTemplate.name}
                            <button onClick={() => setSelectedTemplateId(null)}>
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </span>
                    )}
                </div>

                {/* Template gallery */}
                <section>
                    <h2 className="text-xl font-bold text-gray-900 mb-4">템플릿</h2>
                    {loadingTemplates ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-6 w-6 animate-spin text-purple-600" />
                        </div>
                    ) : templates.length === 0 ? (
                        <p className="text-sm text-gray-500 text-center py-8">사용 가능한 템플릿이 없습니다.</p>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {templates.map((template) => (
                                <button
                                    key={template.id}
                                    type="button"
                                    onClick={() =>
                                        setSelectedTemplateId(template.id === selectedTemplateId ? null : template.id)
                                    }
                                    className={`relative text-left rounded-xl overflow-hidden border-2 transition-all ${
                                        selectedTemplateId === template.id
                                            ? 'border-purple-600 ring-2 ring-purple-200'
                                            : 'border-gray-200 hover:border-gray-300'
                                    }`}
                                >
                                    <div
                                        className="h-24 flex items-center justify-center text-3xl"
                                        style={{
                                            background:
                                                template.config?.backgrounds?.value ||
                                                template.config?.colors?.background ||
                                                'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                        }}
                                    >
                                        <span style={{ color: template.config?.colors?.primary || '#ffffff' }}>Aa</span>
                                    </div>
                                    <div className="p-3 bg-white">
                                        <p className="text-sm font-medium text-gray-900 truncate">{template.name}</p>
                                        <p className="text-xs text-gray-500 truncate">{template.category}</p>
                                    </div>
                                    {selectedTemplateId === template.id && (
                                        <div className="absolute top-2 right-2 w-5 h-5 bg-purple-600 rounded-full flex items-center justify-center">
                                            <Check className="h-3 w-3 text-white" />
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </AppShell>
    );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter @jaslide/web build`
Expected: build succeeds. Note: `useSearchParams` requires the page to render within a Suspense boundary at build time in Next 14 — if the build errors with "useSearchParams() should be wrapped in a suspense boundary", wrap the exported component: rename `HomePage` to `HomePageInner` and export `export default function HomePage() { return <Suspense><HomePageInner /></Suspense>; }` (import `Suspense` from `react`).

- [ ] **Step 3: Manual check**

Run dev server (`pnpm --filter @jaslide/web dev`), log in, and verify: purpose tabs switch and update the recommended slide count in the options button label; `+` opens the file picker and the file chip appears; Enter in the textarea starts generation and shows the progress view; template card click shows the template chip.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/dashboard/page.tsx
git commit -m "feat(web): replace dashboard with prompt-first home screen"
```

---

### Task 4: Template gallery category filter

**Files:**
- Modify: `apps/web/src/app/dashboard/page.tsx` (template gallery section from Task 3)

**Interfaces:**
- Consumes: the `templates` state and gallery markup from Task 3.
- Produces: a category pill row ("전체" + distinct `template.category` values) filtering the grid client-side.

- [ ] **Step 1: Add filter state and pill row**

In `apps/web/src/app/dashboard/page.tsx`, add state next to the other template state:

```tsx
const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
```

Inside the template gallery `<section>`, between the `<h2>` and the grid, insert:

```tsx
{templates.length > 0 && (
    <div className="flex flex-wrap gap-2 mb-4">
        {[null, ...Array.from(new Set(templates.map((t) => t.category)))].map((cat) => (
            <button
                key={cat ?? 'all'}
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1 rounded-full text-sm border ${
                    categoryFilter === cat
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}
            >
                {cat ?? '전체'}
            </button>
        ))}
    </div>
)}
```

Change the grid's `templates.map(...)` to filter first:

```tsx
{templates
    .filter((t) => !categoryFilter || t.category === categoryFilter)
    .map((template) => (
```

(keep the existing card body unchanged).

- [ ] **Step 2: Verify build + manual check**

Run: `pnpm --filter @jaslide/web build` — succeeds.
Dev server: pills render one per distinct category plus "전체"; clicking filters the grid; "전체" shows all.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/dashboard/page.tsx
git commit -m "feat(web): add category filter to template gallery"
```

---

### Task 5: Redirect /create, wrap settings in shell

**Files:**
- Modify: `apps/web/src/app/create/page.tsx` (full replacement with redirect)
- Modify: `apps/web/src/app/settings/page.tsx` (wrap in AppShell)

**Interfaces:**
- Consumes: `AppShell` (Task 1).
- Produces: `/create` → permanent client redirect to `/dashboard`; `/settings` rendered inside the shell.

- [ ] **Step 1: Replace /create with a redirect**

Full new content of `apps/web/src/app/create/page.tsx`:

```tsx
import { redirect } from 'next/navigation';

// ponytail: old 5-step wizard replaced by the prompt-first home screen
export default function CreatePage() {
    redirect('/dashboard');
}
```

- [ ] **Step 2: Wrap settings page in AppShell**

In `apps/web/src/app/settings/page.tsx`: import `AppShell` (`import { AppShell } from '@/components/layout/app-shell';`), wrap the returned JSX root in `<AppShell>...</AppShell>`, and if the page has its own top header/back-link duplicating shell navigation, remove that header block. Keep all settings content and logic unchanged.

- [ ] **Step 3: Check for dead code**

Run: `grep -rn "SlideOutlinePreview\|InputGuidePanel\|PurposeOnboarding" apps/web/src --include="*.tsx" -l`
Expected: `PurposeOnboarding` still matched by `purpose-onboarding.tsx` itself and `dashboard/page.tsx` (imports `PURPOSE_OPTIONS`). If `slide-outline-preview.tsx` or `input-guide-panel.tsx` are no longer imported anywhere outside their own files, delete those two component files and include them in the commit.

- [ ] **Step 4: Verify build + manual check**

Run: `pnpm --filter @jaslide/web build` — succeeds.
Dev server: visiting `/create` lands on `/dashboard`; `/settings` shows the sidebar; `/editor/[id]` and `/admin` show no sidebar.

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/src
git commit -m "feat(web): redirect /create to home, wrap settings in shell"
```

---

### Task 6: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Build**

Run: `pnpm --filter @jaslide/web build`
Expected: clean build, routes `/dashboard`, `/presentations`, `/settings`, `/create` all present.

- [ ] **Step 2: End-to-end manual flow**

Dev server up, then verify the spec's validation list in order:
1. Log in → land on `/dashboard`, sidebar visible with 홈/내 발표함/설정 (+관리자 for admin accounts).
2. Type a prompt, press Enter → progress view appears (no outline-preview step) → editor opens on completion.
3. Attach a file via `+`, confirm chip; open options popover, change slide count/language/toggles.
4. Select a template card, generate, confirm the created presentation uses that template.
5. `내 발표함` lists presentations with status badges and credits.
6. `/editor/[id]` and `/admin` render without the sidebar.

- [ ] **Step 3: Commit any fixes found, then final commit if needed**

```bash
git add -A apps/web/src && git commit -m "fix(web): polish home redesign issues found in verification"
```

(Skip if verification found nothing.)
