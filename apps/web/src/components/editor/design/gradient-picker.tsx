'use client';

import { useState, useCallback, useMemo } from 'react';
import { Palette, RotateCcw, ArrowRight } from 'lucide-react';

interface GradientPickerProps {
    value?: GradientValue;
    onChange: (gradient: GradientValue) => void;
}

export interface GradientValue {
    type: 'linear' | 'radial';
    angle: number;  // 0-360 for linear, ignored for radial
    stops: GradientStop[];
}

interface GradientStop {
    color: string;
    position: number;  // 0-100
}

// 기본 그라데이션 프리셋
const GRADIENT_PRESETS: { name: string; gradient: GradientValue }[] = [
    {
        name: '퍼플 드림',
        gradient: {
            type: 'linear',
            angle: 135,
            stops: [
                { color: '#667EEA', position: 0 },
                { color: '#764BA2', position: 100 },
            ],
        },
    },
    {
        name: '오션 블루',
        gradient: {
            type: 'linear',
            angle: 90,
            stops: [
                { color: '#2193B0', position: 0 },
                { color: '#6DD5ED', position: 100 },
            ],
        },
    },
    {
        name: '선셋 글로우',
        gradient: {
            type: 'linear',
            angle: 45,
            stops: [
                { color: '#F093FB', position: 0 },
                { color: '#F5576C', position: 50 },
                { color: '#F9D423', position: 100 },
            ],
        },
    },
    {
        name: '민트 프레시',
        gradient: {
            type: 'linear',
            angle: 180,
            stops: [
                { color: '#11998E', position: 0 },
                { color: '#38EF7D', position: 100 },
            ],
        },
    },
    {
        name: '다크 나이트',
        gradient: {
            type: 'linear',
            angle: 135,
            stops: [
                { color: '#232526', position: 0 },
                { color: '#414345', position: 100 },
            ],
        },
    },
    {
        name: '레이디얼 골드',
        gradient: {
            type: 'radial',
            angle: 0,
            stops: [
                { color: '#F7971E', position: 0 },
                { color: '#FFD200', position: 100 },
            ],
        },
    },
];

const DEFAULT_GRADIENT: GradientValue = {
    type: 'linear',
    angle: 90,
    stops: [
        { color: '#667EEA', position: 0 },
        { color: '#764BA2', position: 100 },
    ],
};

