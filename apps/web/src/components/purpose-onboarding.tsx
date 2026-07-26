'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
    Briefcase,
    TrendingUp,
    GraduationCap,
    Megaphone,
    Users,
    Lightbulb,
    ArrowRight,
    Sparkles,
    Star,
} from 'lucide-react';
import { RecommendationBadge, getSlideRecommendation } from './required-field-highlight';

export interface PurposeOption {
    id: string;
    title: string;
    description: string;
    icon: React.ElementType;
    color: string;
    examples: string[];
    recommendedSlideCount?: number;
    recommendationScore?: number;
}

const PURPOSE_OPTIONS: PurposeOption[] = [
    {
        id: 'business-report',
        title: '업무 보고',
        description: '주간/월간 보고, 프로젝트 진행 상황',
        icon: Briefcase,
        color: 'from-blue-500 to-blue-600',
        examples: ['실적 분석', '프로젝트 진행률', 'KPI 리포트'],
        recommendedSlideCount: 10,
        recommendationScore: 85,
    },
    {
        id: 'investment-pitch',
        title: '투자 제안',
        description: '스타트업 피칭, 사업 계획서',
        icon: TrendingUp,
        color: 'from-green-500 to-green-600',
        examples: ['IR 발표', '사업 계획', '투자 유치'],
        recommendedSlideCount: 12,
        recommendationScore: 90,
    },
    {
        id: 'education',
        title: '교육 강의',
        description: '수업 자료, 교육 콘텐츠',
        icon: GraduationCap,
        color: 'from-purple-500 to-purple-600',
        examples: ['강의 자료', '튜토리얼', '워크샵'],
        recommendedSlideCount: 15,
        recommendationScore: 80,
    },
    {
        id: 'marketing',
        title: '마케팅',
        description: '제품 소개, 캠페인 제안',
        icon: Megaphone,
        color: 'from-pink-500 to-pink-600',
        examples: ['제품 런칭', '캠페인 기획', '브랜드 소개'],
        recommendedSlideCount: 8,
        recommendationScore: 88,
    },
    {
        id: 'team-meeting',
        title: '팀 미팅',
        description: '팀 회의, 내부 공유',
        icon: Users,
        color: 'from-orange-500 to-orange-600',
        examples: ['스프린트 리뷰', '전략 회의', '팀 공유'],
        recommendedSlideCount: 6,
        recommendationScore: 75,
    },
    {
        id: 'idea-proposal',
        title: '아이디어 제안',
        description: '신규 사업, 기획 제안',
        icon: Lightbulb,
        color: 'from-yellow-500 to-yellow-600',
        examples: ['신규 기능', '프로세스 개선', '혁신 제안'],
        recommendedSlideCount: 8,
        recommendationScore: 82,
    },
];

// 가장 높은 추천 점수를 가진 목적 찾기
const TOP_RECOMMENDED_ID = PURPOSE_OPTIONS.reduce((prev, curr) =>
    (curr.recommendationScore || 0) > (prev.recommendationScore || 0) ? curr : prev
).id;

interface PurposeOnboardingProps {
    onComplete: (purpose: PurposeOption, recommendation: { slideCount: number; templateId?: string }) => void;
    onSkip?: () => void;
}

