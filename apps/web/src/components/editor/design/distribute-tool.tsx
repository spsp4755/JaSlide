'use client';

import { useState } from 'react';
import {
    AlignStartHorizontal,
    AlignCenterHorizontal,
    AlignEndHorizontal,
    AlignStartVertical,
    AlignCenterVertical,
    AlignEndVertical,
    MoveHorizontal,
    MoveVertical,
    Maximize2,
} from 'lucide-react';

interface DistributeToolProps {
    selectedElements: ElementData[];
    onDistribute: (elements: ElementData[]) => void;
    containerBounds?: { width: number; height: number };
}

interface ElementData {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

type AlignType = 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom';
type DistributeType = 'horizontal' | 'vertical' | 'equal-spacing';

export function DistributeTool({
    selectedElements,
    onDistribute,
    containerBounds = { width: 960, height: 540 },
}: DistributeToolProps) {
    const [showSpacing, setShowSpacing] = useState(false);
    const isMultiple = selectedElements.length > 1;

    // 정렬 처리
    const handleAlign = (type: AlignType) => {
        if (selectedElements.length === 0) return;

        let elements = [...selectedElements];

        switch (type) {
            case 'left': {
                const minX = Math.min(...elements.map(e => e.x));
                elements = elements.map(e => ({ ...e, x: minX }));
                break;
            }
            case 'center-h': {
                if (isMultiple) {
                    const avgCenterX = elements.reduce((sum, e) => sum + e.x + e.width / 2, 0) / elements.length;
                    elements = elements.map(e => ({ ...e, x: avgCenterX - e.width / 2 }));
                } else {
                    const centerX = containerBounds.width / 2;
                    elements = elements.map(e => ({ ...e, x: centerX - e.width / 2 }));
                }
                break;
            }
            case 'right': {
                const maxX = Math.max(...elements.map(e => e.x + e.width));
                elements = elements.map(e => ({ ...e, x: maxX - e.width }));
                break;
            }
            case 'top': {
                const minY = Math.min(...elements.map(e => e.y));
                elements = elements.map(e => ({ ...e, y: minY }));
                break;
            }
            case 'center-v': {
                if (isMultiple) {
                    const avgCenterY = elements.reduce((sum, e) => sum + e.y + e.height / 2, 0) / elements.length;
                    elements = elements.map(e => ({ ...e, y: avgCenterY - e.height / 2 }));
                } else {
                    const centerY = containerBounds.height / 2;
                    elements = elements.map(e => ({ ...e, y: centerY - e.height / 2 }));
                }
                break;
            }
            case 'bottom': {
                const maxY = Math.max(...elements.map(e => e.y + e.height));
                elements = elements.map(e => ({ ...e, y: maxY - e.height }));
                break;
            }
        }

        onDistribute(elements);
    };

    // 분배 처리
    const handleDistribute = (type: DistributeType) => {
        if (selectedElements.length < 3 && type !== 'equal-spacing') return;

        let elements = [...selectedElements];

        switch (type) {
            case 'horizontal': {
                const sorted = [...elements].sort((a, b) => a.x - b.x);
                const first = sorted[0];
                const last = sorted[sorted.length - 1];
                const totalWidth = elements.reduce((sum, e) => sum + e.width, 0);
                const availableSpace = (last.x + last.width) - first.x - totalWidth;
                const gap = availableSpace / (elements.length - 1);

                let currentX = first.x;
                elements = sorted.map((e, idx) => {
                    if (idx === 0) return e;
                    currentX += sorted[idx - 1].width + gap;
                    return { ...e, x: currentX };
                });
                break;
            }
            case 'vertical': {
                const sorted = [...elements].sort((a, b) => a.y - b.y);
                const first = sorted[0];
                const last = sorted[sorted.length - 1];
                const totalHeight = elements.reduce((sum, e) => sum + e.height, 0);
                const availableSpace = (last.y + last.height) - first.y - totalHeight;
                const gap = availableSpace / (elements.length - 1);

                let currentY = first.y;
                elements = sorted.map((e, idx) => {
                    if (idx === 0) return e;
                    currentY += sorted[idx - 1].height + gap;
                    return { ...e, y: currentY };
                });
                break;
            }
            case 'equal-spacing': {
                // 컨테이너 내에서 균등 분배
                const horizontalGap = (containerBounds.width - elements.reduce((s, e) => s + e.width, 0)) / (elements.length + 1);
                const sortedH = [...elements].sort((a, b) => a.x - b.x);
                let currentX = horizontalGap;
                elements = sortedH.map(e => {
                    const newX = currentX;
                    currentX += e.width + horizontalGap;
                    return { ...e, x: newX };
                });
                break;
            }
        }

        onDistribute(elements);
    };

    const buttonClass = (disabled: boolean) =>
        `p-2 rounded transition-colors ${disabled
            ? 'bg-secondary text-muted-foreground cursor-not-allowed'
            : 'bg-secondary text-muted-foreground hover:bg-purple-100 hover:text-purple-600'
        }`;

    return (
        <div className="space-y-3">
            {/* 정렬 도구 */}
            <div>
                <span className="text-xs font-medium text-muted-foreground block mb-2">정렬</span>
                <div className="flex gap-1">
                    <button
                        onClick={() => handleAlign('left')}
                        disabled={selectedElements.length === 0}
                        className={buttonClass(selectedElements.length === 0)}
                        title="왼쪽 정렬"
                    >
                        <AlignStartHorizontal className="h-4 w-4" />
                    </button>
                    <button
                        onClick={() => handleAlign('center-h')}
                        disabled={selectedElements.length === 0}
                        className={buttonClass(selectedElements.length === 0)}
                        title="가로 중앙 정렬"
                    >
                        <AlignCenterHorizontal className="h-4 w-4" />
                    </button>
                    <button
                        onClick={() => handleAlign('right')}
                        disabled={selectedElements.length === 0}
                        className={buttonClass(selectedElements.length === 0)}
                        title="오른쪽 정렬"
                    >
                        <AlignEndHorizontal className="h-4 w-4" />
                    </button>
                    <div className="w-px bg-muted mx-1" />
                    <button
                        onClick={() => handleAlign('top')}
                        disabled={selectedElements.length === 0}
                        className={buttonClass(selectedElements.length === 0)}
                        title="상단 정렬"
                    >
                        <AlignStartVertical className="h-4 w-4" />
                    </button>
                    <button
                        onClick={() => handleAlign('center-v')}
                        disabled={selectedElements.length === 0}
                        className={buttonClass(selectedElements.length === 0)}
                        title="세로 중앙 정렬"
                    >
                        <AlignCenterVertical className="h-4 w-4" />
                    </button>
                    <button
                        onClick={() => handleAlign('bottom')}
                        disabled={selectedElements.length === 0}
                        className={buttonClass(selectedElements.length === 0)}
                        title="하단 정렬"
                    >
                        <AlignEndVertical className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* 분배 도구 */}
            <div>
                <span className="text-xs font-medium text-muted-foreground block mb-2">분배</span>
                <div className="flex gap-1">
                    <button
                        onClick={() => handleDistribute('horizontal')}
                        disabled={selectedElements.length < 3}
                        className={buttonClass(selectedElements.length < 3)}
                        title="가로 균등 분배 (3개 이상 선택 필요)"
                    >
                        <MoveHorizontal className="h-4 w-4" />
                    </button>
                    <button
                        onClick={() => handleDistribute('vertical')}
                        disabled={selectedElements.length < 3}
                        className={buttonClass(selectedElements.length < 3)}
                        title="세로 균등 분배 (3개 이상 선택 필요)"
                    >
                        <MoveVertical className="h-4 w-4" />
                    </button>
                    <button
                        onClick={() => handleDistribute('equal-spacing')}
                        disabled={selectedElements.length < 2}
                        className={buttonClass(selectedElements.length < 2)}
                        title="동일 간격 분배"
                    >
                        <Maximize2 className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* 선택 상태 표시 */}
            <div className="text-xs text-muted-foreground bg-secondary p-2 rounded">
                {selectedElements.length === 0
                    ? '요소를 선택하세요'
                    : selectedElements.length === 1
                        ? '1개 선택됨 (슬라이드 기준 정렬)'
                        : `${selectedElements.length}개 선택됨`}
            </div>
        </div>
    );
}

export default DistributeTool;