export function GradientPicker({ value = DEFAULT_GRADIENT, onChange }: GradientPickerProps) {
    const [localValue, setLocalValue] = useState<GradientValue>(value);
    const [activeStop, setActiveStop] = useState<number>(0);

    const updateGradient = useCallback((updates: Partial<GradientValue>) => {
        const newValue = { ...localValue, ...updates };
        setLocalValue(newValue);
        onChange(newValue);
    }, [localValue, onChange]);

    const updateStop = useCallback((index: number, updates: Partial<GradientStop>) => {
        const newStops = [...localValue.stops];
        newStops[index] = { ...newStops[index], ...updates };
        updateGradient({ stops: newStops });
    }, [localValue.stops, updateGradient]);

    const addStop = useCallback(() => {
        if (localValue.stops.length >= 5) return;

        const newPosition = 50;
        const newColor = '#888888';
        const newStops = [...localValue.stops, { color: newColor, position: newPosition }]
            .sort((a, b) => a.position - b.position);
        updateGradient({ stops: newStops });
    }, [localValue.stops, updateGradient]);

    const removeStop = useCallback((index: number) => {
        if (localValue.stops.length <= 2) return;

        const newStops = localValue.stops.filter((_, i) => i !== index);
        setActiveStop(Math.min(activeStop, newStops.length - 1));
        updateGradient({ stops: newStops });
    }, [localValue.stops, activeStop, updateGradient]);

    // CSS 그라데이션 문자열 생성
    const gradientCss = useMemo(() => {
        const sortedStops = [...localValue.stops].sort((a, b) => a.position - b.position);
        const stopsStr = sortedStops.map(s => `${s.color} ${s.position}%`).join(', ');

        if (localValue.type === 'linear') {
            return `linear-gradient(${localValue.angle}deg, ${stopsStr})`;
        } else {
            return `radial-gradient(circle, ${stopsStr})`;
        }
    }, [localValue]);

    const applyPreset = (preset: { gradient: GradientValue }) => {
        setLocalValue(preset.gradient);
        onChange(preset.gradient);
    };

    return (
        <div className="space-y-4">
            {/* 헤더 */}
            <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <Palette className="h-3.5 w-3.5" />
                    그라데이션
                </label>
                <button
                    onClick={() => {
                        setLocalValue(DEFAULT_GRADIENT);
                        onChange(DEFAULT_GRADIENT);
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                    <RotateCcw className="h-3 w-3" />
                    초기화
                </button>
            </div>

            {/* 미리보기 */}
            <div
                className="h-20 rounded-lg border shadow-inner"
                style={{ background: gradientCss }}
            />

            {/* 타입 선택 */}
            <div className="flex gap-1">
                <button
                    onClick={() => updateGradient({ type: 'linear' })}
                    className={`flex-1 py-1.5 text-xs rounded transition-colors ${localValue.type === 'linear'
                        ? 'bg-purple-100 text-purple-700 font-medium'
                        : 'bg-secondary text-muted-foreground hover:bg-muted'
                        }`}
                >
                    선형
                </button>
                <button
                    onClick={() => updateGradient({ type: 'radial' })}
                    className={`flex-1 py-1.5 text-xs rounded transition-colors ${localValue.type === 'radial'
                        ? 'bg-purple-100 text-purple-700 font-medium'
                        : 'bg-secondary text-muted-foreground hover:bg-muted'
                        }`}
                >
                    방사형
                </button>
            </div>

            {/* 각도 조절 (선형 전용) */}
            {localValue.type === 'linear' && (
                <div>
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-muted-foreground">각도</span>
                        <span className="text-xs text-muted-foreground font-mono">{localValue.angle}°</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            type="range"
                            min={0}
                            max={360}
                            value={localValue.angle}
                            onChange={(e) => updateGradient({ angle: Number(e.target.value) })}
                            className="flex-1 accent-purple-600"
                        />
                        <div
                            className="w-6 h-6 rounded-full border-2 border-border flex items-center justify-center"
                            style={{ transform: `rotate(${localValue.angle}deg)` }}
                        >
                            <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        </div>
                    </div>
                </div>
            )}

            {/* 색상 스톱 */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted-foreground">색상 포인트</span>
                    <button
                        onClick={addStop}
                        disabled={localValue.stops.length >= 5}
                        className="text-xs text-purple-600 hover:text-purple-700 disabled:text-muted-foreground"
                    >
                        + 추가
                    </button>
                </div>

                {/* 그라데이션 바 with 스톱 핸들 */}
                <div className="relative h-6 rounded-full mb-3" style={{ background: gradientCss }}>
                    {localValue.stops.map((stop, idx) => (
                        <button
                            key={idx}
                            onClick={() => setActiveStop(idx)}
                            onDoubleClick={() => removeStop(idx)}
                            className={`absolute top-0 w-4 h-6 -ml-2 rounded-sm border-2 transition-all ${activeStop === idx
                                ? 'border-purple-500 shadow-lg scale-110 z-10'
                                : 'border-white shadow'
                                }`}
                            style={{
                                left: `${stop.position}%`,
                                backgroundColor: stop.color,
                            }}
                            title="더블클릭으로 삭제"
                        />
                    ))}
                </div>

                {/* 활성 스톱 편집 */}
                {localValue.stops[activeStop] && (
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <span className="text-xs text-muted-foreground block mb-1">색상</span>
                            <div className="flex items-center gap-1">
                                <input
                                    type="color"
                                    value={localValue.stops[activeStop].color}
                                    onChange={(e) => updateStop(activeStop, { color: e.target.value })}
                                    className="w-8 h-8 rounded cursor-pointer"
                                />
                                <input
                                    type="text"
                                    value={localValue.stops[activeStop].color}
                                    onChange={(e) => updateStop(activeStop, { color: e.target.value })}
                                    className="flex-1 px-2 py-1 text-xs border rounded font-mono focus:outline-none focus:ring-1 focus:ring-purple-500"
                                />
                            </div>
                        </div>
                        <div>
                            <span className="text-xs text-muted-foreground block mb-1">위치</span>
                            <div className="flex items-center gap-1">
                                <input
                                    type="range"
                                    min={0}
                                    max={100}
                                    value={localValue.stops[activeStop].position}
                                    onChange={(e) => updateStop(activeStop, { position: Number(e.target.value) })}
                                    className="flex-1 accent-purple-600"
                                />
                                <span className="text-xs text-muted-foreground w-8 text-right">
                                    {localValue.stops[activeStop].position}%
                                </span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* 프리셋 */}
            <div>
                <span className="text-xs text-muted-foreground block mb-2">프리셋</span>
                <div className="grid grid-cols-3 gap-2">
                    {GRADIENT_PRESETS.map((preset, idx) => {
                        const presetCss = preset.gradient.type === 'linear'
                            ? `linear-gradient(${preset.gradient.angle}deg, ${preset.gradient.stops.map(s => `${s.color} ${s.position}%`).join(', ')})`
                            : `radial-gradient(circle, ${preset.gradient.stops.map(s => `${s.color} ${s.position}%`).join(', ')})`;

                        return (
                            <button
                                key={idx}
                                onClick={() => applyPreset(preset)}
                                className="aspect-video rounded-lg border hover:border-purple-300 transition-colors overflow-hidden group"
                                title={preset.name}
                            >
                                <div
                                    className="w-full h-full group-hover:scale-105 transition-transform"
                                    style={{ background: presetCss }}
                                />
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* CSS 출력 */}
            <div>
                <span className="text-xs text-muted-foreground block mb-1">CSS</span>
                <div className="p-2 bg-secondary rounded text-xs font-mono text-muted-foreground break-all">
                    {gradientCss}
                </div>
            </div>
        </div>
    );
}

export default GradientPicker;
