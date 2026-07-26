'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
    Command,
    Undo2,
    Redo2,
    Save,
    Download,
    Eye,
    Play,
    Pause,
    Settings,
    X,
    GripVertical,
} from 'lucide-react';

/**
 * 미니 컨트롤 패널 컴포넌트
 * 드래그 가능한 플로팅 UI로 주요 단축 명령을 제공합니다.
 */

interface MiniControlAction {
    id: string;
    icon: React.ElementType;
    label: string;
    shortcut?: string;
    onClick: () => void;
    disabled?: boolean;
}

interface MiniControlPanelProps {
    isVisible: boolean;
    onClose: () => void;
    actions: MiniControlAction[];
    position?: { x: number; y: number };
    onPositionChange?: (position: { x: number; y: number }) => void;
}

export function MiniControlPanel({
    isVisible,
    onClose,
    actions,
    position: initialPosition,
    onPositionChange,
}: MiniControlPanelProps) {
    const [position, setPosition] = useState(initialPosition || { x: 20, y: 100 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const panelRef = useRef<HTMLDivElement>(null);

    // 드래그 시작
    const handleDragStart = useCallback((e: React.MouseEvent) => {
        if (panelRef.current) {
            const rect = panelRef.current.getBoundingClientRect();
            setDragOffset({
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
            });
            setIsDragging(true);
        }
    }, []);

    // 드래그 중
    useEffect(() => {
        if (!isDragging) return;

        const handleMouseMove = (e: MouseEvent) => {
            const newX = Math.max(0, Math.min(window.innerWidth - 60, e.clientX - dragOffset.x));
            const newY = Math.max(0, Math.min(window.innerHeight - 200, e.clientY - dragOffset.y));
            setPosition({ x: newX, y: newY });
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            onPositionChange?.(position);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, dragOffset, position, onPositionChange]);

    // 키보드 단축키 처리
    useEffect(() => {
        if (!isVisible) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // Ctrl+Shift+K로 패널 토글
            if (e.ctrlKey && e.shiftKey && e.key === 'K') {
                e.preventDefault();
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isVisible, onClose]);

    if (!isVisible) return null;

    return (
        <div
            ref={panelRef}
            className="fixed z-50 bg-primary/95 backdrop-blur-sm rounded-xl shadow-2xl border border-gray-700 transition-opacity duration-200"
            style={{
                left: `${position.x}px`,
                top: `${position.y}px`,
                opacity: isDragging ? 0.8 : 1,
            }}
        >
            {/* 헤더 - 드래그 핸들 */}
            <div
                className="flex items-center justify-between px-3 py-2 border-b border-gray-700 cursor-move"
                onMouseDown={handleDragStart}
            >
                <div className="flex items-center gap-2 text-muted-foreground">
                    <GripVertical className="h-4 w-4" />
                    <span className="text-xs font-medium">빠른 명령</span>
                </div>
                <button
                    onClick={onClose}
                    className="p-1 hover:bg-gray-700 rounded transition-colors"
                >
                    <X className="h-3 w-3 text-muted-foreground" />
                </button>
            </div>

            {/* 액션 버튼들 */}
            <div className="p-2 space-y-1">
                {actions.map((action) => (
                    <button
                        key={action.id}
                        onClick={action.onClick}
                        disabled={action.disabled}
                        className={`
                            w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left
                            ${action.disabled
                                ? 'opacity-50 cursor-not-allowed'
                                : 'hover:bg-gray-700'
                            }
                        `}
                        title={action.shortcut ? `${action.label} (${action.shortcut})` : action.label}
                    >
                        <action.icon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-white flex-1">{action.label}</span>
                        {action.shortcut && (
                            <span className="text-xs text-muted-foreground bg-gray-700 px-1.5 py-0.5 rounded">
                                {action.shortcut}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* 하단 힌트 */}
            <div className="px-3 py-2 border-t border-gray-700">
                <p className="text-xs text-muted-foreground text-center">
                    Ctrl+Shift+K로 토글
                </p>
            </div>
        </div>
    );
}

/**
 * 미니 컨트롤 패널 훅
 */
export function useMiniControlPanel() {
    const [isVisible, setIsVisible] = useState(false);
    const [position, setPosition] = useState({ x: 20, y: 100 });

    // 저장된 위치 복원
    useEffect(() => {
        const savedPosition = localStorage.getItem('jaslide_mini_control_position');
        if (savedPosition) {
            try {
                setPosition(JSON.parse(savedPosition));
            } catch {
                // 무시
            }
        }
    }, []);

    // 위치 저장
    const handlePositionChange = useCallback((newPosition: { x: number; y: number }) => {
        setPosition(newPosition);
        localStorage.setItem('jaslide_mini_control_position', JSON.stringify(newPosition));
    }, []);

    // 전역 단축키
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'K') {
                e.preventDefault();
                setIsVisible((prev) => !prev);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    return {
        isVisible,
        position,
        show: () => setIsVisible(true),
        hide: () => setIsVisible(false),
        toggle: () => setIsVisible((prev) => !prev),
        onPositionChange: handlePositionChange,
    };
}

/**
 * 기본 에디터 액션 생성
 */
export function createDefaultEditorActions(handlers: {
    onUndo?: () => void;
    onRedo?: () => void;
    onSave?: () => void;
    onExport?: () => void;
    onPreview?: () => void;
    onPlay?: () => void;
    onSettings?: () => void;
    canUndo?: boolean;
    canRedo?: boolean;
    isPlaying?: boolean;
}): MiniControlAction[] {
    return [
        {
            id: 'undo',
            icon: Undo2,
            label: '실행 취소',
            shortcut: 'Ctrl+Z',
            onClick: handlers.onUndo || (() => { }),
            disabled: !handlers.canUndo,
        },
        {
            id: 'redo',
            icon: Redo2,
            label: '다시 실행',
            shortcut: 'Ctrl+Y',
            onClick: handlers.onRedo || (() => { }),
            disabled: !handlers.canRedo,
        },
        {
            id: 'save',
            icon: Save,
            label: '저장',
            shortcut: 'Ctrl+S',
            onClick: handlers.onSave || (() => { }),
        },
        {
            id: 'export',
            icon: Download,
            label: '내보내기',
            shortcut: 'Ctrl+E',
            onClick: handlers.onExport || (() => { }),
        },
        {
            id: 'preview',
            icon: Eye,
            label: '미리보기',
            shortcut: 'Ctrl+P',
            onClick: handlers.onPreview || (() => { }),
        },
        {
            id: 'play',
            icon: handlers.isPlaying ? Pause : Play,
            label: handlers.isPlaying ? '발표 중지' : '발표 시작',
            shortcut: 'F5',
            onClick: handlers.onPlay || (() => { }),
        },
        {
            id: 'settings',
            icon: Settings,
            label: '설정',
            onClick: handlers.onSettings || (() => { }),
        },
    ];
}

export default MiniControlPanel;
