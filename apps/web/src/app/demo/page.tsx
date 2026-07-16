'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
    Sparkles,
    ArrowLeft,
    ArrowRight,
    ChevronLeft,
    ChevronRight,
    Play,
    Pause,
    FileText,
    Palette,
    Zap,
    Download
} from 'lucide-react';

// Demo slides showcasing JaSlide features
const demoSlides = [
    {
        id: 1,
        title: 'AI 프레젠테이션 자동 생성',
        subtitle: 'JaSlide로 몇 분 만에 전문적인 프레젠테이션을 만들어보세요',
        type: 'title',
        background: 'bg-gradient-to-br from-purple-600 to-indigo-700',
    },
    {
        id: 2,
        title: '다양한 입력 방식 지원',
        type: 'content',
        background: 'bg-gradient-to-br from-blue-600 to-cyan-600',
        bullets: [
            '텍스트로 주제만 입력',
            'DOCX, PDF 문서 업로드',
            'Markdown 파일 지원',
            'Excel/CSV 데이터 시각화',
        ],
    },
    {
        id: 3,
        title: 'AI가 자동으로 구성',
        type: 'feature',
        background: 'bg-gradient-to-br from-emerald-600 to-teal-600',
        features: [
            { icon: FileText, title: '목차 생성', desc: '주제에 맞는 최적의 목차를 AI가 제안' },
            { icon: Palette, title: '디자인 적용', desc: '전문 디자이너 수준의 레이아웃 자동 적용' },
            { icon: Zap, title: '빠른 생성', desc: '슬라이드당 5초, 전체 발표자료 3분 완성' },
        ],
    },
    {
        id: 4,
        title: '실시간 편집 & 협업',
        type: 'content',
        background: 'bg-gradient-to-br from-orange-500 to-pink-600',
        bullets: [
            '드래그 앤 드롭으로 쉬운 편집',
            '자연어로 슬라이드 수정 요청',
            '팀원과 실시간 공동 작업',
            '버전 히스토리 & 복원',
        ],
    },
    {
        id: 5,
        title: '다양한 내보내기 옵션',
        type: 'export',
        background: 'bg-gradient-to-br from-violet-600 to-purple-700',
        exports: [
            { format: 'PPTX', desc: 'PowerPoint 파일로 다운로드' },
            { format: 'PDF', desc: '고품질 PDF로 저장' },
            { format: 'Google Slides', desc: '구글 슬라이드로 직접 내보내기' },
        ],
    },
    {
        id: 6,
        title: '지금 바로 시작하세요!',
        subtitle: '무료 100 크레딧으로 JaSlide의 모든 기능을 체험해보세요',
        type: 'cta',
        background: 'bg-gradient-to-br from-purple-600 via-pink-600 to-orange-500',
    },
];

