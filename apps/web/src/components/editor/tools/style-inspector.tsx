'use client';

import { useState, useMemo } from 'react';
import {
    AlertTriangle,
    CheckCircle,
    XCircle,
    RefreshCw,
    Eye,
    Palette,
    Type,
    Layout,
    ChevronDown,
    ChevronRight,
    Wand2,
} from 'lucide-react';

interface StyleInspectorProps {
    slides: SlideData[];
    onApplyFix: (slideId: string, blockId: string, fix: StyleFix) => void;
    onApplyAllFixes: (category: string) => void;
}

interface SlideData {
    id: string;
    title: string;
    blocks: BlockData[];
}

interface BlockData {
    id: string;
    type: string;
    style: any;
}

interface StyleIssue {
    id: string;
    slideId: string;
    blockId: string;
    category: 'color' | 'typography' | 'alignment' | 'spacing';
    severity: 'error' | 'warning' | 'info';
    title: string;
    description: string;
    currentValue: string;
    suggestedValue: string;
    fix: StyleFix;
}

interface StyleFix {
    property: string;
    value: any;
}

// 스타일 검사 규칙
const STYLE_RULES = {
    // 색상 대비 검사
    checkColorContrast: (textColor: string, bgColor: string): boolean => {
        // 간단한 밝기 기반 대비 검사
        const getLuminance = (hex: string) => {
            const rgb = parseInt(hex.slice(1), 16);
            const r = (rgb >> 16) & 0xff;
            const g = (rgb >> 8) & 0xff;
            const b = rgb & 0xff;
            return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        };

        if (!textColor || !bgColor) return true;
        const textLum = getLuminance(textColor);
        const bgLum = getLuminance(bgColor);
        return Math.abs(textLum - bgLum) > 0.3;
    },

    // 폰트 크기 일관성
    checkFontConsistency: (fontSize: number): boolean => {
        const validSizes = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72];
        return validSizes.includes(fontSize);
    },

    // 정렬 검사
    checkAlignment: (items: { x: number; y: number }[]): boolean => {
        if (items.length < 2) return true;
        const threshold = 5;
        // X 또는 Y 좌표가 비슷한지 확인
        const xAligned = items.every(item => Math.abs(item.x - items[0].x) < threshold);
        const yAligned = items.every(item => Math.abs(item.y - items[0].y) < threshold);
        return xAligned || yAligned;
    },
};

