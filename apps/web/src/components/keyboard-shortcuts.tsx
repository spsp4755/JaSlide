'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
    Keyboard,
    X,
    Command,
} from 'lucide-react';

interface ShortcutGroup {
    title: string;
    shortcuts: Shortcut[];
}

interface Shortcut {
    keys: string[];
    description: string;
    action?: () => void;
}

const SHORTCUTS: ShortcutGroup[] = [
    {
        title: '일반',
        shortcuts: [
            { keys: ['Ctrl', 'S'], description: '저장' },
            { keys: ['Ctrl', 'Z'], description: '실행 취소' },
            { keys: ['Ctrl', 'Shift', 'Z'], description: '다시 실행' },
            { keys: ['Ctrl', 'C'], description: '복사' },
            { keys: ['Ctrl', 'V'], description: '붙여넣기' },
            { keys: ['Ctrl', 'X'], description: '잘라내기' },
        ],
    },
    {
        title: '슬라이드',
        shortcuts: [
            { keys: ['PageUp'], description: '이전 슬라이드' },
            { keys: ['PageDown'], description: '다음 슬라이드' },
            { keys: ['Ctrl', 'N'], description: '새 슬라이드' },
            { keys: ['Ctrl', 'D'], description: '슬라이드 복제' },
            { keys: ['Delete'], description: '슬라이드 삭제' },
        ],
    },
    {
        title: '편집',
        shortcuts: [
            { keys: ['Ctrl', 'B'], description: '굵게' },
            { keys: ['Ctrl', 'I'], description: '기울임' },
            { keys: ['Ctrl', 'U'], description: '밑줄' },
            { keys: ['Ctrl', 'K'], description: '링크 추가' },
        ],
    },
    {
        title: '보기',
        shortcuts: [
            { keys: ['F5'], description: '프레젠테이션 시작' },
            { keys: ['Ctrl', '+'], description: '확대' },
            { keys: ['Ctrl', '-'], description: '축소' },
            { keys: ['Ctrl', '0'], description: '원래 크기' },
        ],
    },
];

interface KeyboardShortcutsProps {
    onClose?: () => void;
}

export function KeyboardShortcuts({ onClose }: KeyboardShortcutsProps) {
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-card rounded-xl shadow-2xl max-w-xl w-full max-h-[80vh] overflow-hidden animate-in">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-purple-50 to-pink-50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                            <Keyboard className="h-5 w-5 text-purple-600" />
                        </div>
                        <div>
                            <h2 className="font-bold text-foreground">키보드 단축키</h2>
                            <p className="text-sm text-muted-foreground">빠른 작업을 위한 단축키 모음</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-muted-foreground hover:text-muted-foreground hover:bg-secondary rounded-lg"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto max-h-[60vh]">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {SHORTCUTS.map((group) => (
                            <div key={group.title}>
                                <h3 className="font-medium text-foreground mb-3">{group.title}</h3>
                                <div className="space-y-2">
                                    {group.shortcuts.map((shortcut, index) => (
                                        <div
                                            key={index}
                                            className="flex items-center justify-between py-2"
                                        >
                                            <span className="text-sm text-muted-foreground">
                                                {shortcut.description}
                                            </span>
                                            <div className="flex items-center gap-1">
                                                {shortcut.keys.map((key, keyIndex) => (
                                                    <span key={keyIndex}>
                                                        <kbd className="px-2 py-1 bg-secondary border border-border rounded text-xs font-mono text-foreground">
                                                            {key}
                                                        </kbd>
                                                        {keyIndex < shortcut.keys.length - 1 && (
                                                            <span className="text-muted-foreground mx-0.5">+</span>
                                                        )}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t bg-secondary">
                    <p className="text-xs text-muted-foreground text-center">
                        <kbd className="px-1.5 py-0.5 bg-muted rounded text-muted-foreground font-mono">?</kbd>
                        를 눌러 언제든 이 도움말을 열 수 있습니다
                    </p>
                </div>
            </div>
        </div>
    );
}

// Hook for keyboard shortcut handling
export function useKeyboardShortcuts(shortcuts: Record<string, () => void>) {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const key = [];
            if (e.ctrlKey || e.metaKey) key.push('Ctrl');
            if (e.shiftKey) key.push('Shift');
            if (e.altKey) key.push('Alt');
            key.push(e.key.toUpperCase());

            const combo = key.join('+');
            if (shortcuts[combo]) {
                e.preventDefault();
                shortcuts[combo]();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [shortcuts]);
}

// Floating shortcut hint
export function ShortcutHint({ shortcut, className = '' }: { shortcut: string[]; className?: string }) {
    return (
        <div className={`inline-flex items-center gap-0.5 ${className}`}>
            {shortcut.map((key, index) => (
                <span key={index}>
                    <kbd className="px-1 py-0.5 bg-secondary border border-border rounded text-[10px] font-mono text-muted-foreground">
                        {key}
                    </kbd>
                    {index < shortcut.length - 1 && (
                        <span className="text-muted-foreground mx-0.5">+</span>
                    )}
                </span>
            ))}
        </div>
    );
}
