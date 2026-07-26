'use client';

import { useState, useCallback } from 'react';
import {
    Layers,
    Eye,
    EyeOff,
    Lock,
    Unlock,
    Trash2,
    Copy,
    ChevronDown,
    ChevronRight,
    GripVertical,
    Type,
    Image,
    Square,
    BarChart2,
    Table,
    Star,
} from 'lucide-react';

interface LayerPanelProps {
    layers: Layer[];
    selectedLayerId: string | null;
    onSelectLayer: (id: string) => void;
    onReorderLayers: (fromIndex: number, toIndex: number) => void;
    onToggleVisibility: (id: string) => void;
    onToggleLock: (id: string) => void;
    onDeleteLayer: (id: string) => void;
    onDuplicateLayer: (id: string) => void;
}

export interface Layer {
    id: string;
    name: string;
    type: 'TEXT' | 'IMAGE' | 'SHAPE' | 'CHART' | 'TABLE' | 'ICON' | 'GROUP';
    visible: boolean;
    locked: boolean;
    children?: Layer[];
    parentId?: string;
}

// 레이어 타입별 아이콘
const LayerIcons: Record<Layer['type'], any> = {
    TEXT: Type,
    IMAGE: Image,
    SHAPE: Square,
    CHART: BarChart2,
    TABLE: Table,
    ICON: Star,
    GROUP: Layers,
};

interface LayerItemProps {
    layer: Layer;
    depth: number;
    isSelected: boolean;
    dragIndex: number | null;
    onSelect: () => void;
    onToggleVisibility: () => void;
    onToggleLock: () => void;
    onDragStart: (index: number) => void;
    onDragOver: (index: number) => void;
    onDragEnd: () => void;
    index: number;
    expandedGroups: Set<string>;
    onToggleGroup: (id: string) => void;
}

function LayerItem({
    layer,
    depth,
    isSelected,
    dragIndex,
    onSelect,
    onToggleVisibility,
    onToggleLock,
    onDragStart,
    onDragOver,
    onDragEnd,
    index,
    expandedGroups,
    onToggleGroup,
}: LayerItemProps) {
    const Icon = LayerIcons[layer.type] || Square;
    const isGroup = layer.type === 'GROUP';
    const isExpanded = expandedGroups.has(layer.id);
    const isDragging = dragIndex === index;

    return (
        <div
            draggable
            onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                onDragStart(index);
            }}
            onDragOver={(e) => {
                e.preventDefault();
                onDragOver(index);
            }}
            onDragEnd={onDragEnd}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            className={`flex items-center gap-1 py-1.5 pr-2 rounded transition-colors cursor-pointer group ${isDragging ? 'opacity-50 bg-purple-50' : ''
                } ${isSelected
                    ? 'bg-purple-100 text-purple-800'
                    : 'hover:bg-secondary text-foreground'
                }`}
            onClick={onSelect}
        >
            {/* 드래그 핸들 */}
            <div className="p-0.5 cursor-grab hover:bg-muted rounded">
                <GripVertical className="h-3 w-3 text-muted-foreground" />
            </div>

            {/* 그룹 확장/축소 */}
            {isGroup && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleGroup(layer.id);
                    }}
                    className="p-0.5"
                >
                    {isExpanded ? (
                        <ChevronDown className="h-3 w-3" />
                    ) : (
                        <ChevronRight className="h-3 w-3" />
                    )}
                </button>
            )}

            {/* 타입 아이콘 */}
            <Icon className="h-4 w-4 flex-shrink-0" />

            {/* 레이어 이름 */}
            <span className="flex-1 text-xs truncate min-w-0">
                {layer.name}
            </span>

            {/* 컨트롤 버튼 */}
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {/* 가시성 토글 */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleVisibility();
                    }}
                    className={`p-1 rounded hover:bg-muted ${layer.visible ? 'text-muted-foreground' : 'text-muted-foreground'
                        }`}
                    title={layer.visible ? '숨기기' : '보이기'}
                >
                    {layer.visible ? (
                        <Eye className="h-3 w-3" />
                    ) : (
                        <EyeOff className="h-3 w-3" />
                    )}
                </button>

                {/* 잠금 토글 */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleLock();
                    }}
                    className={`p-1 rounded hover:bg-muted ${layer.locked ? 'text-amber-500' : 'text-muted-foreground'
                        }`}
                    title={layer.locked ? '잠금 해제' : '잠금'}
                >
                    {layer.locked ? (
                        <Lock className="h-3 w-3" />
                    ) : (
                        <Unlock className="h-3 w-3" />
                    )}
                </button>
            </div>
        </div>
    );
}

