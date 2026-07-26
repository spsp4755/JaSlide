'use client';

import { useState, useCallback } from 'react';
import { Palette, Check, Plus, Trash2, Save } from 'lucide-react';

interface ColorPaletteProps {
    value?: string;
    onChange: (color: string) => void;
    onSavePalette?: (palette: ColorSet) => void;
}

interface ColorSet {
    id: string;
    name: string;
    colors: string[];
    isPrimary?: boolean;
}

// 기본 브랜드 팔레트
const DEFAULT_PALETTES: ColorSet[] = [
    {
        id: 'purple-brand',
        name: '퍼플 브랜드',
        colors: ['#7C3AED', '#8B5CF6', '#A78BFA', '#C4B5FD', '#EDE9FE'],
        isPrimary: true,
    },
    {
        id: 'blue-corporate',
        name: '블루 코퍼레이트',
        colors: ['#1E40AF', '#3B82F6', '#60A5FA', '#93C5FD', '#DBEAFE'],
    },
    {
        id: 'green-nature',
        name: '그린 네이처',
        colors: ['#166534', '#22C55E', '#4ADE80', '#86EFAC', '#DCFCE7'],
    },
    {
        id: 'warm-sunset',
        name: '웜 선셋',
        colors: ['#C2410C', '#F97316', '#FB923C', '#FDBA74', '#FED7AA'],
    },
    {
        id: 'neutral-modern',
        name: '뉴트럴 모던',
        colors: ['#18181B', '#3F3F46', '#71717A', '#A1A1AA', '#E4E4E7'],
    },
];

// 프리셋 단일 컬러
const PRESET_COLORS = [
    '#000000', '#FFFFFF', '#6366F1', '#8B5CF6', '#EC4899',
    '#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#6B7280',
    '#14B8A6', '#84CC16', '#F43F5E', '#06B6D4', '#A855F7',
];

