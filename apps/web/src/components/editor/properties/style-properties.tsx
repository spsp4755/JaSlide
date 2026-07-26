'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Paintbrush, Type, Square, Eye } from 'lucide-react';
import { ColorPalette } from '../design/color-palette';
import { GradientPicker, GradientValue } from '../design/gradient-picker';

interface StylePropertiesProps {
    value: any;
    onChange: (updates: any) => void;
}

type FillType = 'solid' | 'gradient' | 'none';

// 섹션 접기/펼치기 상태
interface SectionState {
    fill: boolean;
    text: boolean;
    border: boolean;
    effects: boolean;
}

export function StyleProperties({ value, onChange }: StylePropertiesProps) {
    const content = value?.content || {};
    const style = content.style || {};
    const [fillType, setFillType] = useState<FillType>(
        style.backgroundGradient ? 'gradient' : style.backgroundColor ? 'solid' : 'none'
    );
    const [sections, setSections] = useState<SectionState>({
        fill: true,
        text: true,
        border: false,
        effects: false,
    });

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

    const handleGradientChange = (gradient: GradientValue) => {
        const sortedStops = [...gradient.stops].sort((a, b) => a.position - b.position);
        const stopsStr = sortedStops.map(s => `${s.color} ${s.position}%`).join(', ');
        const css = gradient.type === 'linear'
            ? `linear-gradient(${gradient.angle}deg, ${stopsStr})`
            : `radial-gradient(circle, ${stopsStr})`;

        handleStyleChange('backgroundGradient', css);
        handleStyleChange('backgroundGradientValue', gradient);
    };

    const toggleSection = (section: keyof SectionState) => {
        setSections(prev => ({ ...prev, [section]: !prev[section] }));
    };

    const SectionHeader = ({
        title,
        icon: Icon,
        section
    }: {
        title: string;
        icon: any;
        section: keyof SectionState
    }) => (
        <button
            onClick={() => toggleSection(section)}
            className="w-full flex items-center justify-between py-2 text-sm font-medium text-foreground hover:text-foreground"
        >
            <div className="flex items-center gap-2">
                <Icon className="h-4 w-4" />
                {title}
            </div>
            {sections[section] ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
        </button>
    );

    return (
        <div className="space-y-2">
            {/* 채우기 섹션 */}
            <div className="border-b pb-2">
                <SectionHeader title="채우기" icon={Paintbrush} section="fill" />
                {sections.fill && (
                    <div className="pt-2 space-y-3">
                        {/* 채우기 타입 선택 */}
                        <div className="flex gap-1">
                            {[
                                { type: 'none' as FillType, label: '없음' },
                                { type: 'solid' as FillType, label: '단색' },
                                { type: 'gradient' as FillType, label: '그라데이션' },
                            ].map((option) => (
                                <button
                                    key={option.type}
                                    onClick={() => {
                                        setFillType(option.type);
                                        if (option.type === 'none') {
                                            handleStyleChange('backgroundColor', 'transparent');
                                            handleStyleChange('backgroundGradient', null);
                                        }
                                    }}
                                    className={`flex-1 py-1.5 text-xs rounded transition-colors ${fillType === option.type
                                            ? 'bg-purple-100 text-purple-700 font-medium'
                                            : 'bg-secondary text-muted-foreground hover:bg-muted'
                                        }`}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>

                        {/* 단색 선택 */}
                        {fillType === 'solid' && (
                            <ColorPalette
                                value={style.backgroundColor || '#FFFFFF'}
                                onChange={(color) => {
                                    handleStyleChange('backgroundColor', color);
                                    handleStyleChange('backgroundGradient', null);
                                }}
                            />
                        )}

                        {/* 그라데이션 선택 */}
                        {fillType === 'gradient' && (
                            <GradientPicker
                                value={style.backgroundGradientValue}
                                onChange={handleGradientChange}
                            />
                        )}
                    </div>
                )}
            </div>

            {/* 텍스트 섹션 */}
            <div className="border-b pb-2">
                <SectionHeader title="텍스트 색상" icon={Type} section="text" />
                {sections.text && (
                    <div className="pt-2">
                        <ColorPalette
                            value={style.color || '#000000'}
                            onChange={(color) => handleStyleChange('color', color)}
                        />
                    </div>
                )}
            </div>

            {/* 테두리 섹션 */}
            <div className="border-b pb-2">
                <SectionHeader title="테두리" icon={Square} section="border" />
                {sections.border && (
                    <div className="pt-2 space-y-3">
                        <div className="grid grid-cols-3 gap-2">
                            <div>
                                <span className="text-xs text-muted-foreground block mb-1">두께</span>
                                <input
                                    type="number"
                                    value={style.borderWidth || 0}
                                    onChange={(e) => handleStyleChange('borderWidth', Number(e.target.value))}
                                    className="w-full px-2 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    min={0}
                                />
                            </div>
                            <div>
                                <span className="text-xs text-muted-foreground block mb-1">스타일</span>
                                <select
                                    value={style.borderStyle || 'solid'}
                                    onChange={(e) => handleStyleChange('borderStyle', e.target.value)}
                                    className="w-full px-2 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                >
                                    <option value="solid">실선</option>
                                    <option value="dashed">점선</option>
                                    <option value="dotted">점</option>
                                </select>
                            </div>
                            <div>
                                <span className="text-xs text-muted-foreground block mb-1">색상</span>
                                <input
                                    type="color"
                                    value={style.borderColor || '#000000'}
                                    onChange={(e) => handleStyleChange('borderColor', e.target.value)}
                                    className="w-full h-8 rounded cursor-pointer border"
                                />
                            </div>
                        </div>

                        {/* 모서리 둥글기 */}
                        <div>
                            <div className="flex justify-between mb-1">
                                <span className="text-xs text-muted-foreground">모서리 둥글기</span>
                                <span className="text-xs text-muted-foreground">{style.borderRadius || 0}px</span>
                            </div>
                            <input
                                type="range"
                                min={0}
                                max={50}
                                value={style.borderRadius || 0}
                                onChange={(e) => handleStyleChange('borderRadius', Number(e.target.value))}
                                className="w-full accent-purple-600"
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* 효과 섹션 */}
            <div className="pb-2">
                <SectionHeader title="효과" icon={Eye} section="effects" />
                {sections.effects && (
                    <div className="pt-2 space-y-3">
                        {/* 투명도 */}
                        <div>
                            <div className="flex justify-between mb-1">
                                <span className="text-xs text-muted-foreground">투명도</span>
                                <span className="text-xs text-muted-foreground">{Math.round((style.opacity ?? 1) * 100)}%</span>
                            </div>
                            <input
                                type="range"
                                min={0}
                                max={100}
                                value={(style.opacity ?? 1) * 100}
                                onChange={(e) => handleStyleChange('opacity', Number(e.target.value) / 100)}
                                className="w-full accent-purple-600"
                            />
                        </div>

                        {/* 그림자 */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs text-muted-foreground">그림자</span>
                                <label className="flex items-center gap-1.5 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={!!style.boxShadow}
                                        onChange={(e) => {
                                            handleStyleChange(
                                                'boxShadow',
                                                e.target.checked ? '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)' : null
                                            );
                                        }}
                                        className="rounded text-purple-600 focus:ring-purple-500"
                                    />
                                    <span className="text-xs text-muted-foreground">활성화</span>
                                </label>
                            </div>
                            {style.boxShadow && (
                                <div className="flex gap-1">
                                    {[
                                        { label: '작게', value: '0 1px 2px 0 rgba(0,0,0,0.05)' },
                                        { label: '중간', value: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)' },
                                        { label: '크게', value: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)' },
                                    ].map((shadow) => (
                                        <button
                                            key={shadow.label}
                                            onClick={() => handleStyleChange('boxShadow', shadow.value)}
                                            className={`flex-1 py-1 text-xs rounded transition-colors ${style.boxShadow === shadow.value
                                                    ? 'bg-purple-100 text-purple-700'
                                                    : 'bg-secondary text-muted-foreground hover:bg-muted'
                                                }`}
                                        >
                                            {shadow.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default StyleProperties;

