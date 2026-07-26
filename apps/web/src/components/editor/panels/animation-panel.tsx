'use client';

import { useState, useEffect } from 'react';
import {
    Sparkles,
    Play,
    Pause,
    Trash2,
    ChevronDown,
    ChevronRight,
    Clock,
    Zap,
    ArrowRight,
    MousePointer,
    RotateCcw,
} from 'lucide-react';
import {
    AnimationPreset,
    ENTRANCE_PRESETS,
    EMPHASIS_PRESETS,
    EXIT_PRESETS,
    generateAnimationCSS,
    KEYFRAMES,
} from '@/lib/animation-presets';

interface AnimationPanelProps {
    elementId: string | null;
    currentAnimation: ElementAnimation | null;
    onApplyAnimation: (animation: ElementAnimation) => void;
    onRemoveAnimation: () => void;
    onPreview: (animation: ElementAnimation) => void;
}

export interface ElementAnimation {
    elementId: string;
    entrance?: AnimationConfig;
    emphasis?: AnimationConfig;
    exit?: AnimationConfig;
}

interface AnimationConfig {
    presetId: string;
    duration: number;
    delay: number;
    trigger: 'click' | 'auto' | 'with-previous';
}

export function AnimationPanel({
    elementId,
    currentAnimation,
    onApplyAnimation,
    onRemoveAnimation,
    onPreview,
}: AnimationPanelProps) {
    const [activeCategory, setActiveCategory] = useState<'entrance' | 'emphasis' | 'exit'>('entrance');
    const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['entrance']));
    const [selectedPreset, setSelectedPreset] = useState<AnimationPreset | null>(null);
    const [duration, setDuration] = useState(500);
    const [delay, setDelay] = useState(0);
    const [trigger, setTrigger] = useState<'click' | 'auto' | 'with-previous'>('click');
    const [isPlaying, setIsPlaying] = useState(false);

    // 카테고리별 프리셋
    const presetsByCategory = {
        entrance: ENTRANCE_PRESETS,
        emphasis: EMPHASIS_PRESETS,
        exit: EXIT_PRESETS,
    };

    // 카테고리 이름
    const categoryNames = {
        entrance: '등장',
        emphasis: '강조',
        exit: '퇴장',
    };

    // 카테고리 아이콘
    const categoryIcons = {
        entrance: ArrowRight,
        emphasis: Zap,
        exit: ArrowRight,
    };

    // 섹션 토글
    const toggleSection = (category: string) => {
        setExpandedSections(prev => {
            const next = new Set(prev);
            if (next.has(category)) {
                next.delete(category);
            } else {
                next.add(category);
            }
            return next;
        });
    };

    // 프리셋 선택
    const handleSelectPreset = (preset: AnimationPreset) => {
        setSelectedPreset(preset);
        setActiveCategory(preset.category);
        setDuration(preset.duration);
    };

    // 애니메이션 적용
    const handleApplyAnimation = () => {
        if (!elementId || !selectedPreset) return;

        const config: AnimationConfig = {
            presetId: selectedPreset.id,
            duration,
            delay,
            trigger,
        };

        const animation: ElementAnimation = {
            elementId,
            [activeCategory]: config,
        };

        onApplyAnimation(animation);
    };

    // 미리보기
    const handlePreview = () => {
        if (!elementId || !selectedPreset) return;

        setIsPlaying(true);
        onPreview({
            elementId,
            [activeCategory]: {
                presetId: selectedPreset.id,
                duration,
                delay,
                trigger: 'auto',
            },
        });

        setTimeout(() => setIsPlaying(false), duration + delay);
    };

    if (!elementId) {
        return (
            <div className="h-full flex flex-col items-center justify-center bg-card p-4 text-center">
                <Sparkles className="h-10 w-10 text-muted-foreground mb-3" />
                <span className="text-sm text-muted-foreground">
                    요소를 선택하여<br />애니메이션을 추가하세요
                </span>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-card">
            {/* CSS Keyframes 주입 */}
            <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />

            {/* 헤더 */}
            <div className="px-3 py-2 border-b">
                <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-purple-600" />
                    <span className="text-sm font-medium text-foreground">애니메이션</span>
                </div>
            </div>

            {/* 카테고리 탭 */}
            <div className="flex border-b">
                {(['entrance', 'emphasis', 'exit'] as const).map((category) => {
                    const Icon = categoryIcons[category];
                    return (
                        <button
                            key={category}
                            onClick={() => setActiveCategory(category)}
                            className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium transition-colors ${activeCategory === category
                                    ? 'text-purple-700 border-b-2 border-purple-600 bg-purple-50'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                                }`}
                        >
                            <Icon className={`h-3.5 w-3.5 ${category === 'exit' ? 'rotate-180' : ''}`} />
                            {categoryNames[category]}
                        </button>
                    );
                })}
            </div>

            {/* 프리셋 목록 */}
            <div className="flex-1 overflow-y-auto p-2">
                <div className="grid grid-cols-3 gap-1.5">
                    {presetsByCategory[activeCategory].map((preset) => (
                        <button
                            key={preset.id}
                            onClick={() => handleSelectPreset(preset)}
                            className={`aspect-square flex flex-col items-center justify-center p-2 rounded-lg border transition-all ${selectedPreset?.id === preset.id
                                    ? 'border-purple-400 bg-purple-50 text-purple-700'
                                    : 'border-border hover:border-border text-muted-foreground hover:bg-secondary'
                                }`}
                        >
                            {/* 미리보기 아이콘 */}
                            <div
                                className={`w-6 h-6 bg-purple-200 rounded mb-1 ${selectedPreset?.id === preset.id && isPlaying
                                        ? `animate-[${preset.keyframes}_${preset.duration}ms_${preset.easing}]`
                                        : ''
                                    }`}
                            />
                            <span className="text-[10px] text-center leading-tight">
                                {preset.name}
                            </span>
                        </button>
                    ))}
                </div>
            </div>

            {/* 설정 패널 */}
            {selectedPreset && (
                <div className="border-t p-3 space-y-3">
                    {/* 타이밍 */}
                    <div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
                            <Clock className="h-3.5 w-3.5" />
                            타이밍
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="text-[10px] text-muted-foreground">지속 시간</label>
                                <div className="flex items-center gap-1">
                                    <input
                                        type="range"
                                        min={100}
                                        max={2000}
                                        step={100}
                                        value={duration}
                                        onChange={(e) => setDuration(Number(e.target.value))}
                                        className="flex-1 accent-purple-600"
                                    />
                                    <span className="text-[10px] text-muted-foreground w-10 text-right">
                                        {duration}ms
                                    </span>
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] text-muted-foreground">지연</label>
                                <div className="flex items-center gap-1">
                                    <input
                                        type="range"
                                        min={0}
                                        max={2000}
                                        step={100}
                                        value={delay}
                                        onChange={(e) => setDelay(Number(e.target.value))}
                                        className="flex-1 accent-purple-600"
                                    />
                                    <span className="text-[10px] text-muted-foreground w-10 text-right">
                                        {delay}ms
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 트리거 */}
                    <div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
                            <MousePointer className="h-3.5 w-3.5" />
                            트리거
                        </div>
                        <div className="flex gap-1">
                            {[
                                { value: 'click', label: '클릭 시' },
                                { value: 'auto', label: '자동' },
                                { value: 'with-previous', label: '이전과 함께' },
                            ].map((opt) => (
                                <button
                                    key={opt.value}
                                    onClick={() => setTrigger(opt.value as any)}
                                    className={`flex-1 py-1.5 text-[10px] rounded transition-colors ${trigger === opt.value
                                            ? 'bg-purple-100 text-purple-700 font-medium'
                                            : 'bg-secondary text-muted-foreground hover:bg-muted'
                                        }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 액션 버튼 */}
                    <div className="flex gap-2">
                        <button
                            onClick={handlePreview}
                            disabled={isPlaying}
                            className="flex-1 flex items-center justify-center gap-1 py-2 text-xs bg-secondary hover:bg-muted rounded transition-colors"
                        >
                            {isPlaying ? (
                                <Pause className="h-3.5 w-3.5" />
                            ) : (
                                <Play className="h-3.5 w-3.5" />
                            )}
                            미리보기
                        </button>
                        <button
                            onClick={handleApplyAnimation}
                            className="flex-1 flex items-center justify-center gap-1 py-2 text-xs bg-purple-600 text-white hover:bg-purple-700 rounded transition-colors"
                        >
                            <Sparkles className="h-3.5 w-3.5" />
                            적용
                        </button>
                    </div>
                </div>
            )}

            {/* 현재 적용된 애니메이션 */}
            {currentAnimation && (
                <div className="border-t p-2">
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">적용된 애니메이션</span>
                        <button
                            onClick={onRemoveAnimation}
                            className="p-1 text-red-500 hover:bg-red-50 rounded"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default AnimationPanel;
