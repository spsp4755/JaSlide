'use client';

import { useState, useMemo } from 'react';
import {
    Accessibility,
    CheckCircle2,
    XCircle,
    AlertTriangle,
    Eye,
    Contrast,
    Type,
    Ruler,
    Image,
    RefreshCw,
    ChevronDown,
    ChevronRight,
    Lightbulb,
} from 'lucide-react';

interface AccessibilityCheckerProps {
    slides: SlideCheckData[];
    onFixIssue: (slideId: string, issueId: string, fix: AccessibilityFix) => void;
}

interface SlideCheckData {
    id: string;
    title: string;
    elements: ElementCheckData[];
}

interface ElementCheckData {
    id: string;
    type: string;
    textContent?: string;
    style?: any;
    imageAlt?: string;
    imageSrc?: string;
}

interface AccessibilityIssue {
    id: string;
    slideId: string;
    elementId: string;
    category: 'contrast' | 'text' | 'image' | 'structure';
    level: 'A' | 'AA' | 'AAA';
    severity: 'error' | 'warning';
    title: string;
    description: string;
    wcag: string;
    fix?: AccessibilityFix;
}

interface AccessibilityFix {
    type: string;
    value: any;
}

// WCAG 색상 대비율 계산
function getLuminance(hex: string): number {
    const rgb = parseInt(hex.slice(1), 16);
    const r = ((rgb >> 16) & 0xff) / 255;
    const g = ((rgb >> 8) & 0xff) / 255;
    const b = (rgb & 0xff) / 255;

    const transform = (c: number) =>
        c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

    return 0.2126 * transform(r) + 0.7152 * transform(g) + 0.0722 * transform(b);
}

function getContrastRatio(color1: string, color2: string): number {
    const lum1 = getLuminance(color1);
    const lum2 = getLuminance(color2);
    const lighter = Math.max(lum1, lum2);
    const darker = Math.min(lum1, lum2);
    return (lighter + 0.05) / (darker + 0.05);
}

// WCAG 기준
const WCAG_CONTRAST = {
    AA_NORMAL: 4.5,
    AA_LARGE: 3.0,
    AAA_NORMAL: 7.0,
    AAA_LARGE: 4.5,
};

