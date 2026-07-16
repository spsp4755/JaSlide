'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth-store';
import { generationApi, templatesApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { PurposeOnboarding, PurposeOption } from '@/components/purpose-onboarding';
import { InputGuidePanel } from '@/components/input-guide-panel';
import { SlideOutlinePreview } from '@/components/slide-outline-preview';
import { GenerationProgress } from '@/components/generation-progress';
import {
    ArrowLeft,
    ArrowRight,
    Sparkles,
    FileText,
    Upload,
    AlertCircle,
    Loader2,
    Eye,
    ChevronDown,
    Check,
    Palette,
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

const STEPS = ['목적', '입력', '미리보기', '옵션', '생성'] as const;

export default function CreatePage() {
    const router = useRouter();
    const { isAuthenticated, user } = useAuthStore();
    const [step, setStep] = useState(0);
    const [loading, setLoading] = useState(false);

    // Onboarding state
    const [showOnboarding, setShowOnboarding] = useState(true);
    const [selectedPurpose, setSelectedPurpose] = useState<PurposeOption | null>(null);

    // Input state
    const [inputType, setInputType] = useState<'text' | 'file'>('text');
    const [textContent, setTextContent] = useState('');
    const [uploadedFile, setUploadedFile] = useState<File | null>(null);
    const [filePreviewContent, setFilePreviewContent] = useState<string | null>(null);

    // Options state
    const [slideCount, setSlideCount] = useState(10);
    const [language, setLanguage] = useState('ko');
    const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
    const [templates, setTemplates] = useState<Template[]>([]);
    const [loadingTemplates, setLoadingTemplates] = useState(false);
    const [includeImages, setIncludeImages] = useState(true);
    const [includeCharts, setIncludeCharts] = useState(true);

    // Generation state
    const [jobId, setJobId] = useState<string | null>(null);
    const [presentationId, setPresentationId] = useState<string | null>(null);
    const [progress, setProgress] = useState(0);
    const [generationStatus, setGenerationStatus] = useState<'idle' | 'generating' | 'completed' | 'failed'>('idle');
    const [generationStartTime, setGenerationStartTime] = useState<Date | null>(null);

    // Check if onboarding should be skipped
    useEffect(() => {
        const hasSeenOnboarding = localStorage.getItem('jaslide_onboarding_seen');
        if (hasSeenOnboarding) {
            setShowOnboarding(false);
            setStep(1);
        }
    }, []);

    // Fetch templates on mount
    useEffect(() => {
        const fetchTemplates = async () => {
            setLoadingTemplates(true);
            try {
                const [apiRes, defaultsRes] = await Promise.all([
                    templatesApi.list().catch(() => ({ data: [] })),
                    templatesApi.defaults().catch(() => ({ data: [] }))
                ]);
                const apiTemplates = Array.isArray(apiRes.data) ? apiRes.data : [];
                const defaultTemplates = Array.isArray(defaultsRes.data) ? defaultsRes.data : [];
                setTemplates([...defaultTemplates, ...apiTemplates]);
            } catch (err) {
                console.error('Failed to fetch templates:', err);
            } finally {
                setLoadingTemplates(false);
            }
        };
        fetchTemplates();
    }, []);

    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        if (acceptedFiles.length > 0) {
            const file = acceptedFiles[0];
            setUploadedFile(file);
            setInputType('file');

            // Read text content for preview
            if (file.type === 'text/plain' || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
                const text = await file.text();
                setFilePreviewContent(text.slice(0, 500) + (text.length > 500 ? '...' : ''));
            } else {
                setFilePreviewContent(`파일명: ${file.name}\n크기: ${(file.size / 1024).toFixed(1)} KB`);
            }
        }
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
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
    });

    const getSourceType = () => {
        if (inputType === 'text') return 'TEXT';
        if (!uploadedFile) return 'TEXT';
        const ext = uploadedFile.name.split('.').pop()?.toLowerCase();
        const typeMap: Record<string, string> = {
            pdf: 'PDF',
            docx: 'DOCX',
            doc: 'DOCX',
            txt: 'TEXT',
            md: 'MARKDOWN',
            csv: 'CSV',
        };
        return typeMap[ext || ''] || 'TEXT';
    };

    const handleOnboardingComplete = (purpose: PurposeOption) => {
        setSelectedPurpose(purpose);
        localStorage.setItem('jaslide_onboarding_seen', 'true');
        localStorage.setItem('jaslide_last_purpose', purpose.id);
        setStep(1);
    };

    const handleOnboardingSkip = () => {
        localStorage.setItem('jaslide_onboarding_seen', 'true');
        setStep(1);
    };

    const handleExampleClick = (example: string) => {
        setTextContent(example);
    };

    const handleGenerate = async () => {
        if (!textContent && !uploadedFile) {
            toast({ title: '오류', description: '내용을 입력하거나 파일을 업로드해주세요.', variant: 'destructive' });
            return;
        }

        setLoading(true);
        setStep(4); // Go to generation step
        setGenerationStatus('generating');
        setGenerationStartTime(new Date());
        setProgress(0);

        try {
            const content = inputType === 'text' ? textContent : `File: ${uploadedFile?.name}`;

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
                    purpose: selectedPurpose?.id,
                },
            });

            setJobId(response.data.jobId);
            setPresentationId(response.data.presentationId);
            pollJobStatus(response.data.jobId, response.data.presentationId);
        } catch (error: any) {
            toast({
                title: '생성 실패',
                description: error.response?.data?.message || '프레젠테이션 생성에 실패했습니다.',
                variant: 'destructive',
            });
            setGenerationStatus('failed');
            setLoading(false);
        }
    };

    const handleCancelGeneration = async () => {
        if (!jobId) return;
        try {
            await generationApi.cancel(jobId);
            setGenerationStatus('failed');
            setLoading(false);
            setStep(3);
            toast({ title: '생성 취소됨', description: '프레젠테이션 생성을 취소했습니다.' });
        } catch (error: any) {
            toast({
                title: '취소 실패',
                description: error.response?.data?.message || '생성 작업을 취소할 수 없습니다.',
                variant: 'destructive',
            });
        }
    };

    const pollJobStatus = async (jobId: string, presentationId: string) => {
        const poll = async () => {
            try {
                const response = await generationApi.status(jobId);
                const { status: jobStatus, progress: jobProgress } = response.data;

                setProgress(jobProgress);

                if (jobStatus === 'COMPLETED') {
                    setGenerationStatus('completed');
                    toast({ title: '생성 완료', description: '프레젠테이션이 생성되었습니다!' });
                    setTimeout(() => {
                        router.push(`/editor/${presentationId}`);
                    }, 1000);
                } else if (jobStatus === 'FAILED') {
                    setGenerationStatus('failed');
                    toast({ title: '생성 실패', description: '프레젠테이션 생성에 실패했습니다.', variant: 'destructive' });
                    setLoading(false);
                } else if (jobStatus === 'CANCELLED') {
                    setGenerationStatus('failed');
                    setLoading(false);
                } else {
                    setTimeout(poll, 2000);
                }
            } catch (error) {
                toast({ title: '오류', description: '상태 확인에 실패했습니다.', variant: 'destructive' });
                setGenerationStatus('failed');
                setLoading(false);
            }
        };

        poll();
    };

    const estimatedCredits = slideCount + (includeImages ? Math.ceil(slideCount * 0.3) : 0);

    const canProceedToOutline = textContent.length > 10 || uploadedFile !== null;
    const canProceedToOptions = canProceedToOutline;

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <header className="bg-white border-b">
                <div className="container mx-auto px-4 py-4 flex items-center justify-between">
                    <Link href="/dashboard" className="flex items-center gap-2 text-gray-600 hover:text-gray-900">
                        <ArrowLeft className="h-4 w-4" />
                        대시보드로
                    </Link>
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-6 w-6 text-purple-600" />
                        <span className="text-xl font-bold">새 프레젠테이션</span>
                    </div>
                    <div className="w-24" />
                </div>
            </header>

            {/* Progress Steps */}
            {step > 0 && (
                <div className="bg-white border-b">
                    <div className="container mx-auto px-4 py-4">
                        <div className="flex items-center justify-center gap-4 md:gap-8 overflow-x-auto">
                            {STEPS.slice(1).map((stepName, index) => {
                                const actualIndex = index + 1;
                                return (
                                    <div key={stepName} className="flex items-center gap-2 flex-shrink-0">
                                        <div
                                            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${actualIndex < step
                                                ? 'bg-green-500 text-white'
                                                : actualIndex === step
                                                    ? 'bg-purple-600 text-white'
                                                    : 'bg-gray-200 text-gray-500'
                                                }`}
                                        >
                                            {actualIndex < step ? (
                                                <Check className="h-4 w-4" />
                                            ) : (
                                                index + 1
                                            )}
                                        </div>
                                        <span className={`text-sm ${actualIndex <= step ? 'text-gray-900' : 'text-gray-400'}`}>
                                            {stepName}
                                        </span>
                                        {index < STEPS.length - 2 && (
                                            <div className={`w-8 h-0.5 ${actualIndex < step ? 'bg-green-500' : 'bg-gray-200'}`} />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* Content */}
            <main className="container mx-auto px-4 py-8 max-w-3xl">
                {/* Step 0: Purpose Onboarding */}
                {step === 0 && (
                    <div className="bg-white rounded-xl border shadow-sm p-8">
                        <PurposeOnboarding
                            onComplete={handleOnboardingComplete}
                            onSkip={handleOnboardingSkip}
                        />
                    </div>
                )}

                {/* Step 1: Input */}
                {step === 1 && (
                    <div className="space-y-6">
                        <div>
                            <h2 className="text-2xl font-bold text-gray-900 mb-2">콘텐츠 입력</h2>
                            <p className="text-gray-500">
                                프레젠테이션의 주제나 내용을 입력하세요
                                {selectedPurpose && (
                                    <span className="ml-2 text-purple-600">
                                        • {selectedPurpose.title}
                                    </span>
                                )}
                            </p>
                        </div>

                        {/* Tab buttons */}
                        <div className="flex gap-2">
                            <Button
                                variant={inputType === 'text' ? 'default' : 'outline'}
                                onClick={() => setInputType('text')}
                            >
                                <FileText className="h-4 w-4 mr-2" />
                                텍스트 입력
                            </Button>
                            <Button
                                variant={inputType === 'file' ? 'default' : 'outline'}
                                onClick={() => setInputType('file')}
                            >
                                <Upload className="h-4 w-4 mr-2" />
                                파일 업로드
                            </Button>
                        </div>

                        {inputType === 'text' ? (
                            <div className="space-y-4">
                                <textarea
                                    value={textContent}
                                    onChange={(e) => setTextContent(e.target.value)}
                                    placeholder="프레젠테이션 주제나 내용을 입력하세요..."
                                    className="w-full h-48 p-4 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
                                />
                                <InputGuidePanel
                                    inputText={textContent}
                                    purpose={selectedPurpose?.id}
                                    onExampleClick={handleExampleClick}
                                />
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div
                                    {...getRootProps()}
                                    className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${isDragActive ? 'border-purple-500 bg-purple-50' : 'border-gray-300 hover:border-purple-400'
                                        }`}
                                >
                                    <input {...getInputProps()} />
                                    {uploadedFile ? (
                                        <div>
                                            <FileText className="h-12 w-12 text-purple-500 mx-auto mb-4" />
                                            <p className="font-medium text-gray-900">{uploadedFile.name}</p>
                                            <p className="text-sm text-gray-500 mt-1">
                                                {(uploadedFile.size / 1024 / 1024).toFixed(2)} MB
                                            </p>
                                            <Button variant="ghost" className="mt-4" onClick={(e) => { e.stopPropagation(); setUploadedFile(null); setFilePreviewContent(null); }}>
                                                다른 파일 선택
                                            </Button>
                                        </div>
                                    ) : (
                                        <div>
                                            <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                                            <p className="font-medium text-gray-700">파일을 드래그하거나 클릭하여 업로드</p>
                                            <p className="text-sm text-gray-500 mt-1">
                                                PDF, DOCX, TXT, MD, CSV (최대 50MB)
                                            </p>
                                        </div>
                                    )}
                                </div>

                                {/* File Preview */}
                                {filePreviewContent && (
                                    <div className="bg-gray-50 rounded-lg p-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Eye className="h-4 w-4 text-gray-500" />
                                            <span className="text-sm font-medium text-gray-700">파일 미리보기</span>
                                        </div>
                                        <pre className="text-sm text-gray-600 whitespace-pre-wrap font-mono bg-white p-3 rounded border">
                                            {filePreviewContent}
                                        </pre>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="flex justify-end">
                            <Button
                                onClick={() => setStep(2)}
                                disabled={!canProceedToOutline}
                                className="bg-purple-600 hover:bg-purple-700"
                            >
                                다음: 개요 확인
                                <ArrowRight className="h-4 w-4 ml-2" />
                            </Button>
                        </div>
                    </div>
                )}

                {/* Step 2: Outline Preview */}
                {step === 2 && (
                    <div className="space-y-6">
                        <div>
                            <h2 className="text-2xl font-bold text-gray-900 mb-2">슬라이드 개요</h2>
                            <p className="text-gray-500">생성될 슬라이드 구조를 미리 확인하세요</p>
                        </div>

                        <SlideOutlinePreview
                            inputContent={textContent}
                            slideCount={slideCount}
                            onConfirm={() => setStep(3)}
                            onRegenerate={() => {
                                // Trigger outline regeneration
                                toast({ title: '개요 재생성', description: '새로운 개요를 생성합니다.' });
                            }}
                        />

                        <div className="flex justify-between">
                            <Button variant="outline" onClick={() => setStep(1)}>
                                <ArrowLeft className="h-4 w-4 mr-2" />
                                이전
                            </Button>
                        </div>
                    </div>
                )}

                {/* Step 3: Options */}
                {step === 3 && (
                    <div className="space-y-6">
                        <div>
                            <h2 className="text-2xl font-bold text-gray-900 mb-2">생성 옵션</h2>
                            <p className="text-gray-500">프레젠테이션 스타일을 설정하세요</p>
                        </div>

                        {/* Template Selection */}
                        <div className="bg-white rounded-lg border p-6">
                            <label className="block text-sm font-medium text-gray-700 mb-3">
                                <Palette className="h-4 w-4 inline mr-2" />
                                템플릿 선택
                            </label>
                            {loadingTemplates ? (
                                <div className="flex items-center justify-center py-8">
                                    <Loader2 className="h-6 w-6 animate-spin text-purple-600" />
                                </div>
                            ) : templates.length === 0 ? (
                                <p className="text-sm text-gray-500 text-center py-4">사용 가능한 템플릿이 없습니다.</p>
                            ) : (
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                    {templates.map((template) => (
                                        <button
                                            key={template.id}
                                            type="button"
                                            onClick={() => setSelectedTemplateId(template.id === selectedTemplateId ? null : template.id)}
                                            className={`relative text-left rounded-lg overflow-hidden border-2 transition-all ${selectedTemplateId === template.id
                                                    ? 'border-purple-600 ring-2 ring-purple-200'
                                                    : 'border-gray-200 hover:border-gray-300'
                                                }`}
                                        >
                                            <div
                                                className="h-20 flex items-center justify-center text-2xl"
                                                style={{
                                                    background: template.config?.backgrounds?.value || template.config?.colors?.background || 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                                    color: template.config?.colors?.text || '#ffffff'
                                                }}
                                            >
                                                <span style={{ color: template.config?.colors?.primary || '#ffffff' }}>Aa</span>
                                            </div>
                                            <div className="p-2 bg-white">
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
                            {selectedTemplateId && (
                                <p className="mt-3 text-sm text-purple-600">
                                    선택됨: {templates.find(t => t.id === selectedTemplateId)?.name}
                                </p>
                            )}
                        </div>

                        <div className="bg-white rounded-lg border p-6 space-y-6">
                            {/* Slide count */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    슬라이드 수
                                </label>
                                <div className="flex items-center gap-4">
                                    <input
                                        type="range"
                                        min={3}
                                        max={30}
                                        value={slideCount}
                                        onChange={(e) => setSlideCount(Number(e.target.value))}
                                        className="flex-1 accent-purple-600"
                                    />
                                    <span className="w-12 text-center font-medium">{slideCount}</span>
                                </div>
                            </div>

                            {/* Language */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    언어
                                </label>
                                <div className="flex gap-2">
                                    <Button
                                        variant={language === 'ko' ? 'default' : 'outline'}
                                        onClick={() => setLanguage('ko')}
                                    >
                                        한국어
                                    </Button>
                                    <Button
                                        variant={language === 'en' ? 'default' : 'outline'}
                                        onClick={() => setLanguage('en')}
                                    >
                                        English
                                    </Button>
                                </div>
                            </div>

                            {/* Options */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    추가 옵션
                                </label>
                                <div className="space-y-2">
                                    <label className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={includeImages}
                                            onChange={(e) => setIncludeImages(e.target.checked)}
                                            className="rounded accent-purple-600"
                                        />
                                        <span>이미지 포함</span>
                                    </label>
                                    <label className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={includeCharts}
                                            onChange={(e) => setIncludeCharts(e.target.checked)}
                                            className="rounded accent-purple-600"
                                        />
                                        <span>차트 포함</span>
                                    </label>
                                </div>
                            </div>
                        </div>

                        {/* Cost estimate */}
                        <div className="bg-purple-50 rounded-lg p-4 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <AlertCircle className="h-5 w-5 text-purple-600" />
                                <span className="text-purple-900">예상 크레딧 비용</span>
                            </div>
                            <span className="font-bold text-purple-600">{estimatedCredits} 크레딧</span>
                        </div>

                        <div className="flex justify-between">
                            <Button variant="outline" onClick={() => setStep(2)}>
                                <ArrowLeft className="h-4 w-4 mr-2" />
                                이전
                            </Button>
                            <Button
                                onClick={handleGenerate}
                                disabled={loading}
                                className="bg-purple-600 hover:bg-purple-700"
                            >
                                <Sparkles className="h-4 w-4 mr-2" />
                                생성하기
                            </Button>
                        </div>
                    </div>
                )}

                {/* Step 4: Generating */}
                {step === 4 && (
                    <div className="py-8">
                        <GenerationProgress
                            currentStep=""
                            progress={progress}
                            status={generationStatus}
                            onCancel={handleCancelGeneration}
                            estimatedTime={slideCount * 3}
                            startTime={generationStartTime || undefined}
                        />
                    </div>
                )}
            </main>
        </div>
    );
}
