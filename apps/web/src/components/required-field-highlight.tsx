'use client';

import { useState, useEffect, useMemo } from 'react';
import { Sparkles, Check, Star } from 'lucide-react';

/**
 * 필수 입력 항목을 시각적으로 강조하는 컴포넌트
 */

interface RequiredFieldHighlightProps {
    children: React.ReactNode;
    isRequired?: boolean;
    isFilled?: boolean;
    label?: string;
    className?: string;
    showAnimation?: boolean;
}

export function RequiredFieldHighlight({
    children,
    isRequired = true,
    isFilled = false,
    label,
    className = '',
    showAnimation = true,
}: RequiredFieldHighlightProps) {
    const [isAnimating, setIsAnimating] = useState(false);

    useEffect(() => {
        if (showAnimation && isRequired && !isFilled) {
            // 주기적으로 강조 애니메이션
            const interval = setInterval(() => {
                setIsAnimating(true);
                setTimeout(() => setIsAnimating(false), 1000);
            }, 5000);
            return () => clearInterval(interval);
        }
    }, [showAnimation, isRequired, isFilled]);

    const borderClass = useMemo(() => {
        if (!isRequired) return 'border-border';
        if (isFilled) return 'border-green-400 bg-green-50/50';
        return `border-purple-400 ${isAnimating ? 'ring-2 ring-purple-300 ring-opacity-50' : ''}`;
    }, [isRequired, isFilled, isAnimating]);

    return (
        <div className={`relative ${className}`}>
            {label && (
                <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-medium text-foreground">{label}</span>
                    {isRequired && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full transition-colors ${isFilled
                                ? 'bg-green-100 text-green-600'
                                : 'bg-purple-100 text-purple-600'
                            }`}>
                            {isFilled ? (
                                <span className="flex items-center gap-1">
                                    <Check className="h-3 w-3" />
                                    완료
                                </span>
                            ) : (
                                '필수'
                            )}
                        </span>
                    )}
                </div>
            )}
            <div
                className={`
                    rounded-lg border-2 transition-all duration-300
                    ${borderClass}
                    ${isAnimating ? 'shadow-lg shadow-purple-200' : ''}
                `}
            >
                {children}
            </div>
        </div>
    );
}

/**
 * AI 점수 기반 추천 배지 컴포넌트
 */

interface RecommendationBadgeProps {
    score: number; // 0-100
    label?: string;
    size?: 'sm' | 'md' | 'lg';
    showScore?: boolean;
}

export function RecommendationBadge({
    score,
    label = '추천',
    size = 'md',
    showScore = false,
}: RecommendationBadgeProps) {
    const isHighlyRecommended = score >= 80;
    const isRecommended = score >= 60;

    if (!isRecommended) return null;

    const sizeClasses = {
        sm: 'text-xs px-1.5 py-0.5 gap-0.5',
        md: 'text-sm px-2 py-1 gap-1',
        lg: 'text-base px-3 py-1.5 gap-1.5',
    };

    const iconSizes = {
        sm: 'h-3 w-3',
        md: 'h-4 w-4',
        lg: 'h-5 w-5',
    };

    return (
        <span
            className={`
                inline-flex items-center rounded-full font-medium
                ${sizeClasses[size]}
                ${isHighlyRecommended
                    ? 'bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-lg shadow-amber-200'
                    : 'bg-purple-100 text-purple-700'
                }
            `}
        >
            {isHighlyRecommended ? (
                <Star className={`${iconSizes[size]} fill-current`} />
            ) : (
                <Sparkles className={iconSizes[size]} />
            )}
            <span>{label}</span>
            {showScore && (
                <span className="opacity-75">({score}%)</span>
            )}
        </span>
    );
}

/**
 * 목적별 슬라이드 구성 추천 정보
 */
export interface SlideRecommendation {
    purposeId: string;
    recommendedSlideCount: number;
    templateId?: string;
    score: number;
    reason: string;
}

export const PURPOSE_SLIDE_RECOMMENDATIONS: Record<string, SlideRecommendation> = {
    'business-report': {
        purposeId: 'business-report',
        recommendedSlideCount: 10,
        templateId: 'professional-blue',
        score: 85,
        reason: '업무 보고에 최적화된 구성입니다',
    },
    'investment-pitch': {
        purposeId: 'investment-pitch',
        recommendedSlideCount: 12,
        templateId: 'modern-gradient',
        score: 90,
        reason: '투자 제안서에 가장 효과적인 구조입니다',
    },
    'education': {
        purposeId: 'education',
        recommendedSlideCount: 15,
        templateId: 'clean-minimal',
        score: 80,
        reason: '교육 콘텐츠에 적합한 분량입니다',
    },
    'marketing': {
        purposeId: 'marketing',
        recommendedSlideCount: 8,
        templateId: 'vibrant-creative',
        score: 88,
        reason: '마케팅 발표에 적합한 임팩트 있는 구성입니다',
    },
    'team-meeting': {
        purposeId: 'team-meeting',
        recommendedSlideCount: 6,
        templateId: 'simple-corporate',
        score: 75,
        reason: '팀 미팅에 적합한 간결한 구성입니다',
    },
    'idea-proposal': {
        purposeId: 'idea-proposal',
        recommendedSlideCount: 8,
        templateId: 'creative-modern',
        score: 82,
        reason: '아이디어 제안에 효과적인 스토리텔링 구조입니다',
    },
};

/**
 * 목적에 따른 추천 슬라이드 구성 가져오기
 */
export function getSlideRecommendation(purposeId: string): SlideRecommendation | null {
    return PURPOSE_SLIDE_RECOMMENDATIONS[purposeId] || null;
}

/**
 * 슬라이드 수 추천 컴포넌트
 */
interface SlideCountRecommendationProps {
    purposeId: string;
    currentCount?: number;
    onApply?: (count: number) => void;
}

export function SlideCountRecommendation({
    purposeId,
    currentCount,
    onApply,
}: SlideCountRecommendationProps) {
    const recommendation = useMemo(() => getSlideRecommendation(purposeId), [purposeId]);

    if (!recommendation) return null;

    const isMatchingRecommendation = currentCount === recommendation.recommendedSlideCount;

    return (
        <div className="flex items-center gap-3 p-3 bg-purple-50 rounded-lg border border-purple-200">
            <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-purple-700">
                        추천 슬라이드 수: {recommendation.recommendedSlideCount}장
                    </span>
                    <RecommendationBadge score={recommendation.score} size="sm" />
                </div>
                <p className="text-sm text-purple-600">{recommendation.reason}</p>
            </div>
            {!isMatchingRecommendation && onApply && (
                <button
                    onClick={() => onApply(recommendation.recommendedSlideCount)}
                    className="px-3 py-1.5 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition-colors"
                >
                    적용
                </button>
            )}
            {isMatchingRecommendation && (
                <span className="flex items-center gap-1 text-green-600 text-sm">
                    <Check className="h-4 w-4" />
                    적용됨
                </span>
            )}
        </div>
    );
}