export function LayerPanel({
    layers,
    selectedLayerId,
    onSelectLayer,
    onReorderLayers,
    onToggleVisibility,
    onToggleLock,
    onDeleteLayer,
    onDuplicateLayer,
}: LayerPanelProps) {
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [dropIndex, setDropIndex] = useState<number | null>(null);

    const toggleGroup = (id: string) => {
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const handleDragStart = (index: number) => {
        setDragIndex(index);
    };

    const handleDragOver = (index: number) => {
        setDropIndex(index);
    };

    const handleDragEnd = () => {
        if (dragIndex !== null && dropIndex !== null && dragIndex !== dropIndex) {
            onReorderLayers(dragIndex, dropIndex);
        }
        setDragIndex(null);
        setDropIndex(null);
    };

    // 레이어를 평탄화 (그룹 포함)
    const flattenLayers = useCallback((items: Layer[], depth = 0): { layer: Layer; depth: number }[] => {
        const result: { layer: Layer; depth: number }[] = [];

        items.forEach(item => {
            result.push({ layer: item, depth });
            if (item.type === 'GROUP' && item.children && expandedGroups.has(item.id)) {
                result.push(...flattenLayers(item.children, depth + 1));
            }
        });

        return result;
    }, [expandedGroups]);

    const flatLayers = flattenLayers(layers);
    const selectedLayer = layers.find(l => l.id === selectedLayerId);

    return (
        <div className="h-full flex flex-col bg-card border-l">
            {/* 헤더 */}
            <div className="flex items-center justify-between px-3 py-2 border-b">
                <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">레이어</span>
                    <span className="text-xs text-muted-foreground">({layers.length})</span>
                </div>
            </div>

            {/* 레이어 목록 */}
            <div className="flex-1 overflow-y-auto">
                {layers.length === 0 ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">
                        레이어가 없습니다
                    </div>
                ) : (
                    <div className="py-1">
                        {flatLayers.map(({ layer, depth }, index) => (
                            <LayerItem
                                key={layer.id}
                                layer={layer}
                                depth={depth}
                                index={index}
                                isSelected={selectedLayerId === layer.id}
                                dragIndex={dragIndex}
                                onSelect={() => onSelectLayer(layer.id)}
                                onToggleVisibility={() => onToggleVisibility(layer.id)}
                                onToggleLock={() => onToggleLock(layer.id)}
                                onDragStart={handleDragStart}
                                onDragOver={handleDragOver}
                                onDragEnd={handleDragEnd}
                                expandedGroups={expandedGroups}
                                onToggleGroup={toggleGroup}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* 선택된 레이어 액션 */}
            {selectedLayer && (
                <div className="border-t p-2 flex gap-1">
                    <button
                        onClick={() => onDuplicateLayer(selectedLayer.id)}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs bg-secondary hover:bg-muted rounded transition-colors"
                        title="복제"
                    >
                        <Copy className="h-3 w-3" />
                        복제
                    </button>
                    <button
                        onClick={() => onDeleteLayer(selectedLayer.id)}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded transition-colors"
                        title="삭제"
                    >
                        <Trash2 className="h-3 w-3" />
                        삭제
                    </button>
                </div>
            )}
        </div>
    );
}

export default LayerPanel;
