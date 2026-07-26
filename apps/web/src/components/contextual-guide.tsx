'use client';

import { useState, useEffect, useMemo } from 'react';
import { Lightbulb, ChevronRight, X, ArrowRight } from 'lucide-react';

/**
 * 상황별 가이드 컴포넌트
 * 현재 사용자 행동에 맞는 팁을 동적으로 표시합니다.
 */

interface ContextualTip {
    id: string;
    context: string; // 컨텍스트 키
    title: string;
    message: string;
    action?: {
        label: string;
        onClick: () => void;
    };
    priority: 'low' | 'medium' | 'high';
}

interface ContextualGuideProps {
    currentContext: string;
    additionalData?: Record<string, unknown>;
    onDismiss?: (tipId: string) => void;
    maxTips?: number;
}

// 컨텍스트별 팁 정의
const CONTEXTUAL_TIPS: ContextualTip[] = [
    // 입력 관련
    {
        id: 'input-short',
        context: 'input:short',
        title: '더 자세히 작성해보세요',
        message: '발표 주제, 대상, 목적을 포함하면 AI가 더 정확한 슬라이드를 생성합니다.',
        priority: 'high',
    },
    {
        id: 'input-no-purpose',
        context: 'input:no-purpose',
        title: '발표 목적을 선택해주세요',
        message: '목적에 맞는 템플릿과 구성이 자동으로 추천됩니다.',
        priority: 'high',
    },
    {
        id: 'input-long',
        context: 'input:long',
        title: '훌륭해요!',
        message: '충분한 정보가 입력되었습니다. 이제 생성 버튼을 눌러보세요.',
        priority: 'low',
    },
    // 편집 관련
    {
        id: 'edit-first-slide',
        context: 'edit:first-slide',
        title: '첫 슬라이드 편집 중',
        message: '타이틀 슬라이드는 청중의 첫인상을 결정합니다. 핵심 메시지를 담아보세요.',
        priority: 'medium',
    },
    {
        id: 'edit-long-text',
        context: 'edit:long-text',
        title: '텍스트가 길어요',
        message: '핵심 내용만 남기고 나머지는 발표자 노트에 추가해보세요.',
        priority: 'medium',
    },
    {
        id: 'edit-no-image',
        context: 'edit:no-image',
        title: '이미지를 추가해보세요',
        message: '시각적 요소는 발표의 전달력을 높입니다.',
        priority: 'low',
    },
    // 생성 관련
    {
        id: 'generate-waiting',
        context: 'generate:waiting',
        title: 'AI가 열심히 작업 중이에요',
        message: '평균 30초 정도 소요됩니다. 잠시만 기다려주세요.',
        priority: 'low',
    },
    {
        id: 'generate-complete',
        context: 'generate:complete',
        title: '생성 완료!',
        message: '슬라이드를 검토하고 필요한 부분을 수정해보세요.',
        priority: 'medium',
    },
    // 내보내기 관련
    {
        id: 'export-first',
        context: 'export:first',
        title: '첫 내보내기',
        message: 'PPTX 형식으로 내보내면 PowerPoint에서 추가 편집이 가능합니다.',
        priority: 'medium',
    },
    // 고급 기능
    {
        id: 'feature-keyboard',
        context: 'feature:keyboard-hint',
        title: '단축키를 사용해보세요',
        message: 'Ctrl+S로 저장, Ctrl+Z로 실행 취소가 가능합니다.',
        priority: 'low',
    },
    {
        id: 'feature-focus-mode',
        context: 'feature:focus-mode-hint',
        title: '집중 모드를 사용해보세요',
        message: '편집에 집중할 수 있도록 배경을 어둡게 만들어줍니다.',
        priority: 'low',
    },
];

// 사용자가 해제한 팁 로컬 스토리지 키
const DISMISSED_TIPS_KEY = 'jaslide_dismissed_tips';

