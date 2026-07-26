'use client';

import { useRef, useState } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import {
    Layout,
    Type,
    List,
    Image as ImageIcon,
    BarChart2,
    Quote,
    MoreVertical,
    Copy,
    Trash2,
    Eye,
    EyeOff,
    Lock,
    CheckSquare,
    Square,
} from 'lucide-react';

// Slide type icons mapping
const slideTypeIcons: Record<string, any> = {
    TITLE: Type,
    CONTENT: Layout,
    BULLET_LIST: List,
    TWO_COLUMN: Layout,
    IMAGE: ImageIcon,
    CHART: BarChart2,
    QUOTE: Quote,
    SECTION_HEADER: Type,
};

interface SlideData {
    id: string;
    order: number;
    type: string;
    title?: string;
    content: any;
    layout?: string;
    isHidden?: boolean;
    isLocked?: boolean;
}

interface SlideThumbnailProps {
    slide: SlideData;
    index: number;
    isSelected: boolean;
    isMultiSelected?: boolean;
    onSelect: (shiftKey?: boolean, ctrlKey?: boolean) => void;
    onMove: (from: number, to: number) => void;
    onDuplicate?: () => void;
    onDelete?: () => void;
    onToggleVisibility?: () => void;
    showMultiSelect?: boolean;
}

export function SlideThumbnail({
    slide,
    index,
    isSelected,
    isMultiSelected = false,
    onSelect,
    onMove,
    onDuplicate,
    onDelete,
    onToggleVisibility,
    showMultiSelect = false,
}: SlideThumbnailProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [showContextMenu, setShowContextMenu] = useState(false);

    const [{ isDragging }, drag] = useDrag({
        type: 'SLIDE',
        item: { index },
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
        }),
    });

    const [{ isOver }, drop] = useDrop({
        accept: 'SLIDE',
        hover: (item: { index: number }) => {
            if (item.index !== index) {
                onMove(item.index, index);
                item.index = index;
            }
        },
        collect: (monitor) => ({
            isOver: monitor.isOver(),
        }),
    });

    // Combine refs
    drag(drop(ref));

    const Icon = slideTypeIcons[slide.type] || Layout;
    const content = slide.content || {};
    const heading = content.heading || slide.title || 'Untitled';

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onSelect(e.shiftKey, e.ctrlKey || e.metaKey);
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        setShowContextMenu(true);
    };

    const handleContextAction = (action: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setShowContextMenu(false);

        switch (action) {
            case 'duplicate':
                onDuplicate?.();
                break;
            case 'delete':
                onDelete?.();
                break;
            case 'visibility':
                onToggleVisibility?.();
                break;
        }
    };

    return (
        <div
            ref={ref}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            className={`
                slide-panel group relative p-2 cursor-move transition-all
                ${isSelected ? 'ring-2 ring-purple-500 bg-purple-50' : ''}
                ${isMultiSelected ? 'ring-2 ring-blue-400 bg-blue-50' : ''}
                ${isDragging ? 'opacity-50 scale-95' : ''}
                ${isOver ? 'border-t-2 border-purple-400' : ''}
                ${slide.isHidden ? 'opacity-60' : ''}
            `}
        >
            {/* Multi-select checkbox */}
            {showMultiSelect && (
                <div className="absolute top-1 left-1 z-10">
                    {isMultiSelected ? (
                        <CheckSquare className="h-4 w-4 text-blue-500" />
                    ) : (
                        <Square className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                </div>
            )}

            {/* Status indicators */}
            <div className="absolute top-1 right-1 flex gap-1">
                {slide.isHidden && (
                    <span title="숨김">
                        <EyeOff className="h-3 w-3 text-muted-foreground" />
                    </span>
                )}
                {slide.isLocked && (
                    <span title="잠김">
                        <Lock className="h-3 w-3 text-orange-400" />
                    </span>
                )}
            </div>

            {/* Thumbnail preview */}
            <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-50 rounded flex items-center justify-center mb-2 overflow-hidden">
                <div className="text-center p-2">
                    <Icon className="h-6 w-6 text-muted-foreground mx-auto mb-1" />
                    <p className="text-[8px] text-muted-foreground line-clamp-2 leading-tight">
                        {heading}
                    </p>
                </div>
            </div>

            {/* Slide info */}
            <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground truncate flex-1">
                    {index + 1}. {slide.title || heading}
                </span>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setShowContextMenu(!showContextMenu);
                    }}
                    className="p-1 hover:bg-secondary rounded opacity-0 group-hover:opacity-100 transition-opacity"
                >
                    <MoreVertical className="h-3 w-3 text-muted-foreground" />
                </button>
            </div>

            {/* Context menu */}
            {showContextMenu && (
                <>
                    <div
                        className="fixed inset-0 z-40"
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowContextMenu(false);
                        }}
                    />
                    <div className="absolute right-0 top-full mt-1 w-36 bg-card rounded-lg shadow-lg border p-1 z-50">
                        <button
                            onClick={(e) => handleContextAction('duplicate', e)}
                            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-secondary rounded text-sm text-left"
                        >
                            <Copy className="h-3 w-3" />
                            복제
                        </button>
                        <button
                            onClick={(e) => handleContextAction('visibility', e)}
                            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-secondary rounded text-sm text-left"
                        >
                            {slide.isHidden ? (
                                <>
                                    <Eye className="h-3 w-3" />
                                    표시
                                </>
                            ) : (
                                <>
                                    <EyeOff className="h-3 w-3" />
                                    숨기기
                                </>
                            )}
                        </button>
                        <div className="border-t my-1" />
                        <button
                            onClick={(e) => handleContextAction('delete', e)}
                            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-red-50 rounded text-sm text-left text-red-600"
                        >
                            <Trash2 className="h-3 w-3" />
                            삭제
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

export default SlideThumbnail;