export function PurposeOnboarding({ onComplete, onSkip }: PurposeOnboardingProps) {
    const [selectedPurpose, setSelectedPurpose] = useState<string | null>(null);
    const [isAnimating, setIsAnimating] = useState(false);

    const selectedPurposeData = useMemo(() => {
        if (!selectedPurpose) return null;
        return PURPOSE_OPTIONS.find((p) => p.id === selectedPurpose) || null;
    }, [selectedPurpose]);

    const recommendation = useMemo(() => {
        if (!selectedPurpose) return null;
        return getSlideRecommendation(selectedPurpose);
    }, [selectedPurpose]);

    const handleSelect = (purposeId: string) => {
        setSelectedPurpose(purposeId);
    };

    const handleContinue = () => {
        if (!selectedPurpose || !selectedPurposeData) return;
        setIsAnimating(true);
        setTimeout(() => {
            onComplete(selectedPurposeData, {
                slideCount: selectedPurposeData.recommendedSlideCount || 10,
                templateId: recommendation?.templateId,
            });
        }, 300);
    };

    return (
        <div className={`transition-opacity duration-300 ${isAnimating ? 'opacity-0' : 'opacity-100'}`}>
            {/* Header */}
            <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl mb-4">
                    <Sparkles className="h-8 w-8 text-white" />
                </div>
                <h2 className="text-2xl font-bold text-foreground mb-2">
                    발표 목적을 선택해주세요
                </h2>
                <p className="text-muted-foreground">
                    목적에 맞는 최적화된 슬라이드를 생성해 드립니다
                </p>
            </div>

            {/* Purpose Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                {PURPOSE_OPTIONS.map((purpose) => {
                    const Icon = purpose.icon;
                    const isSelected = selectedPurpose === purpose.id;
                    const isTopRecommended = purpose.id === TOP_RECOMMENDED_ID;
                    const score = purpose.recommendationScore || 0;

                    return (
                        <button
                            key={purpose.id}
                            onClick={() => handleSelect(purpose.id)}
                            className={`
                                relative p-4 rounded-xl border-2 transition-all duration-200 text-left
                                ${isSelected
                                    ? 'border-purple-500 bg-purple-50 shadow-lg shadow-purple-500/20'
                                    : 'border-border bg-card hover:border-purple-300 hover:shadow-md'
                                }
                            `}
                        >
                            {/* Top Recommendation Badge */}
                            {isTopRecommended && (
                                <div className="absolute -top-2 -left-2">
                                    <RecommendationBadge score={score} label="추천" size="sm" />
                                </div>
                            )}

                            {/* Selection indicator */}
                            {isSelected && (
                                <div className="absolute -top-2 -right-2 w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center">
                                    <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                                        <path
                                            fillRule="evenodd"
                                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                            clipRule="evenodd"
                                        />
                                    </svg>
                                </div>
                            )}

                            {/* Icon */}
                            <div className={`
                                w-10 h-10 rounded-lg bg-gradient-to-br ${purpose.color} 
                                flex items-center justify-center mb-3
                            `}>
                                <Icon className="h-5 w-5 text-white" />
                            </div>

                            {/* Content */}
                            <h3 className="font-semibold text-foreground mb-1">
                                {purpose.title}
                            </h3>
                            <p className="text-sm text-muted-foreground mb-2">
                                {purpose.description}
                            </p>

                            {/* Example tags */}
                            <div className="flex flex-wrap gap-1">
                                {purpose.examples.slice(0, 2).map((example) => (
                                    <span
                                        key={example}
                                        className="text-xs px-2 py-0.5 bg-secondary rounded-full text-muted-foreground"
                                    >
                                        {example}
                                    </span>
                                ))}
                            </div>

                            {/* Slide count hint */}
                            {purpose.recommendedSlideCount && (
                                <div className="mt-2 text-xs text-muted-foreground">
                                    권장 {purpose.recommendedSlideCount}장
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Selected Purpose Recommendation */}
            {selectedPurposeData && recommendation && (
                <div className="mb-6 p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl border border-purple-200">
                    <div className="flex items-center gap-2 mb-2">
                        <Star className="h-5 w-5 text-amber-500 fill-amber-500" />
                        <span className="font-medium text-purple-700">선택한 목적에 최적화된 설정</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                            <span className="text-muted-foreground">추천 슬라이드 수:</span>
                            <span className="ml-2 font-semibold text-purple-700">
                                {recommendation.recommendedSlideCount}장
                            </span>
                        </div>
                        <div>
                            <span className="text-muted-foreground">AI 효과 점수:</span>
                            <span className="ml-2 font-semibold text-green-600">
                                {recommendation.score}%
                            </span>
                        </div>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{recommendation.reason}</p>
                </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between">
                <Button
                    variant="ghost"
                    onClick={onSkip}
                    className="text-muted-foreground"
                >
                    건너뛰기
                </Button>
                <Button
                    onClick={handleContinue}
                    disabled={!selectedPurpose}
                    className="bg-purple-600 hover:bg-purple-700"
                >
                    {selectedPurposeData
                        ? `${selectedPurposeData.recommendedSlideCount}장으로 시작`
                        : '다음'
                    }
                    <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
            </div>
        </div>
    );
}

export { PURPOSE_OPTIONS };

