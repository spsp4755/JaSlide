'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
    X,
    ChevronRight,
    ChevronLeft,
    FileText,
    Palette,
    Download,
    Sparkles,
    Check,
} from 'lucide-react';

interface TutorialStep {
    id: string;
    title: string;
    description: string;
    icon: React.ElementType;
    targetSelector?: string;
    position?: 'top' | 'bottom' | 'left' | 'right';
}

const TUTORIAL_STEPS: TutorialStep[] = [
    {
        id: 'welcome',
        title: 'JaSlide에 오신 것을 환영합니다!',
        description: 'AI를 활용해 프레젠테이션을 자동으로 생성할 수 있습니다. 간단한 튜토리얼을 시작해볼까요?',
        icon: Sparkles,
    },
    {
        id: 'input',
        title: '내용 입력하기',
        description: '발표 주제나 문서를 입력하면 AI가 자동으로 슬라이드를 생성합니다. 텍스트 입력 또는 파일 업로드가 가능합니다.',
        icon: FileText,
    },
    {
        id: 'design',
        title: '디자인 커스터마이징',
        description: '다양한 템플릿과 레이아웃을 선택해 전문적인 디자인을 적용할 수 있습니다.',
        icon: Palette,
    },
    {
        id: 'export',
        title: '다운로드 및 공유',
        description: 'PPTX, PDF 등 다양한 형식으로 내보내고, 링크를 통해 쉽게 공유하세요.',
        icon: Download,
    },
];

interface TutorialOverlayProps {
    onComplete?: () => void;
    onSkip?: () => void;
}

export function TutorialOverlay({ onComplete, onSkip }: TutorialOverlayProps) {
    const [currentStep, setCurrentStep] = useState(0);
    const [isVisible, setIsVisible] = useState(true);

    const handleNext = () => {
        if (currentStep < TUTORIAL_STEPS.length - 1) {
            setCurrentStep(currentStep + 1);
        } else {
            handleComplete();
        }
    };

    const handlePrev = () => {
        if (currentStep > 0) {
            setCurrentStep(currentStep - 1);
        }
    };

    const handleComplete = () => {
        setIsVisible(false);
        localStorage.setItem('jaslide_tutorial_completed', 'true');
        onComplete?.();
    };

    const handleSkip = () => {
        setIsVisible(false);
        localStorage.setItem('jaslide_tutorial_skipped', 'true');
        onSkip?.();
    };

    if (!isVisible) return null;

    const step = TUTORIAL_STEPS[currentStep];
    const Icon = step.icon;
    const progress = ((currentStep + 1) / TUTORIAL_STEPS.length) * 100;
    const isLastStep = currentStep === TUTORIAL_STEPS.length - 1;

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-card rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in">
                {/* Progress bar */}
                <div className="h-1 bg-secondary">
                    <div
                        className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
                        style={{ width: `${progress}%` }}
                    />
                </div>

                {/* Content */}
                <div className="p-8 text-center">
                    {/* Icon */}
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl mb-6">
                        <Icon className="h-8 w-8 text-white" />
                    </div>

                    {/* Title */}
                    <h2 className="text-xl font-bold text-foreground mb-3">
                        {step.title}
                    </h2>

                    {/* Description */}
                    <p className="text-muted-foreground mb-8 leading-relaxed">
                        {step.description}
                    </p>

                    {/* Step indicators */}
                    <div className="flex items-center justify-center gap-2 mb-6">
                        {TUTORIAL_STEPS.map((_, index) => (
                            <div
                                key={index}
                                className={`
                                    w-2 h-2 rounded-full transition-all
                                    ${index === currentStep
                                        ? 'w-6 bg-purple-500'
                                        : index < currentStep
                                            ? 'bg-purple-300'
                                            : 'bg-muted'
                                    }
                                `}
                            />
                        ))}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-between">
                        <Button
                            variant="ghost"
                            onClick={handleSkip}
                            className="text-muted-foreground hover:text-muted-foreground"
                        >
                            건너뛰기
                        </Button>

                        <div className="flex items-center gap-2">
                            {currentStep > 0 && (
                                <Button
                                    variant="outline"
                                    onClick={handlePrev}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                            )}
                            <Button
                                onClick={handleNext}
                                className="bg-purple-600 hover:bg-purple-700"
                            >
                                {isLastStep ? (
                                    <>
                                        <Check className="h-4 w-4 mr-1" />
                                        시작하기
                                    </>
                                ) : (
                                    <>
                                        다음
                                        <ChevronRight className="h-4 w-4 ml-1" />
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Check if tutorial should be shown
export function useShouldShowTutorial() {
    const [shouldShow, setShouldShow] = useState(false);

    useEffect(() => {
        const completed = localStorage.getItem('jaslide_tutorial_completed');
        const skipped = localStorage.getItem('jaslide_tutorial_skipped');
        setShouldShow(!completed && !skipped);
    }, []);

    return shouldShow;
}

// Reset tutorial status (for testing/settings)
export function resetTutorial() {
    localStorage.removeItem('jaslide_tutorial_completed');
    localStorage.removeItem('jaslide_tutorial_skipped');
}
