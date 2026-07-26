'use client';

import { useState } from 'react';

interface TextPropertiesProps {
    value: any;
    onChange: (updates: any) => void;
}

const FONT_FAMILIES = [
    { value: 'Pretendard', label: 'Pretendard' },
    { value: 'Noto Sans KR', label: 'Noto Sans KR' },
    { value: 'Spoqa Han Sans', label: 'Spoqa Han Sans' },
    { value: 'Inter', label: 'Inter' },
    { value: 'Roboto', label: 'Roboto' },
];

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72];

export function TextProperties({ value, onChange }: TextPropertiesProps) {
    const content = value?.content || {};
    const style = content.style || {};

    const handleStyleChange = (key: string, val: any) => {
        onChange({
            content: {
                ...content,
                style: {
                    ...style,
                    [key]: val,
                },
            },
        });
    };

    return (
        <div className="space-y-4">
            {/* Font Family */}
            <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    글꼴
                </label>
                <select
                    value={style.fontFamily || 'Pretendard'}
                    onChange={(e) => handleStyleChange('fontFamily', e.target.value)}
                    className="w-full px-2.5 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                    {FONT_FAMILIES.map((font) => (
                        <option key={font.value} value={font.value}>
                            {font.label}
                        </option>
                    ))}
                </select>
            </div>

            {/* Font Size */}
            <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    크기
                </label>
                <div className="flex items-center gap-2">
                    <select
                        value={style.fontSize || 16}
                        onChange={(e) => handleStyleChange('fontSize', Number(e.target.value))}
                        className="flex-1 px-2.5 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                    >
                        {FONT_SIZES.map((size) => (
                            <option key={size} value={size}>
                                {size}px
                            </option>
                        ))}
                    </select>
                    <input
                        type="number"
                        value={style.fontSize || 16}
                        onChange={(e) => handleStyleChange('fontSize', Number(e.target.value))}
                        className="w-16 px-2 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                        min={8}
                        max={200}
                    />
                </div>
            </div>

            {/* Font Weight */}
            <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    굵기
                </label>
                <div className="flex gap-1">
                    {[
                        { value: '400', label: '보통' },
                        { value: '500', label: '중간' },
                        { value: '600', label: '두껍게' },
                        { value: '700', label: '굵게' },
                    ].map((weight) => (
                        <button
                            key={weight.value}
                            onClick={() => handleStyleChange('fontWeight', weight.value)}
                            className={`flex-1 py-1.5 text-xs rounded transition-colors ${(style.fontWeight || '400') === weight.value
                                    ? 'bg-purple-100 text-purple-700 font-medium'
                                    : 'bg-secondary text-muted-foreground hover:bg-muted'
                                }`}
                        >
                            {weight.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Line Height */}
            <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    행간
                </label>
                <input
                    type="range"
                    min={1}
                    max={3}
                    step={0.1}
                    value={style.lineHeight || 1.5}
                    onChange={(e) => handleStyleChange('lineHeight', Number(e.target.value))}
                    className="w-full accent-purple-600"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>촘촘하게</span>
                    <span>{style.lineHeight?.toFixed(1) || '1.5'}</span>
                    <span>넓게</span>
                </div>
            </div>

            {/* Letter Spacing */}
            <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    자간
                </label>
                <input
                    type="range"
                    min={-2}
                    max={10}
                    step={0.5}
                    value={style.letterSpacing || 0}
                    onChange={(e) => handleStyleChange('letterSpacing', Number(e.target.value))}
                    className="w-full accent-purple-600"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>좁게</span>
                    <span>{style.letterSpacing || 0}px</span>
                    <span>넓게</span>
                </div>
            </div>
        </div>
    );
}

export default TextProperties;
