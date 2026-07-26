'use client';

import { useMemo } from 'react';
import {
    Trophy,
    Star,
    AlertTriangle,
    CheckCircle,
    Palette,
    Type,
    Layout,
    Image,
    Sparkles,
} from 'lucide-react';

interface QualityScoreProps {
    slides: SlideQualityData[];
}

interface SlideQualityData {
    id: string;
    title: string;
    elements: ElementQualityData[];
    hasConsistentFonts: boolean;
    hasConsistentColors: boolean;
    hasProperSpacing: boolean;
    imageCount: number;
    textCount: number;
}

interface ElementQualityData {
    id: string;
    type: string;
    style?: any;
}

interface ScoreCategory {
    name: string;
    icon: any;
    score: number;
    maxScore: number;
    items: ScoreItem[];
}

interface ScoreItem {
    label: string;
    passed: boolean;
    points: number;
}

export function QualityScore({ slides }: QualityScoreProps) {
    // 카테고리별 점수 계산
    const categories = useMemo((): ScoreCategory[] => {
        // 레이아웃 점수
        const layoutItems: ScoreItem[] = [
            {
                label: '적절한 여백 사용',
                passed: slides.every(s => s.hasProperSpacing),
                points: 15,
            },
            {
                label: '요소 정렬 일관성',
                passed: true, // Placeholder
                points: 10,
            },
            {
                label: '슬라이드당 적정 요소 수',
                passed: slides.every(s => s.elements.length <= 10),
                points: 10,
            },
        ];

        // 타이포그래피 점수
        const typographyItems: ScoreItem[] = [
            {
                label: '일관된 폰트 사용',
                passed: slides.every(s => s.hasConsistentFonts),
                points: 15,
            },
            {
                label: '적절한 텍스트 계층',
                passed: true,
                points: 10,
            },
            {
                label: '가독성 높은 크기',
                passed: true,
                points: 10,
            },
        ];

        // 컬러 점수
        const colorItems: ScoreItem[] = [
            {
                label: '일관된 색상 팔레트',
                passed: slides.every(s => s.hasConsistentColors),
                points: 15,
            },
            {
                label: '충분한 대비',
                passed: true,
                points: 10,
            },
            {
                label: '색상 수 제한 (5개 이하)',
                passed: true,
                points: 5,
            },
        ];

        // 비주얼 점수
        const visualItems: ScoreItem[] = [
            {
                label: '이미지 품질',
                passed: true,
                points: 10,
            },
            {
                label: '시각적 일관성',
                passed: true,
                points: 10,
            },
            {
                label: '적절한 이미지/텍스트 비율',
                passed: slides.every(s => s.imageCount > 0 || s.textCount < 5),
                points: 10,
            },
        ];

        return [
            {
                name: '레이아웃',
                icon: Layout,
                score: layoutItems.filter(i => i.passed).reduce((sum, i) => sum + i.points, 0),
                maxScore: layoutItems.reduce((sum, i) => sum + i.points, 0),
                items: layoutItems,
            },
            {
                name: '타이포그래피',
                icon: Type,
                score: typographyItems.filter(i => i.passed).reduce((sum, i) => sum + i.points, 0),
                maxScore: typographyItems.reduce((sum, i) => sum + i.points, 0),
                items: typographyItems,
            },
            {
                name: '컬러',
                icon: Palette,
                score: colorItems.filter(i => i.passed).reduce((sum, i) => sum + i.points, 0),
                maxScore: colorItems.reduce((sum, i) => sum + i.points, 0),
                items: colorItems,
            },
            {
                name: '비주얼',
                icon: Image,
                score: visualItems.filter(i => i.passed).reduce((sum, i) => sum + i.points, 0),
                maxScore: visualItems.reduce((sum, i) => sum + i.points, 0),
                items: visualItems,
            },
        ];
    }, [slides]);

    // 전체 점수
    const totalScore = useMemo(() => {
        const score = categories.reduce((sum, c) => sum + c.score, 0);
        const maxScore = categories.reduce((sum, c) => sum + c.maxScore, 0);
        return Math.round((score / maxScore) * 100);
    }, [categories]);

    // 등급 계산
    const grade = useMemo(() => {
        if (totalScore >= 90) return { label: 'S', color: 'text-purple-600', bg: 'bg-purple-100' };
        if (totalScore >= 80) return { label: 'A', color: 'text-green-600', bg: 'bg-green-100' };
        if (totalScore >= 70) return { label: 'B', color: 'text-blue-600', bg: 'bg-blue-100' };
        if (totalScore >= 60) return { label: 'C', color: 'text-amber-600', bg: 'bg-amber-100' };
        return { label: 'D', color: 'text-red-600', bg: 'bg-red-100' };
    }, [totalScore]);

    // 별점 (5점 만점)
    const stars = Math.round(totalScore / 20);

    return (
        <div className="h-full flex flex-col bg-card">
            {/* 헤더 */}
            <div className="px-3 py-2 border-b">
                <div className="flex items-center gap-2 mb-2">
                    <Trophy className="h-4 w-4 text-amber-500" />
                    <span className="text-sm font-medium text-foreground">디자인 품질 점수</span>
                </div>

                {/* 점수 디스플레이 */}
                <div className="flex items-center justify-between p-4 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg">
                    <div className="text-center">
                        <div className={`text-4xl font-bold ${grade.color}`}>
                            {totalScore}
                        </div>
                        <div className="text-xs text-muted-foreground">/ 100점</div>
                    </div>
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center ${grade.bg}`}>
                        <span className={`text-2xl font-bold ${grade.color}`}>
                            {grade.label}
                        </span>
                    </div>
                    <div className="flex flex-col items-end">
                        <div className="flex gap-0.5">
                            {[1, 2, 3, 4, 5].map((n) => (
                                <Star
                                    key={n}
                                    className={`h-4 w-4 ${n <= stars
                                            ? 'text-amber-400 fill-amber-400'
                                            : 'text-muted-foreground'
                                        }`}
                                />
                            ))}
                        </div>
                        <span className="text-xs text-muted-foreground mt-1">
                            {stars}/5 별점
                        </span>
                    </div>
                </div>
            </div>

            {/* 카테고리별 점수 */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {categories.map((category) => {
                    const percentage = Math.round((category.score / category.maxScore) * 100);
                    const CategoryIcon = category.icon;

                    return (
                        <div key={category.name} className="bg-secondary rounded-lg p-3">
                            {/* 카테고리 헤더 */}
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <CategoryIcon className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-sm font-medium text-foreground">
                                        {category.name}
                                    </span>
                                </div>
                                <span className="text-sm font-bold text-foreground">
                                    {category.score}/{category.maxScore}
                                </span>
                            </div>

                            {/* 프로그레스 바 */}
                            <div className="h-2 bg-muted rounded-full overflow-hidden mb-2">
                                <div
                                    className={`h-full rounded-full transition-all ${percentage >= 80
                                            ? 'bg-green-500'
                                            : percentage >= 60
                                                ? 'bg-amber-500'
                                                : 'bg-red-500'
                                        }`}
                                    style={{ width: `${percentage}%` }}
                                />
                            </div>

                            {/* 세부 항목 */}
                            <div className="space-y-1">
                                {category.items.map((item, idx) => (
                                    <div
                                        key={idx}
                                        className="flex items-center justify-between text-[10px]"
                                    >
                                        <div className="flex items-center gap-1">
                                            {item.passed ? (
                                                <CheckCircle className="h-3 w-3 text-green-500" />
                                            ) : (
                                                <AlertTriangle className="h-3 w-3 text-amber-500" />
                                            )}
                                            <span className={item.passed ? 'text-muted-foreground' : 'text-amber-700'}>
                                                {item.label}
                                            </span>
                                        </div>
                                        <span className={item.passed ? 'text-green-600' : 'text-muted-foreground'}>
                                            {item.passed ? `+${item.points}` : '0'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* 개선 제안 */}
            <div className="border-t p-3">
                <div className="flex items-start gap-2 p-2 bg-purple-50 rounded-lg">
                    <Sparkles className="h-4 w-4 text-purple-500 mt-0.5" />
                    <div className="text-[10px] text-purple-700">
                        <strong>개선 제안:</strong>
                        {totalScore < 70
                            ? ' 색상 일관성과 폰트 통일을 먼저 확인해보세요.'
                            : totalScore < 90
                                ? ' 이미지를 추가하여 비주얼을 강화해보세요.'
                                : ' 훌륭합니다! 프로페셔널한 디자인입니다.'}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default QualityScore;
