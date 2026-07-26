'use client';

import { useState, useCallback } from 'react';
import { Paintbrush, Copy, Check, X, Droplet, Type as TypeIcon, Layout as LayoutIcon } from 'lucide-react';

interface StyleCopierProps {
    onCopyStyle: () => void;
    onPasteStyle: () => void;
    copiedStyle: CopiedStyle | null;
    isActive: boolean;
    onActivate: () => void;
    onDeactivate: () => void;
}

export interface CopiedStyle {
    text?: TextStyle;
    fill?: FillStyle;
    layout?: LayoutStyle;
    timestamp: number;
}

interface TextStyle {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: string;
    color?: string;
    lineHeight?: number;
    letterSpacing?: number;
    textAlign?: string;
}

interface FillStyle {
    backgroundColor?: string;
    backgroundGradient?: string;
    opacity?: number;
    borderWidth?: number;
    borderStyle?: string;
    borderColor?: string;
    borderRadius?: number;
    boxShadow?: string;
}

interface LayoutStyle {
    textAlign?: string;
    alignItems?: string;
    paddingTop?: number;
    paddingRight?: number;
    paddingBottom?: number;
    paddingLeft?: number;
}

export function StyleCopier({
    onCopyStyle,
    onPasteStyle,
    copiedStyle,
    isActive,
    onActivate,
    onDeactivate,
}: StyleCopierProps) {
    const hasCopiedStyle = copiedStyle !== null;
    const [showDetails, setShowDetails] = useState(false);

    // 복사된 스타일 요약
    const getStyleSummary = () => {
        if (!copiedStyle) return null;

        const parts: string[] = [];
        if (copiedStyle.text) parts.push('텍스트');
        if (copiedStyle.fill) parts.push('채우기');
        if (copiedStyle.layout) parts.push('레이아웃');

        return parts.join(' + ');
    };

    return (
        <div className="space-y-3">
            {/* 메인 컨트롤 */}
            <div className="flex gap-2">
                {/* 스타일 복사 버튼 */}
                <button
                    onClick={onCopyStyle}
                    className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg border border-border hover:bg-secondary transition-colors"
                >
                    <Copy className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-foreground">스타일 복사</span>
                </button>

                {/* 스타일 적용 버튼 */}
                <button
                    onClick={onPasteStyle}
                    disabled={!hasCopiedStyle}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg border transition-colors ${hasCopiedStyle
                            ? 'border-purple-300 bg-purple-50 hover:bg-purple-100 text-purple-700'
                            : 'border-border bg-secondary text-muted-foreground cursor-not-allowed'
                        }`}
                >
                    <Paintbrush className="h-4 w-4" />
                    <span className="text-sm">스타일 적용</span>
                </button>
            </div>

            {/* 서식 복사 모드 (Format Painter) */}
            <div
                className={`p-3 rounded-lg border-2 transition-all ${isActive
                        ? 'border-purple-400 bg-purple-50'
                        : 'border-dashed border-border bg-secondary'
                    }`}
            >
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <Paintbrush className={`h-4 w-4 ${isActive ? 'text-purple-600' : 'text-muted-foreground'}`} />
                        <span className={`text-sm font-medium ${isActive ? 'text-purple-700' : 'text-muted-foreground'}`}>
                            서식 복사 모드
                        </span>
                    </div>
                    {isActive ? (
                        <button
                            onClick={onDeactivate}
                            className="p-1 rounded hover:bg-purple-100 text-purple-600"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    ) : (
                        <button
                            onClick={onActivate}
                            disabled={!hasCopiedStyle}
                            className={`px-2 py-1 text-xs rounded ${hasCopiedStyle
                                    ? 'bg-purple-600 text-white hover:bg-purple-700'
                                    : 'bg-gray-300 text-muted-foreground cursor-not-allowed'
                                }`}
                        >
                            활성화
                        </button>
                    )}
                </div>
                <p className="text-xs text-muted-foreground">
                    {isActive
                        ? '요소를 클릭하면 스타일이 적용됩니다'
                        : '스타일을 복사한 후 활성화하세요'}
                </p>
            </div>

            {/* 복사된 스타일 상세 */}
            {hasCopiedStyle && (
                <div className="space-y-2">
                    <button
                        onClick={() => setShowDetails(!showDetails)}
                        className="w-full flex items-center justify-between p-2 bg-secondary rounded-lg hover:bg-secondary transition-colors"
                    >
                        <div className="flex items-center gap-2">
                            <Check className="h-3.5 w-3.5 text-green-500" />
                            <span className="text-xs text-muted-foreground">
                                복사됨: {getStyleSummary()}
                            </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                            {showDetails ? '접기' : '자세히'}
                        </span>
                    </button>

                    {showDetails && (
                        <div className="p-3 bg-secondary rounded-lg space-y-3 text-xs">
                            {/* 텍스트 스타일 */}
                            {copiedStyle.text && (
                                <div>
                                    <div className="flex items-center gap-1 mb-1.5 text-muted-foreground font-medium">
                                        <TypeIcon className="h-3 w-3" />
                                        텍스트
                                    </div>
                                    <div className="grid grid-cols-2 gap-1 text-muted-foreground">
                                        {copiedStyle.text.fontFamily && (
                                            <span>폰트: {copiedStyle.text.fontFamily}</span>
                                        )}
                                        {copiedStyle.text.fontSize && (
                                            <span>크기: {copiedStyle.text.fontSize}px</span>
                                        )}
                                        {copiedStyle.text.color && (
                                            <div className="flex items-center gap-1">
                                                색상:
                                                <span
                                                    className="w-3 h-3 rounded border"
                                                    style={{ backgroundColor: copiedStyle.text.color }}
                                                />
                                            </div>
                                        )}
                                        {copiedStyle.text.fontWeight && (
                                            <span>굵기: {copiedStyle.text.fontWeight}</span>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* 채우기 스타일 */}
                            {copiedStyle.fill && (
                                <div>
                                    <div className="flex items-center gap-1 mb-1.5 text-muted-foreground font-medium">
                                        <Droplet className="h-3 w-3" />
                                        채우기
                                    </div>
                                    <div className="grid grid-cols-2 gap-1 text-muted-foreground">
                                        {copiedStyle.fill.backgroundColor && (
                                            <div className="flex items-center gap-1">
                                                배경:
                                                <span
                                                    className="w-3 h-3 rounded border"
                                                    style={{ backgroundColor: copiedStyle.fill.backgroundColor }}
                                                />
                                            </div>
                                        )}
                                        {copiedStyle.fill.borderRadius !== undefined && (
                                            <span>곡률: {copiedStyle.fill.borderRadius}px</span>
                                        )}
                                        {copiedStyle.fill.opacity !== undefined && (
                                            <span>투명도: {Math.round(copiedStyle.fill.opacity * 100)}%</span>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* 레이아웃 스타일 */}
                            {copiedStyle.layout && (
                                <div>
                                    <div className="flex items-center gap-1 mb-1.5 text-muted-foreground font-medium">
                                        <LayoutIcon className="h-3 w-3" />
                                        레이아웃
                                    </div>
                                    <div className="grid grid-cols-2 gap-1 text-muted-foreground">
                                        {copiedStyle.layout.textAlign && (
                                            <span>정렬: {copiedStyle.layout.textAlign}</span>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default StyleCopier;