export function StyleInspector({
    slides,
    onApplyFix,
    onApplyAllFixes,
}: StyleInspectorProps) {
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['color', 'typography']));
    const [isScanning, setIsScanning] = useState(false);

    // 스타일 이슈 분석
    const issues = useMemo((): StyleIssue[] => {
        const detectedIssues: StyleIssue[] = [];

        slides.forEach(slide => {
            slide.blocks.forEach(block => {
                const style = block.style || {};

                // 색상 대비 검사
                if (style.color && style.backgroundColor) {
                    if (!STYLE_RULES.checkColorContrast(style.color, style.backgroundColor)) {
                        detectedIssues.push({
                            id: `${slide.id}-${block.id}-contrast`,
                            slideId: slide.id,
                            blockId: block.id,
                            category: 'color',
                            severity: 'error',
                            title: '색상 대비 부족',
                            description: '텍스트와 배경 색상의 대비가 충분하지 않습니다',
                            currentValue: `${style.color} / ${style.backgroundColor}`,
                            suggestedValue: '#000000 (검정)',
                            fix: { property: 'color', value: '#000000' },
                        });
                    }
                }

                // 폰트 크기 일관성
                if (style.fontSize && !STYLE_RULES.checkFontConsistency(style.fontSize)) {
                    const nearestSize = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48]
                        .reduce((prev, curr) =>
                            Math.abs(curr - style.fontSize) < Math.abs(prev - style.fontSize) ? curr : prev
                        );

                    detectedIssues.push({
                        id: `${slide.id}-${block.id}-fontsize`,
                        slideId: slide.id,
                        blockId: block.id,
                        category: 'typography',
                        severity: 'warning',
                        title: '비표준 폰트 크기',
                        description: '일관성을 위해 표준 크기를 권장합니다',
                        currentValue: `${style.fontSize}px`,
                        suggestedValue: `${nearestSize}px`,
                        fix: { property: 'fontSize', value: nearestSize },
                    });
                }

                // 투명도 경고
                if (style.opacity !== undefined && style.opacity < 0.5) {
                    detectedIssues.push({
                        id: `${slide.id}-${block.id}-opacity`,
                        slideId: slide.id,
                        blockId: block.id,
                        category: 'color',
                        severity: 'info',
                        title: '낮은 투명도',
                        description: '요소가 너무 투명하여 보이지 않을 수 있습니다',
                        currentValue: `${Math.round(style.opacity * 100)}%`,
                        suggestedValue: '100%',
                        fix: { property: 'opacity', value: 1 },
                    });
                }
            });
        });

        return detectedIssues;
    }, [slides]);

    // 카테고리별 이슈 그룹화
    const issuesByCategory = useMemo(() => {
        const grouped: Record<string, StyleIssue[]> = {
            color: [],
            typography: [],
            alignment: [],
            spacing: [],
        };

        issues.forEach(issue => {
            grouped[issue.category].push(issue);
        });

        return grouped;
    }, [issues]);

    // 전체 통계
    const stats = useMemo(() => ({
        total: issues.length,
        errors: issues.filter(i => i.severity === 'error').length,
        warnings: issues.filter(i => i.severity === 'warning').length,
        info: issues.filter(i => i.severity === 'info').length,
    }), [issues]);

    const toggleCategory = (category: string) => {
        setExpandedCategories(prev => {
            const next = new Set(prev);
            if (next.has(category)) {
                next.delete(category);
            } else {
                next.add(category);
            }
            return next;
        });
    };

    const handleScan = async () => {
        setIsScanning(true);
        // 스캔 애니메이션
        await new Promise(resolve => setTimeout(resolve, 1000));
        setIsScanning(false);
    };

    const getSeverityIcon = (severity: StyleIssue['severity']) => {
        switch (severity) {
            case 'error': return <XCircle className="h-3.5 w-3.5 text-red-500" />;
            case 'warning': return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
            case 'info': return <Eye className="h-3.5 w-3.5 text-blue-500" />;
        }
    };

    const getCategoryIcon = (category: string) => {
        switch (category) {
            case 'color': return Palette;
            case 'typography': return Type;
            case 'alignment': return Layout;
            default: return Eye;
        }
    };

    const getCategoryName = (category: string) => {
        switch (category) {
            case 'color': return '색상';
            case 'typography': return '타이포그래피';
            case 'alignment': return '정렬';
            case 'spacing': return '간격';
            default: return category;
        }
    };

    return (
        <div className="h-full flex flex-col bg-card">
            {/* 헤더 */}
            <div className="px-3 py-2 border-b">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <Wand2 className="h-4 w-4 text-purple-600" />
                        <span className="text-sm font-medium text-foreground">스타일 검사</span>
                    </div>
                    <button
                        onClick={handleScan}
                        disabled={isScanning}
                        className={`p-1.5 rounded hover:bg-secondary ${isScanning ? 'animate-spin' : ''}`}
                    >
                        <RefreshCw className="h-4 w-4 text-muted-foreground" />
                    </button>
                </div>

                {/* 통계 */}
                <div className="flex gap-2 text-xs">
                    <div className={`flex items-center gap-1 px-2 py-1 rounded-full ${stats.errors > 0 ? 'bg-red-100 text-red-700' : 'bg-secondary text-muted-foreground'
                        }`}>
                        <XCircle className="h-3 w-3" />
                        {stats.errors} 오류
                    </div>
                    <div className={`flex items-center gap-1 px-2 py-1 rounded-full ${stats.warnings > 0 ? 'bg-amber-100 text-amber-700' : 'bg-secondary text-muted-foreground'
                        }`}>
                        <AlertTriangle className="h-3 w-3" />
                        {stats.warnings} 경고
                    </div>
                    <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-secondary text-muted-foreground">
                        <Eye className="h-3 w-3" />
                        {stats.info} 정보
                    </div>
                </div>
            </div>

            {/* 이슈 목록 */}
            <div className="flex-1 overflow-y-auto">
                {stats.total === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center p-4">
                        <CheckCircle className="h-10 w-10 text-green-500 mb-2" />
                        <span className="text-sm font-medium text-foreground">
                            스타일 이슈 없음
                        </span>
                        <span className="text-xs text-muted-foreground">
                            모든 스타일이 일관성 있습니다
                        </span>
                    </div>
                ) : (
                    <div className="py-1">
                        {Object.entries(issuesByCategory).map(([category, categoryIssues]) => {
                            if (categoryIssues.length === 0) return null;
                            const CategoryIcon = getCategoryIcon(category);
                            const isExpanded = expandedCategories.has(category);

                            return (
                                <div key={category} className="border-b last:border-b-0">
                                    {/* 카테고리 헤더 */}
                                    <button
                                        onClick={() => toggleCategory(category)}
                                        className="w-full flex items-center justify-between px-3 py-2 hover:bg-secondary"
                                    >
                                        <div className="flex items-center gap-2">
                                            <CategoryIcon className="h-4 w-4 text-muted-foreground" />
                                            <span className="text-sm font-medium text-foreground">
                                                {getCategoryName(category)}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                                ({categoryIssues.length})
                                            </span>
                                        </div>
                                        {isExpanded ? (
                                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                        ) : (
                                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                        )}
                                    </button>

                                    {/* 이슈 목록 */}
                                    {isExpanded && (
                                        <div className="px-2 pb-2">
                                            {categoryIssues.map(issue => (
                                                <div
                                                    key={issue.id}
                                                    className="flex items-start gap-2 p-2 rounded-lg hover:bg-secondary"
                                                >
                                                    {getSeverityIcon(issue.severity)}
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-xs font-medium text-foreground">
                                                            {issue.title}
                                                        </div>
                                                        <div className="text-[10px] text-muted-foreground">
                                                            {issue.description}
                                                        </div>
                                                        <div className="flex items-center gap-2 mt-1 text-[10px]">
                                                            <span className="text-red-500 line-through">
                                                                {issue.currentValue}
                                                            </span>
                                                            <span>→</span>
                                                            <span className="text-green-600">
                                                                {issue.suggestedValue}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={() => onApplyFix(issue.slideId, issue.blockId, issue.fix)}
                                                        className="px-2 py-1 text-[10px] bg-purple-100 text-purple-700 rounded hover:bg-purple-200"
                                                    >
                                                        수정
                                                    </button>
                                                </div>
                                            ))}

                                            {/* 일괄 수정 버튼 */}
                                            <button
                                                onClick={() => onApplyAllFixes(category)}
                                                className="w-full mt-1 py-1.5 text-xs text-purple-600 hover:bg-purple-50 rounded"
                                            >
                                                전체 수정 ({categoryIssues.length}개)
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

export default StyleInspector;