export default function DemoPage() {
    const [currentSlide, setCurrentSlide] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);

    const nextSlide = () => {
        setCurrentSlide((prev) => (prev + 1) % demoSlides.length);
    };

    const prevSlide = () => {
        setCurrentSlide((prev) => (prev - 1 + demoSlides.length) % demoSlides.length);
    };

    const goToSlide = (index: number) => {
        setCurrentSlide(index);
    };

    // Auto-play functionality
    useState(() => {
        if (isPlaying) {
            const interval = setInterval(() => {
                nextSlide();
            }, 4000);
            return () => clearInterval(interval);
        }
    });

    const slide = demoSlides[currentSlide];

    return (
        <div className="min-h-screen bg-slate-900 flex flex-col">
            {/* Header */}
            <header className="container mx-auto px-4 py-4">
                <nav className="flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors">
                        <ArrowLeft className="h-4 w-4" />
                        홈으로
                    </Link>
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-6 w-6 text-purple-400" />
                        <span className="text-xl font-bold text-white">JaSlide Demo</span>
                    </div>
                    <Link href="/register">
                        <Button size="sm" className="bg-purple-600 hover:bg-purple-700">
                            무료로 시작
                        </Button>
                    </Link>
                </nav>
            </header>

            {/* Slide Viewer */}
            <main className="flex-1 container mx-auto px-4 py-8 flex flex-col items-center justify-center">
                <div className="w-full max-w-5xl">
                    {/* Slide Frame */}
                    <div className={`relative aspect-[16/9] rounded-2xl overflow-hidden shadow-2xl ${slide.background}`}>
                        {/* Slide Content */}
                        <div className="absolute inset-0 flex items-center justify-center p-12">
                            {slide.type === 'title' && (
                                <div className="text-center">
                                    <h1 className="text-5xl md:text-6xl font-bold text-white mb-6">{slide.title}</h1>
                                    <p className="text-xl md:text-2xl text-white/80">{slide.subtitle}</p>
                                </div>
                            )}

                            {slide.type === 'content' && (
                                <div className="w-full max-w-3xl">
                                    <h2 className="text-4xl font-bold text-white mb-10 text-center">{slide.title}</h2>
                                    <ul className="space-y-4">
                                        {slide.bullets?.map((bullet, index) => (
                                            <li
                                                key={index}
                                                className="flex items-center gap-4 text-xl text-white/90"
                                                style={{ animationDelay: `${index * 0.1}s` }}
                                            >
                                                <div className="w-3 h-3 bg-white/80 rounded-full" />
                                                {bullet}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {slide.type === 'feature' && (
                                <div className="w-full max-w-4xl">
                                    <h2 className="text-4xl font-bold text-white mb-12 text-center">{slide.title}</h2>
                                    <div className="grid grid-cols-3 gap-8">
                                        {slide.features?.map((feature, index) => (
                                            <div key={index} className="text-center">
                                                <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                                    <feature.icon className="h-8 w-8 text-white" />
                                                </div>
                                                <h3 className="text-xl font-semibold text-white mb-2">{feature.title}</h3>
                                                <p className="text-white/70">{feature.desc}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {slide.type === 'export' && (
                                <div className="w-full max-w-3xl">
                                    <h2 className="text-4xl font-bold text-white mb-12 text-center">{slide.title}</h2>
                                    <div className="space-y-6">
                                        {slide.exports?.map((exp, index) => (
                                            <div
                                                key={index}
                                                className="flex items-center gap-6 bg-white/10 rounded-xl p-6"
                                            >
                                                <div className="w-12 h-12 bg-white/20 rounded-lg flex items-center justify-center">
                                                    <Download className="h-6 w-6 text-white" />
                                                </div>
                                                <div>
                                                    <h3 className="text-xl font-semibold text-white">{exp.format}</h3>
                                                    <p className="text-white/70">{exp.desc}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {slide.type === 'cta' && (
                                <div className="text-center">
                                    <h1 className="text-5xl md:text-6xl font-bold text-white mb-6">{slide.title}</h1>
                                    <p className="text-xl md:text-2xl text-white/80 mb-10">{slide.subtitle}</p>
                                    <Link href="/register">
                                        <Button size="lg" className="bg-white text-purple-600 hover:bg-gray-100 text-lg px-8 py-6">
                                            무료로 시작하기
                                            <ArrowRight className="ml-2 h-5 w-5" />
                                        </Button>
                                    </Link>
                                </div>
                            )}
                        </div>

                        {/* Navigation Arrows */}
                        <button
                            onClick={prevSlide}
                            className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-black/30 hover:bg-black/50 rounded-full flex items-center justify-center text-white transition-colors"
                        >
                            <ChevronLeft className="h-6 w-6" />
                        </button>
                        <button
                            onClick={nextSlide}
                            className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-black/30 hover:bg-black/50 rounded-full flex items-center justify-center text-white transition-colors"
                        >
                            <ChevronRight className="h-6 w-6" />
                        </button>

                        {/* Slide Number */}
                        <div className="absolute bottom-4 right-4 bg-black/30 px-3 py-1 rounded-full text-white text-sm">
                            {currentSlide + 1} / {demoSlides.length}
                        </div>
                    </div>

                    {/* Controls */}
                    <div className="mt-8 flex items-center justify-center gap-4">
                        {/* Slide Dots */}
                        <div className="flex items-center gap-2">
                            {demoSlides.map((_, index) => (
                                <button
                                    key={index}
                                    onClick={() => goToSlide(index)}
                                    className={`w-3 h-3 rounded-full transition-colors ${index === currentSlide
                                            ? 'bg-purple-500'
                                            : 'bg-gray-600 hover:bg-gray-500'
                                        }`}
                                />
                            ))}
                        </div>

                        {/* Play/Pause */}
                        <button
                            onClick={() => setIsPlaying(!isPlaying)}
                            className="w-10 h-10 bg-purple-600 hover:bg-purple-700 rounded-full flex items-center justify-center text-white transition-colors"
                        >
                            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
                        </button>
                    </div>

                    {/* Info Text */}
                    <p className="mt-8 text-center text-gray-400">
                        이 데모는 JaSlide로 생성된 프레젠테이션의 예시입니다.
                        <br />
                        <Link href="/dashboard" className="text-purple-400 hover:text-purple-300">
                            직접 만들어보기 →
                        </Link>
                    </p>
                </div>
            </main>
        </div>
    );
}
