'use client';

import { useEditorStore } from '@/stores/editor-store';
import { Button } from '@/components/ui/button';
import { Undo2, Redo2 } from 'lucide-react';

interface UndoRedoButtonsProps {
    size?: 'sm' | 'default';
    showLabels?: boolean;
    onUndo?: () => void;
    onRedo?: () => void;
}

export function UndoRedoButtons({ size = 'sm', showLabels = false, onUndo, onRedo }: UndoRedoButtonsProps) {
    const { canUndo, canRedo, undo, redo } = useEditorStore();

    return (
        <div className="flex items-center gap-1">
            <Button
                variant="ghost"
                size={size}
                onClick={() => { undo(); onUndo?.(); }}
                disabled={!canUndo}
                title="실행 취소 (Ctrl+Z)"
                className={!canUndo ? 'opacity-50' : ''}
            >
                <Undo2 className="h-4 w-4" />
                {showLabels && <span className="ml-1">실행 취소</span>}
            </Button>
            <Button
                variant="ghost"
                size={size}
                onClick={() => { redo(); onRedo?.(); }}
                disabled={!canRedo}
                title="다시 실행 (Ctrl+Y)"
                className={!canRedo ? 'opacity-50' : ''}
            >
                <Redo2 className="h-4 w-4" />
                {showLabels && <span className="ml-1">다시 실행</span>}
            </Button>
        </div>
    );
}