export function ColorPalette({ value, onChange, onSavePalette }: ColorPaletteProps) {
    const [palettes, setPalettes] = useState<ColorSet[]>(DEFAULT_PALETTES);
    const [selectedPalette, setSelectedPalette] = useState<string | null>(null);
    const [customColor, setCustomColor] = useState(value || '#000000');
    const [showCustom, setShowCustom] = useState(false);
    const [newPaletteName, setNewPaletteName] = useState('');
    const [newPaletteColors, setNewPaletteColors] = useState<string[]>([]);
    const [isCreating, setIsCreating] = useState(false);

    const handleColorSelect = useCallback((color: string) => {
        setCustomColor(color);
        onChange(color);
    }, [onChange]);

    const handlePaletteSelect = (paletteId: string) => {
        setSelectedPalette(selectedPalette === paletteId ? null : paletteId);
    };

    const handleAddToPalette = () => {
        if (customColor && !newPaletteColors.includes(customColor)) {
            setNewPaletteColors([...newPaletteColors, customColor]);
        }
    };

    const handleRemoveFromPalette = (color: string) => {
        setNewPaletteColors(newPaletteColors.filter(c => c !== color));
    };

    const handleSavePalette = () => {
        if (newPaletteName && newPaletteColors.length > 0) {
            const newPalette: ColorSet = {
                id: `custom-${Date.now()}`,
                name: newPaletteName,
                colors: newPaletteColors,
            };
            setPalettes([...palettes, newPalette]);
            onSavePalette?.(newPalette);
            setNewPaletteName('');
            setNewPaletteColors([]);
            setIsCreating(false);
        }
    };

    // RGB/HSL 변환 유틸리티
    const hexToRgb = (hex: string): string => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (result) {
            const r = parseInt(result[1], 16);
            const g = parseInt(result[2], 16);
            const b = parseInt(result[3], 16);
            return `rgb(${r}, ${g}, ${b})`;
        }
        return hex;
    };

    return (
        <div className="space-y-4">
            {/* 헤더 */}
            <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <Palette className="h-3.5 w-3.5" />
                    컬러 팔레트
                </label>
                <button
                    onClick={() => setIsCreating(!isCreating)}
                    className="text-xs text-purple-600 hover:text-purple-700 flex items-center gap-1"
                >
                    <Plus className="h-3 w-3" />
                    새 팔레트
                </button>
            </div>

            {/* 현재 선택된 색상 */}
            <div className="flex items-center gap-2 p-2 bg-secondary rounded-lg">
                <div
                    className="w-10 h-10 rounded-lg border-2 border-white shadow-sm"
                    style={{ backgroundColor: customColor }}
                />
                <div className="flex-1">
                    <input
                        type="text"
                        value={customColor}
                        onChange={(e) => {
                            setCustomColor(e.target.value);
                            if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
                                onChange(e.target.value);
                            }
                        }}
                        className="w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono"
                        placeholder="#000000"
                    />
                    <span className="text-xs text-muted-foreground mt-0.5 block">
                        {hexToRgb(customColor)}
                    </span>
                </div>
                <input
                    type="color"
                    value={customColor}
                    onChange={(e) => handleColorSelect(e.target.value)}
                    className="w-10 h-10 rounded cursor-pointer border-0"
                />
            </div>

            {/* 프리셋 색상 */}
            <div>
                <span className="text-xs text-muted-foreground mb-1.5 block">빠른 선택</span>
                <div className="flex flex-wrap gap-1">
                    {PRESET_COLORS.map((color) => (
                        <button
                            key={color}
                            onClick={() => handleColorSelect(color)}
                            className={`w-6 h-6 rounded border-2 transition-all hover:scale-110 ${customColor === color
                                    ? 'border-purple-500 ring-2 ring-purple-200'
                                    : 'border-white shadow-sm'
                                }`}
                            style={{ backgroundColor: color }}
                            title={color}
                        >
                            {customColor === color && (
                                <Check className={`w-4 h-4 mx-auto ${color === '#FFFFFF' || color === '#E4E4E7' ? 'text-foreground' : 'text-white'
                                    }`} />
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {/* 브랜드 팔레트 */}
            <div className="space-y-2">
                <span className="text-xs text-muted-foreground block">브랜드 팔레트</span>
                {palettes.map((palette) => (
                    <div
                        key={palette.id}
                        className={`p-2 rounded-lg border transition-colors cursor-pointer ${selectedPalette === palette.id
                                ? 'border-purple-300 bg-purple-50'
                                : 'border-border hover:border-border'
                            }`}
                        onClick={() => handlePaletteSelect(palette.id)}
                    >
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-medium text-foreground">
                                {palette.name}
                                {palette.isPrimary && (
                                    <span className="ml-1.5 text-[10px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded">
                                        기본
                                    </span>
                                )}
                            </span>
                        </div>
                        <div className="flex gap-1">
                            {palette.colors.map((color, idx) => (
                                <button
                                    key={idx}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleColorSelect(color);
                                    }}
                                    className="flex-1 h-6 rounded transition-transform hover:scale-105 first:rounded-l-md last:rounded-r-md"
                                    style={{ backgroundColor: color }}
                                    title={color}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {/* 새 팔레트 만들기 */}
            {isCreating && (
                <div className="p-3 border border-dashed border-purple-300 rounded-lg bg-purple-50/50 space-y-3">
                    <input
                        type="text"
                        value={newPaletteName}
                        onChange={(e) => setNewPaletteName(e.target.value)}
                        placeholder="팔레트 이름"
                        className="w-full px-2.5 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />

                    <div className="flex flex-wrap gap-1 min-h-[32px]">
                        {newPaletteColors.length === 0 ? (
                            <span className="text-xs text-muted-foreground">색상을 추가하세요</span>
                        ) : (
                            newPaletteColors.map((color, idx) => (
                                <div key={idx} className="relative group">
                                    <div
                                        className="w-8 h-8 rounded border-2 border-white shadow-sm"
                                        style={{ backgroundColor: color }}
                                    />
                                    <button
                                        onClick={() => handleRemoveFromPalette(color)}
                                        className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                                    >
                                        <Trash2 className="w-2.5 h-2.5" />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={handleAddToPalette}
                            className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs bg-card border rounded hover:bg-secondary"
                        >
                            <Plus className="h-3 w-3" />
                            현재 색상 추가
                        </button>
                        <button
                            onClick={handleSavePalette}
                            disabled={!newPaletteName || newPaletteColors.length === 0}
                            className="flex items-center justify-center gap-1 px-3 py-1.5 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Save className="h-3 w-3" />
                            저장
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default ColorPalette;