export function AccessibilityChecker({
    slides,
    onFixIssue,
}: AccessibilityCheckerProps) {
    const [isScanning, setIsScanning] = useState(false);
    const [expandedSlides, setExpandedSlides] = useState<Set<string>>(new Set());
    const [filterLevel, setFilterLevel] = useState<'all' | 'A' | 'AA' | 'AAA'>('all');

    // 접근성 이슈 분석
    const issues = useMemo((): AccessibilityIssue[] => {
        const detected: AccessibilityIssue[] = [];

        slides.forEach(slide => {
            slide.elements.forEach(element => {
                // 색상 대비 검사
                if (element.style?.color && element.style?.backgroundColor) {
                    const contrast = getContrastRatio(
                        element.style.color,
                        element.style.backgroundColor
                    );

                    if (contrast < WCAG_CONTRAST.AA_NORMAL) {
                        detected.push({
                            id: `${slide.id}-${element.id}-contrast`,
                            slideId: slide.id,
                            elementId: element.id,
                            category: 'contrast',
                            level: 'AA',
                            severity: contrast < 3 ? 'error' : 'warning',
                            title: '색상 대비 부족',
                            description: `현재 대비율: ${contrast.toFixed(2)}:1 (최소 4.5:1 필요)`,
                            wcag: '1.4.3 Contrast (Minimum)',
                            fix: {
                                type: 'color',
                                value: '#000000',
                            },
                        });
                    }
                }

                // 텍스트 크기 검사
                if (element.type === 'TEXT' && element.style?.fontSize) {
                    if (element.style.fontSize < 12) {
                        detected.push({
                            id: `${slide.id}-${element.id}-fontsize`,
                            slideId: slide.id,
                            elementId: element.id,
                            category: 'text',
                            level: 'AA',
                            severity: 'warning',
                            title: '텍스트 크기 작음',
                            description: `현재: ${element.style.fontSize}px (최소 12px 권장)`,
                            wcag: '1.4.4 Resize Text',
                            fix: {
                                type: 'fontSize',
                                value: 14,
                            },
                        });
                    }
                }

                // 이미지 대체 텍스트 검사
                if (element.type === 'IMAGE') {
                    if (!element.imageAlt || element.imageAlt.trim() === '') {
                        detected.push({
                            id: `${slide.id}-${element.id}-alt`,
                            slideId: slide.id,
                            elementId: element.id,
                            category: 'image',
                            level: 'A',
                            severity: 'error',
                            title: '이미지 대체 텍스트 없음',
                            description: '스크린 리더 사용자를 위해 대체 텍스트가 필요합니다',
                            wcag: '1.1.1 Non-text Content',
                        });
                    }
                }

                // 링크 텍스트 검사
                if (element.textContent?.includes('here') || element.textContent?.includes('여기')) {
                    detected.push({
                        id: `${slide.id}-${element.id}-linktext`,
                        slideId: slide.id,
                        elementId: element.id,
                        category: 'text',
                        level: 'A',
                        severity: 'warning',
                        title: '모호한 링크 텍스트',
                        description: '"여기" 대신 구체적인 설명을 사용하세요',
                        wcag: '2.4.4 Link Purpose',
                    });
                }
            });
        });

        return detected;
    }, [slides]);

    // 필터링된 이슈
    const filteredIssues = useMemo(() => {
        if (filterLevel === 'all') return issues;
        return issues.filter(issue => issue.level === filterLevel);
    }, [issues, filterLevel]);

    // 슬라이드별 이슈 그룹화
    const issuesBySlide = useMemo(() => {
        const grouped: Record<string, AccessibilityIssue[]> = {};
        filteredIssues.forEach(issue => {
            if (!grouped[issue.slideId]) grouped[issue.slideId] = [];
            grouped[issue.slideId].push(issue);
        });
        return grouped;
    }, [filteredIssues]);

    // 전체 점수 계산
    const score = useMemo(() => {
        const totalElements = slides.reduce((sum, s) => sum + s.elements.length, 0);
        const errorCount = issues.filter(i => i.severity === 'error').length;
        const warningCount = issues.filter(i => i.severity === 'warning').length;
        const deduction = errorCount * 10 + warningCount * 3;
        return Math.max(0, Math.min(100, 100 - deduction));
    }, [slides, issues]);

    const getScoreColor = () => {
        if (score >= 90) return 'text-green-600';
        if (score >= 70) return 'text-amber-600';
        return 'text-red-600';
    };

    const getScoreBg = () => {
        if (score >= 90) return 'bg-green-100';
        if (score >= 70) return 'bg-amber-100';
        return 'bg-red-100';
    };

    const toggleSlide = (slideId: string) => {
        setExpandedSlides(prev => {
            const next = new Set(prev);
            if (next.has(slideId)) {
                next.delete(slideId);
            } else {
                next.add(slideId);
            }
            return next;
        });
    };

    const getCategoryIcon = (category: AccessibilityIssue['category']) => {
        switch (category) {
            case 'contrast': return Contrast;
            case 'text': return Type;
            case 'image': return Image;
            case 'structure': return Ruler;
            default: return Eye;
        }
    };

    const handleScan = async () => {
        setIsScanning(true);
        await new Promise(resolve => setTimeout(resolve, 1000));
        setIsScanning(false);
    };

    return (
        <div className="h-full flex flex-col bg-card">
            {/* 헤더 */}
            <div className="px-3 py-2 border-b">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <Accessibility className="h-4 w-4 text-blue-600" />
                        <span className="text-sm font-medium text-foreground">접근성 검사</span>
                    </div>
                    <button
                        onClick={handleScan}
                        disabled={isScanning}
                        className={`p-1.5 rounded hover:bg-secondary ${isScanning ? 'animate-spin' : ''}`}
                    >
                        <RefreshCw className="h-4 w-4 text-muted-foreground" />
                    </button>
                </div>

                {/* 점수 */}
                <div className={`flex items-center justify-center p-3 rounded-lg ${getScoreBg()}`}>
                    <div className="text-center">
                        <div className={`text-3xl font-bold ${getScoreColor()}`}>
                            {score}
                        </div>
                        <div className="text-xs text-muted-foreground">접근성 점수</div>
                    </div>
                </div>
            </div>

            {/* 필터 */}
            <div className="flex gap-1 px-3 py-2 border-b">
                {(['all', 'A', 'AA', 'AAA'] as const).map((level) => (
                    <button
                        key={level}
                        onClick={() => setFilterLevel(level)}
                        className={`px-2 py-1 text-xs rounded transition-colors ${filterLevel === level
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-secondary text-muted-foreground hover:bg-muted'
                            }`}
                    >
                        {level === 'all' ? '전체' : `Level ${level}`}
                    </button>
                ))}
            </div>

            {/* 이슈 목록 */}
            <div className="flex-1 overflow-y-auto">
                {filteredIssues.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full p-4 text-center">
                        <CheckCircle2 className="h-10 w-10 text-green-500 mb-2" />
                        <span className="text-sm font-medium text-foreground">
                            접근성 이슈 없음
                        </span>
                        <span className="text-xs text-muted-foreground">
                            WCAG 가이드라인을 준수합니다
                        </span>
                    </div>
                ) : (
                    <div className="py-1">
                        {Object.entries(issuesBySlide).map(([slideId, slideIssues]) => {
                            const slide = slides.find(s => s.id === slideId);
                            const isExpanded = expandedSlides.has(slideId);

                            return (
                                <div key={slideId} className="border-b last:border-b-0">
                                    <button
                                        onClick={() => toggleSlide(slideId)}
                                        className="w-full flex items-center justify-between px-3 py-2 hover:bg-secondary"
                                    >
                                        <div className="flex items-center gap-2">
                                            {isExpanded ? (
                                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                            ) : (
                                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                            )}
                                            <span className="text-sm text-foreground">
                                                {slide?.title || `슬라이드 ${slideId}`}
                                            </span>
                                            <span className="text-xs text-red-500">
                                                ({slideIssues.length})
                                            </span>
                                        </div>
                                    </button>

                                    {isExpanded && (
                                        <div className="px-2 pb-2">
                                            {slideIssues.map(issue => {
                                                const CategoryIcon = getCategoryIcon(issue.category);
                                                return (
                                                    <div
                                                        key={issue.id}
                                                        className="flex items-start gap-2 p-2 rounded-lg hover:bg-secondary"
                                                    >
                                                        {issue.severity === 'error' ? (
                                                            <XCircle className="h-4 w-4 text-red-500 mt-0.5" />
                                                        ) : (
                                                            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5" />
                                                        )}
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-xs font-medium text-foreground">
                                                                    {issue.title}
                                                                </span>
                                                                <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">
                                                                    {issue.level}
                                                                </span>
                                                            </div>
                                                            <div className="text-[10px] text-muted-foreground">
                                                                {issue.description}
                                                            </div>
                                                            <div className="text-[10px] text-muted-foreground mt-0.5">
                                                                WCAG: {issue.wcag}
                                                            </div>
                                                        </div>
                                                        {issue.fix && (
                                                            <button
                                                                onClick={() => onFixIssue(issue.slideId, issue.id, issue.fix!)}
                                                                className="px-2 py-1 text-[10px] bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                                                            >
                                                                수정
                                                            </button>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* 팁 */}
            <div className="border-t p-2">
                <div className="flex items-start gap-2 p-2 bg-blue-50 rounded-lg">
                    <Lightbulb className="h-4 w-4 text-blue-500 mt-0.5" />
                    <div className="text-[10px] text-blue-700">
                        <strong>팁:</strong> 대비율 4.5:1 이상, 12px 이상 텍스트, 이미지 대체 텍스트를 확인하세요.
                    </div>
                </div>
            </div>
        </div>
    );
}

export default AccessibilityChecker;