export function ContextualGuide({
    currentContext,
    additionalData,
    onDismiss,
    maxTips = 2,
}: ContextualGuideProps) {
    const [dismissedTips, setDismissedTips] = useState<Set<string>>(new Set());
    const [isVisible, setIsVisible] = useState(true);

    // 해제된 팁 로드
    useEffect(() => {
        try {
            const saved = localStorage.getItem(DISMISSED_TIPS_KEY);
            if (saved) {
                setDismissedTips(new Set(JSON.parse(saved)));
            }
        } catch {
            // 무시
        }
    }, []);

    // 현재 컨텍스트에 맞는 팁 필터링
    const relevantTips = useMemo(() => {
        return CONTEXTUAL_TIPS
            .filter((tip) => {
                // 컨텍스트 매칭
                if (!tip.context.startsWith(currentContext.split(':')[0])) {
                    return false;
                }
                // 정확한 매칭 또는 와일드카드
                if (tip.context !== currentContext && !tip.context.endsWith('*')) {
                    return false;
                }
                // 이미 해제된 팁 제외
                if (dismissedTips.has(tip.id)) {
                    return false;
                }
                return true;
            })
            .sort((a, b) => {
                const priorityOrder = { high: 0, medium: 1, low: 2 };
                return priorityOrder[a.priority] - priorityOrder[b.priority];
            })
            .slice(0, maxTips);
    }, [currentContext, dismissedTips, maxTips]);

    // 팁 해제
    const handleDismiss = (tipId: string) => {
        const newDismissed = new Set(dismissedTips);
        newDismissed.add(tipId);
        setDismissedTips(newDismissed);

        try {
            localStorage.setItem(DISMISSED_TIPS_KEY, JSON.stringify([...newDismissed]));
        } catch {
            // 무시
        }

        onDismiss?.(tipId);
    };

    // 모든 팁 숨기기
    const handleHideAll = () => {
        setIsVisible(false);
    };

    if (!isVisible || relevantTips.length === 0) {
        return null;
    }

    return (
        <div className="space-y-2">
            {relevantTips.map((tip) => (
                <div
                    key={tip.id}
                    className={`
                        relative flex items-start gap-3 p-3 rounded-lg border transition-all
                        ${tip.priority === 'high'
                            ? 'bg-amber-50 border-amber-200'
                            : tip.priority === 'medium'
                                ? 'bg-blue-50 border-blue-200'
                                : 'bg-secondary border-border'
                        }
                    `}
                >
                    <Lightbulb
                        className={`
                            h-5 w-5 mt-0.5 flex-shrink-0
                            ${tip.priority === 'high'
                                ? 'text-amber-500'
                                : tip.priority === 'medium'
                                    ? 'text-blue-500'
                                    : 'text-muted-foreground'
                            }
                        `}
                    />
                    <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-foreground">{tip.title}</p>
                        <p className="text-sm text-muted-foreground mt-0.5">{tip.message}</p>
                        {tip.action && (
                            <button
                                onClick={tip.action.onClick}
                                className="mt-2 inline-flex items-center gap-1 text-sm text-purple-600 hover:text-purple-700"
                            >
                                {tip.action.label}
                                <ArrowRight className="h-3 w-3" />
                            </button>
                        )}
                    </div>
                    <button
                        onClick={() => handleDismiss(tip.id)}
                        className="p-1 hover:bg-black/5 rounded transition-colors"
                        aria-label="팁 닫기"
                    >
                        <X className="h-4 w-4 text-muted-foreground" />
                    </button>
                </div>
            ))}

            {relevantTips.length > 1 && (
                <button
                    onClick={handleHideAll}
                    className="text-xs text-muted-foreground hover:text-muted-foreground transition-colors"
                >
                    모든 팁 숨기기
                </button>
            )}
        </div>
    );
}

/**
 * 상황별 가이드 훅
 */
export function useContextualGuide() {
    const [context, setContext] = useState('');

    const updateContext = (newContext: string) => {
        setContext(newContext);
    };

    const clearContext = () => {
        setContext('');
    };

    return {
        context,
        updateContext,
        clearContext,
    };
}

export default ContextualGuide;
