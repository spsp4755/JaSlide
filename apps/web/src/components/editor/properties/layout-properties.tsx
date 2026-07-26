'use client';

import {
    AlignLeft,
    AlignCenter,
    AlignRight,
    AlignJustify,
    ArrowUp,
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    Layers,
} from 'lucide-react';

interface LayoutPropertiesProps {
    value: any;
    onChange: (updates: any) => void;
}

export function LayoutProperties({ value, onChange }: LayoutPropertiesProps) {
    const content = value?.content || {};
    const style = content.style || {};
    const position = content.position || { x: 0, y: 0 };
    const size = content.size || { width: 'auto', height: 'auto' };

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

    const handlePositionChange = (key: string, val: number) => {
        onChange({
            content: {
                ...content,
                position: {
                    ...position,
                    [key]: val,
                },
            },
        });
    };

    const handleSizeChange = (key: string, val: number | string) => {
        onChange({
            content: {
                ...content,
                size: {
                    ...size,
                    [key]: val,
                },
            },
        });
    };

    return (
        <div className="space-y-4">
            {/* Text Alignment */}
            <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    텍스트 정렬
                </label>
                <div className="flex gap-1">
                    {[
                        { value: 'left', icon: AlignLeft, label: '왼쪽' },
                        { value: 'center', icon: AlignCenter, label: '가운데' },
                        { value: 'right', icon: AlignRight, label: '오른쪽' },
                        { value: 'justify', icon: AlignJustify, label: '양쪽' },
                    ].map((align) => {
                        const Icon = align.icon;
                        return (
                            <button
                                key={align.value}
                                onClick={() => handleStyleChange('textAlign', align.value)}
                                className={`flex-1 p-2 rounded transition-colors ${style.textAlign === align.value
                                        ? 'bg-purple-100 text-purple-700'
                                        : 'bg-secondary text-muted-foreground hover:bg-muted'
                                    }`}
                                title={align.label}
                            >
                                <Icon className="h-4 w-4 mx-auto" />
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Vertical Alignment */}
            <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    세로 정렬
                </label>
                <div className="flex gap-1">
                    {[
                        { value: 'flex-start', label: '상단' },
                        { value: 'center', label: '중앙' },
                        { value: 'flex-end', label: '하단' },
                    ].map((align) => (
                        <button
                            key={align.value}
                            onClick={() => handleStyleChange('alignItems', align.value)}
                            className={`flex-1 py-1.5 text-xs rounded transition-colors ${style.alignItems === align.value
                                    ? 'bg-purple-100 text-purple-700 font-medium'
                                    : 'bg-secondary text-muted-foreground hover:bg-muted'
                                }`}
                        >
                            {align.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Position */}
            <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    위치
                </label>
                <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground w-4">X</span>
                        <input
                            type="number"
                            value={position.x || 0}
                            onChange={(e) => handlePositionChange('x', Number(e.target.value))}
                            className="flex-1 px-2 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground w-4">Y</span>
                        <input
                            type="number"
                            value={position.y || 0}
                            onChange={(e) => handlePositionChange('y', Number(e.target.value))}
                            className="flex-1 px-2 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                    </div>
                </div>
            </div>

            {/* Size */}
            <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    크기
                </label>
                <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground w-4">W</span>
                        <input
                            type="number"
                            value={typeof size.width === 'number' ? size.width : ''}
                            onChange={(e) => handleSizeChange('width', Number(e.target.value))}
                            className="flex-1 px-2 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                            placeholder="auto"
                        />
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground w-4">H</span>
                        <input
                            type="number"
                            value={typeof size.height === 'number' ? size.height : ''}
                            onChange={(e) => handleSizeChange('height', Number(e.target.value))}
                            className="flex-1 px-2 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                            placeholder="auto"
                        />
                    </div>
                </div>
            </div>

            {/* Padding */}
            <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    안쪽 여백
                </label>
                <div className="grid grid-cols-4 gap-1">
                    {[
                        { key: 'paddingTop', icon: ArrowUp },
                        { key: 'paddingRight', icon: ArrowRight },
                        { key: 'paddingBottom', icon: ArrowDown },
                        { key: 'paddingLeft', icon: ArrowLeft },
                    ].map((padding) => {
                        const Icon = padding.icon;
                        return (
                            <div key={padding.key} className="relative">
                                <Icon className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                                <input
                                    type="number"
                                    value={style[padding.key] || 0}
                                    onChange={(e) => handleStyleChange(padding.key, Number(e.target.value))}
                                    className="w-full pl-7 pr-1 py-1.5 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                                    min={0}
                                />
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Layer Order */}
            <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    레이어 순서
                </label>
                <div className="flex gap-1">
                    <button
                        onClick={() => handleStyleChange('zIndex', (style.zIndex || 0) + 1)}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs bg-secondary text-muted-foreground hover:bg-muted rounded transition-colors"
                    >
                        <Layers className="h-3 w-3" />
                        앞으로
                    </button>
                    <button
                        onClick={() => handleStyleChange('zIndex', Math.max(0, (style.zIndex || 0) - 1))}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs bg-secondary text-muted-foreground hover:bg-muted rounded transition-colors"
                    >
                        <Layers className="h-3 w-3 rotate-180" />
                        뒤로
                    </button>
                </div>
            </div>
        </div>
    );
}

export default LayoutProperties;
