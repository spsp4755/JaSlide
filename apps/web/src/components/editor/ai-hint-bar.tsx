'use client';

import { useState, useEffect } from 'react';
import {
    Sparkles,
    Wand2,
    FileText,
    Palette,
    Image as ImageIcon,
    CheckCircle,
    ChevronUp,
    ChevronDown,
    X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AiHint {
    id: string;
    type: 'text' | 'design' | 'image' | 'consistency';
    title: string;
    description: string;
    action: string;
    priority: 'high' | 'medium' | 'low';
}

interface AiHintBarProps {
    slideId?: string;
    slideType?: string;
    onApplyHint?: (hint: AiHint) => void;
    onDismissHint?: (hintId: string) => void;
}

const HINT_ICONS = {
    text: FileText,
    design: Palette,
    image: ImageIcon,
    consistency: CheckCircle,
};

export function AiHintBar({ slideId, slideType, onApplyHint, onDismissHint }: AiHintBarProps) {
    const [hints, setHints] = useState<AiHint[]>([]);
    const [isExpanded, setIsExpanded] = useState(true);
    const [currentHintIndex, setCurrentHintIndex] = useState(0);

    // Generate contextual hints based on slide
    useEffect(() => {
        if (!slideId) {
            setHints([]);
            return;
        }

        // Generate hints based on slide type
        const generatedHints: AiHint[] = [];

        switch (slideType) {
            case 'TITLE':
                generatedHints.push({
                    id: '1',
                    type: 'text',
                    title: '제목 개선',
                    description: '더 인상적인 제목으로 청중의 관심을 끌어보세요',
                    action: '제목 개선하기',
                    priority: 'high',
                });
                generatedHints.push({
                    id: '2',
                    type: 'image',
                    title: '배경 이미지 추가',
                    description: '주제에 맞는 배경 이미지를 추가해보세요',
                    action: '이미지 찾기',
                    priority: 'medium',
                });
                break;
            case 'CONTENT':
            case 'BULLET_LIST':
                generatedHints.push({
                    id: '3',
                    type: 'text',
                    title: '문장 간결화',
                    description: '핵심 내용만 남기고 간결하게 정리해보세요',
                    action: '간결하게 수정',
                    priority: 'high',
                });
                generatedHints.push({
                    id: '4',
                    type: 'design',
                    title: '레이아웃 최적화',
                    description: '내용에 맞는 더 나은 레이아웃을 제안합니다',
                    action: '레이아웃 변경',
                    priority: 'medium',
                });
                break;
            case 'CHART':
                generatedHints.push({
                    id: '5',
                    type: 'design',
                    title: '차트 스타일 개선',
                    description: '데이터를 더 명확하게 보여주는 차트 스타일을 적용해보세요',
                    action: '스타일 변경',
                    priority: 'high',
                });
                break;
            default:
                generatedHints.push({
                    id: '6',
                    type: 'consistency',
                    title: '스타일 일관성 검사',
                    description: '다른 슬라이드와 일관된 스타일을 유지하세요',
                    action: '일관성 검사',
                    priority: 'low',
                });
        }

        setHints(generatedHints);
        setCurrentHintIndex(0);
    }, [slideId, slideType]);

    const handleApplyHint = (hint: AiHint) => {
        onApplyHint?.(hint);
    };

    const handleDismissHint = (hintId: string) => {
        setHints((prev) => prev.filter((h) => h.id !== hintId));
        onDismissHint?.(hintId);
    };

    const handleNextHint = () => {
        setCurrentHintIndex((prev) => (prev + 1) % hints.length);
    };

    const handlePrevHint = () => {
        setCurrentHintIndex((prev) => (prev - 1 + hints.length) % hints.length);
    };

    if (!hints.length) {
        return null;
    }

    const currentHint = hints[currentHintIndex];
    const HintIcon = HINT_ICONS[currentHint.type];

    return (
        <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-r from-purple-50 to-blue-50 border-t border-purple-200 shadow-lg z-40">
            <div className="px-4 py-2">
                {/* Toggle bar */}
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="w-full flex items-center justify-center gap-2 text-xs text-purple-600 hover:text-purple-800 transition-colors"
                >
                    <Sparkles className="h-3 w-3" />
                    <span>AI 편집 보조</span>
                    {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
                </button>

                {/* Expanded content */}
                {isExpanded && (
                    <div className="mt-2 flex items-center gap-4">
                        {/* Navigation arrows */}
                        {hints.length > 1 && (
                            <button
                                onClick={handlePrevHint}
                                className="p-1 hover:bg-purple-100 rounded transition-colors"
                            >
                                <ChevronUp className="h-4 w-4 text-purple-600 rotate-[-90deg]" />
                            </button>
                        )}

                        {/* Hint content */}
                        <div className="flex-1 flex items-center gap-3">
                            <div className="flex-shrink-0 p-2 bg-card rounded-full shadow-sm">
                                <HintIcon className="h-5 w-5 text-purple-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <h4 className="text-sm font-medium text-foreground">{currentHint.title}</h4>
                                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${currentHint.priority === 'high'
                                            ? 'bg-red-100 text-red-700'
                                            : currentHint.priority === 'medium'
                                                ? 'bg-yellow-100 text-yellow-700'
                                                : 'bg-secondary text-foreground'
                                        }`}>
                                        {currentHint.priority === 'high' ? '추천' : currentHint.priority === 'medium' ? '선택' : '참고'}
                                    </span>
                                </div>
                                <p className="text-xs text-muted-foreground truncate">{currentHint.description}</p>
                            </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-2">
                            <Button
                                size="sm"
                                variant="default"
                                className="bg-purple-600 hover:bg-purple-700 text-white"
                                onClick={() => handleApplyHint(currentHint)}
                            >
                                <Wand2 className="h-3 w-3 mr-1" />
                                {currentHint.action}
                            </Button>
                            <button
                                onClick={() => handleDismissHint(currentHint.id)}
                                className="p-1 hover:bg-muted rounded transition-colors"
                            >
                                <X className="h-4 w-4 text-muted-foreground" />
                            </button>
                        </div>

                        {/* Navigation arrows */}
                        {hints.length > 1 && (
                            <button
                                onClick={handleNextHint}
                                className="p-1 hover:bg-purple-100 rounded transition-colors"
                            >
                                <ChevronDown className="h-4 w-4 text-purple-600 rotate-[-90deg]" />
                            </button>
                        )}

                        {/* Hint counter */}
                        {hints.length > 1 && (
                            <span className="text-xs text-muted-foreground">
                                {currentHintIndex + 1}/{hints.length}
                            </span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default AiHintBar;
