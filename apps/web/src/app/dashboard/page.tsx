'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDropzone } from 'react-dropzone';
import { AppShell } from '@/components/layout/app-shell';
import { useAuthStore } from '@/stores/auth-store';
import { generationApi, skillsApi, templatesApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { GenerationProgress } from '@/components/generation-progress';
import { PURPOSE_OPTIONS, PurposeOption } from '@/components/purpose-onboarding';
import {
    Plus, Send, Settings2, X, FileText, Check, Loader2, ArrowUp, ArrowDown, Trash2,
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

interface Skill {
    id: string;
    name: string;
    templateId?: string;
    recommendedSlideCount: number;
}

interface OutlineSlide {
    order: number;
    title: string;
    type: string;
    keyPoints: string[];
}

interface Outline {
    title: string;
    slides: OutlineSlide[];
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
    const [pptxMode, setPptxMode] = useState<'content' | 'skill'>('content');

    // Options popover state
    const [showOptions, setShowOptions] = useState(false);
    // null = 자동 (목적별 추천 장수 사용), 숫자 = 사용자가 직접 선택
    const [slideCount, setSlideCount] = useState<number | null>(null);
    const [language, setLanguage] = useState('ko');
    const [includeImages, setIncludeImages] = useState(true);
    const [includeCharts, setIncludeCharts] = useState(true);

    // Template gallery state
    const [templates, setTemplates] = useState<Template[]>([]);
    const [loadingTemplates, setLoadingTemplates] = useState(false);
    const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
    const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
    const [skills, setSkills] = useState<Skill[]>([]);
    const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);

    // Generation state
    const [jobId, setJobId] = useState<string | null>(null);
    const [progress, setProgress] = useState(0);
    const [generationStatus, setGenerationStatus] = useState<'idle' | 'generating' | 'completed' | 'failed'>('idle');
    const [generationStartTime, setGenerationStartTime] = useState<Date | null>(null);

    // Outline review state
    const [outlineLoading, setOutlineLoading] = useState(false);
    const [outline, setOutline] = useState<Outline | null>(null);
    const [pendingContent, setPendingContent] = useState('');

    useEffect(() => {
        if (!hasHydrated) return;
        if (!isAuthenticated) router.push('/login');
    }, [hasHydrated, isAuthenticated, router]);

    useEffect(() => {
        if (searchParams.get('focus')) inputRef.current?.focus();
        setSelectedSkillId(searchParams.get('skillId'));
    }, [searchParams]);

    useEffect(() => {
        (async () => {
            setLoadingTemplates(true);
            try {
                const [apiRes, defaultsRes, skillsRes] = await Promise.all([
                    templatesApi.list().catch(() => ({ data: [] })),
                    templatesApi.defaults().catch(() => ({ data: [] })),
                    skillsApi.list().catch(() => ({ data: [] })),
                ]);
                const apiTemplates = Array.isArray(apiRes.data) ? apiRes.data : [];
                const defaultTemplates = Array.isArray(defaultsRes.data) ? defaultsRes.data : [];
                setTemplates([...defaultTemplates, ...apiTemplates]);
                setSkills(Array.isArray(skillsRes.data) ? skillsRes.data : []);
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
            'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
            'text/plain': ['.txt'],
            'text/markdown': ['.md'],
            'text/csv': ['.csv'],
        },
        maxFiles: 1,
        maxSize: 50 * 1024 * 1024,
        noClick: true,
        noKeyboard: true,
    });

    // ponytail: '자동' = 목적별 추천 장수. 콘텐츠 기반 자동 산정이 필요해지면 백엔드로 이동
    const effectiveSlideCount = slideCount ?? selectedPurpose.recommendedSlideCount ?? 10;

    const handleImportSkill = async () => {
        if (!uploadedFile) return;
        setGenerationStatus('generating');
        try {
            const response = await skillsApi.importPptx(uploadedFile);
            const skill = response.data;
            setSkills((prev) => [...prev, skill]);
            setSelectedSkillId(skill.id);
            setUploadedFile(null);
            setPptxMode('content');
            toast({ title: 'Skill 등록 완료', description: `"${skill.name}" Skill이 생성되어 선택되었습니다.` });
        } catch (error: any) {
            toast({
                title: 'Skill 등록 실패',
                description: error.response?.data?.message || 'PPTX에서 Skill을 만들지 못했습니다.',
                variant: 'destructive',
            });
        } finally {
            setGenerationStatus('idle');
        }
    };

    const handleGenerate = async () => {
        if (uploadedFile?.name.toLowerCase().endsWith('.pptx') && pptxMode === 'skill') {
            return handleImportSkill();
        }
        if (!textContent.trim() && !uploadedFile) {
            toast({ title: '오류', description: '내용을 입력하거나 파일을 첨부해주세요.', variant: 'destructive' });
            return;
        }
        setOutlineLoading(true);
        try {
            const extracted = uploadedFile ? await generationApi.extractSource(uploadedFile) : null;
            const content = extracted
                ? extracted.data.chunks.map((chunk: { locator: string; content: string }) => `[${chunk.locator}]\n${chunk.content}`).join('\n\n')
                : textContent;
            setPendingContent(content);
            const response = await generationApi.outline({
                sourceType: 'TEXT',
                content,
                slideCount: effectiveSlideCount,
                language,
                skillId: selectedSkillId,
                options: {
                    includeImages,
                    includeCharts,
                    style: 'professional',
                    tone: 'informative',
                    purpose: selectedPurpose.id,
                },
            });
            setOutline(response.data);
        } catch (error: any) {
            toast({
                title: '아웃라인 생성 실패',
                description: error.response?.data?.message || '아웃라인을 만들지 못했습니다.',
                variant: 'destructive',
            });
        } finally {
            setOutlineLoading(false);
        }
    };

    const handleApproveOutline = async () => {
        if (!outline) return;
        // Renumber order and drop empty titles / key points before submitting.
        const slides = outline.slides
            .map((slide, index) => ({
                ...slide,
                order: index + 1,
                title: slide.title.trim(),
                keyPoints: slide.keyPoints.map((point) => point.trim()).filter(Boolean),
            }))
            .filter((slide) => slide.title && slide.keyPoints.length > 0);
        if (slides.length === 0) {
            toast({ title: '오류', description: '제목과 요점이 있는 슬라이드가 최소 하나는 필요합니다.', variant: 'destructive' });
            return;
        }
        const cleaned = { title: outline.title.trim() || '새 프레젠테이션', slides };

        setGenerationStatus('generating');
        setGenerationStartTime(new Date());
        setProgress(0);
        try {
            const response = await generationApi.start({
                sourceType: 'TEXT',
                content: pendingContent,
                slideCount: slides.length,
                language,
                templateId: selectedTemplateId,
                skillId: selectedSkillId,
                options: {
                    includeImages,
                    includeCharts,
                    style: 'professional',
                    tone: 'informative',
                    purpose: selectedPurpose.id,
                },
                outline: cleaned,
            });
            setOutline(null);
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

    // Outline edit helpers — operate on the draft under review.
    const editSlide = (index: number, patch: Partial<OutlineSlide>) =>
        setOutline((prev) => prev && ({ ...prev, slides: prev.slides.map((s, i) => i === index ? { ...s, ...patch } : s) }));
    const moveSlide = (index: number, delta: number) =>
        setOutline((prev) => {
            if (!prev) return prev;
            const target = index + delta;
            if (target < 0 || target >= prev.slides.length) return prev;
            const slides = [...prev.slides];
            [slides[index], slides[target]] = [slides[target], slides[index]];
            return { ...prev, slides };
        });
    const removeSlide = (index: number) =>
        setOutline((prev) => prev && ({ ...prev, slides: prev.slides.filter((_, i) => i !== index) }));
    const editKeyPoint = (slideIndex: number, pointIndex: number, value: string) =>
        setOutline((prev) => prev && ({ ...prev, slides: prev.slides.map((s, i) => i === slideIndex
            ? { ...s, keyPoints: s.keyPoints.map((p, j) => j === pointIndex ? value : p) } : s) }));
    const removeKeyPoint = (slideIndex: number, pointIndex: number) =>
        setOutline((prev) => prev && ({ ...prev, slides: prev.slides.map((s, i) => i === slideIndex
            ? { ...s, keyPoints: s.keyPoints.filter((_, j) => j !== pointIndex) } : s) }));
    const addKeyPoint = (slideIndex: number) =>
        setOutline((prev) => prev && ({ ...prev, slides: prev.slides.map((s, i) => i === slideIndex
            ? { ...s, keyPoints: [...s.keyPoints, ''] } : s) }));

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
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground"></div>
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
                        estimatedTime={effectiveSlideCount * 3}
                        startTime={generationStartTime || undefined}
                    />
                </div>
            </AppShell>
        );
    }

    // Outline loading / review step
    if (outlineLoading || outline) {
        return (
            <AppShell>
                <div className="container mx-auto px-6 py-16 max-w-3xl">
                    {!outline ? (
                        <div className="flex flex-col items-center justify-center gap-4 py-24">
                            <Loader2 className="h-8 w-8 animate-spin text-foreground" />
                            <p className="text-muted-foreground">아웃라인 생성 중…</p>
                        </div>
                    ) : (
                        <>
                            <h2 className="font-display text-2xl font-bold text-foreground mb-1">아웃라인 검토</h2>
                            <p className="text-sm text-muted-foreground mb-6">제목과 순서, 핵심 요점을 확인하고 수정한 뒤 생성하세요.</p>
                            <input
                                value={outline.title}
                                onChange={(e) => setOutline({ ...outline, title: e.target.value })}
                                aria-label="프레젠테이션 제목"
                                className="w-full rounded-lg border border-border bg-card px-4 py-3 text-lg font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                            <div className="mt-4 space-y-3">
                                {outline.slides.map((slide, i) => (
                                    <div key={i} className="rounded-xl border border-border bg-card p-4">
                                        <div className="flex items-center gap-2">
                                            <span className="w-6 text-center text-sm text-muted-foreground">{i + 1}</span>
                                            <input
                                                value={slide.title}
                                                onChange={(e) => editSlide(i, { title: e.target.value })}
                                                aria-label={`슬라이드 ${i + 1} 제목`}
                                                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                                            />
                                            <button type="button" onClick={() => moveSlide(i, -1)} disabled={i === 0} aria-label="위로" className="rounded-lg p-2 text-muted-foreground hover:bg-secondary disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                                            <button type="button" onClick={() => moveSlide(i, 1)} disabled={i === outline.slides.length - 1} aria-label="아래로" className="rounded-lg p-2 text-muted-foreground hover:bg-secondary disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                                            <button type="button" onClick={() => removeSlide(i)} aria-label="슬라이드 삭제" className="rounded-lg p-2 text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></button>
                                        </div>
                                        <div className="mt-3 space-y-2 pl-8">
                                            {slide.keyPoints.map((point, j) => (
                                                <div key={j} className="flex items-center gap-2">
                                                    <span className="text-muted-foreground">·</span>
                                                    <input
                                                        value={point}
                                                        onChange={(e) => editKeyPoint(i, j, e.target.value)}
                                                        aria-label={`슬라이드 ${i + 1} 요점 ${j + 1}`}
                                                        className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                                                    />
                                                    <button type="button" onClick={() => removeKeyPoint(i, j)} aria-label="요점 삭제" className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary"><X className="h-3.5 w-3.5" /></button>
                                                </div>
                                            ))}
                                            <button type="button" onClick={() => addKeyPoint(i)} className="text-sm text-muted-foreground hover:text-foreground">+ 요점 추가</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-6 flex justify-end gap-2">
                                <button type="button" onClick={() => setOutline(null)} className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-secondary">취소</button>
                                <button type="button" onClick={handleApproveOutline} className="rounded-xl bg-foreground px-4 py-2.5 text-sm font-medium text-background hover:opacity-85">승인하고 생성</button>
                            </div>
                        </>
                    )}
                </div>
            </AppShell>
        );
    }

    const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
    const selectedSkill = skills.find((skill) => skill.id === selectedSkillId);

    return (
        <AppShell>
            <div {...getRootProps()} className="container mx-auto px-6 py-16 max-w-4xl">
                <input {...getInputProps()} />

                {/* Hero */}
                <div className="text-center mb-8">
                    <h1 className="font-display text-5xl font-black tracking-tight text-foreground mb-3">JaSlide AI 슬라이드</h1>
                    <p className="text-gray-500">누구나 전문가처럼 덱을 만들 수 있도록.</p>
                </div>

                {/* Purpose tabs */}
                <div className="flex flex-wrap items-center justify-center gap-2 mb-4">
                    {PURPOSE_OPTIONS.map((purpose) => (
                        <button
                            key={purpose.id}
                            onClick={() => setSelectedPurpose(purpose)}
                            className={`px-4 py-1.5 rounded-full text-sm border transition-colors ${
                                selectedPurpose.id === purpose.id
                                    ? 'bg-foreground text-background border-foreground'
                                    : 'bg-card text-muted-foreground border-border hover:border-foreground/40'
                            }`}
                        >
                            {purpose.title}
                        </button>
                    ))}
                </div>

                {/* Prompt box */}
                <div className="bg-card rounded-2xl border border-border shadow-sm p-4 mb-3">
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
                                title="파일 첨부 (PDF, DOCX, XLSX, PPTX, TXT, MD, CSV)"
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
                                    {slideCount === null ? '자동' : `${slideCount}장`} · {language === 'ko' ? '한국어' : 'English'}
                                </button>
                                {showOptions && (
                                    <div className="absolute left-0 bottom-full mb-2 w-72 bg-white rounded-xl border shadow-lg p-4 space-y-4 z-10">
                                        <div>
                                            <div className="flex items-center justify-between mb-2">
                                                <label className="text-sm font-medium text-gray-700">
                                                    슬라이드 수{slideCount === null ? ` · 자동 (${effectiveSlideCount}장 예상)` : `: ${slideCount}장`}
                                                </label>
                                                <label className="flex items-center gap-1.5 text-sm text-gray-600">
                                                    <input
                                                        type="checkbox"
                                                        checked={slideCount === null}
                                                        onChange={(e) => setSlideCount(e.target.checked ? null : effectiveSlideCount)}
                                                        className="rounded accent-gray-900"
                                                    />
                                                    자동
                                                </label>
                                            </div>
                                            <input
                                                type="range" min={3} max={30} value={effectiveSlideCount}
                                                onChange={(e) => setSlideCount(Number(e.target.value))}
                                                className="w-full accent-foreground"
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
                                                                ? 'bg-foreground text-background border-foreground'
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
                                                    className="rounded accent-foreground"
                                                />
                                                이미지 포함
                                            </label>
                                            <label className="flex items-center gap-2 text-sm">
                                                <input
                                                    type="checkbox" checked={includeCharts}
                                                    onChange={(e) => setIncludeCharts(e.target.checked)}
                                                    className="rounded accent-foreground"
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
                            className="p-2.5 rounded-full bg-foreground text-background hover:opacity-85 disabled:opacity-40 transition-opacity"
                            title="생성 시작"
                        >
                            <Send className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                {/* Attached file / selected template chips */}
                <div className="flex flex-wrap gap-2 mb-12 min-h-[28px]">
                        {uploadedFile && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-secondary text-foreground rounded-full text-sm">
                            <FileText className="h-3.5 w-3.5" />
                            {uploadedFile.name}
                            <button onClick={() => setUploadedFile(null)}>
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </span>
                        )}
                        {uploadedFile?.name.toLowerCase().endsWith('.pptx') && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-secondary p-1 text-sm">
                                <button
                                    type="button"
                                    onClick={() => setPptxMode('content')}
                                    className={`rounded-full px-2.5 py-1 ${pptxMode === 'content' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
                                >
                                    내용으로 사용
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPptxMode('skill')}
                                    className={`rounded-full px-2.5 py-1 ${pptxMode === 'skill' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
                                >
                                    Skill/템플릿으로 등록
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
                        {selectedSkill && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-secondary text-foreground rounded-full text-sm">
                                Skill: {selectedSkill.name}
                                <button onClick={() => setSelectedSkillId(null)} aria-label="선택한 Skill 해제">
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </span>
                        )}
                </div>

                {/* Template gallery */}
                <section>
                    <h2 className="text-xl font-bold text-gray-900 mb-4">템플릿</h2>
                    {templates.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-4">
                            {[null, ...Array.from(new Set(templates.map((t) => t.category)))].map((cat) => (
                                <button
                                    key={cat ?? 'all'}
                                    onClick={() => setCategoryFilter(cat)}
                                    className={`px-3 py-1 rounded-full text-sm border ${
                                        categoryFilter === cat
                                            ? 'bg-foreground text-background border-foreground'
                                            : 'bg-card text-muted-foreground border-border hover:border-foreground/40'
                                    }`}
                                >
                                    {cat ?? '전체'}
                                </button>
                            ))}
                        </div>
                    )}
                    {loadingTemplates ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : templates.length === 0 ? (
                        <p className="text-sm text-gray-500 text-center py-8">사용 가능한 템플릿이 없습니다.</p>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {templates
                                .filter((t) => !categoryFilter || t.category === categoryFilter)
                                .map((template) => (
                                <button
                                    key={template.id}
                                    type="button"
                                    onClick={() =>
                                        setSelectedTemplateId(template.id === selectedTemplateId ? null : template.id)
                                    }
                                    className={`relative text-left rounded-xl overflow-hidden border-2 transition-all ${
                                        selectedTemplateId === template.id
                                            ? 'border-foreground ring-2 ring-foreground/15'
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
                                        <div className="absolute top-2 right-2 w-5 h-5 bg-foreground rounded-full flex items-center justify-center">
                                            <Check className="h-3 w-3 text-background" />
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
