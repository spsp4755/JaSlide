'use client';

import { useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSettingsStore } from '@/stores/settings-store';

interface ShortcutAction {
    key: string;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    action: () => void;
    description: string;
}

interface UseKeyboardShortcutsOptions {
    onSave?: () => void;
    onUndo?: () => void;
    onRedo?: () => void;
    onDuplicate?: () => void;
    onDelete?: () => void;
    onPrevSlide?: () => void;
    onNextSlide?: () => void;
    onNewPresentation?: () => void;
}

export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions = {}) {
    const router = useRouter();
    const { settings } = useSettingsStore();

    const handleKeyDown = useCallback(
        (event: KeyboardEvent) => {
            // Skip if shortcuts are disabled
            if (!settings.shortcuts.enabled) return;

            // Skip if user is typing in an input/textarea
            const target = event.target as HTMLElement;
            if (
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.isContentEditable
            ) {
                // But allow Ctrl+S for save even in inputs
                if (!(event.ctrlKey && event.key === 's')) {
                    return;
                }
            }

            const shortcuts: ShortcutAction[] = [
                {
                    key: 'n',
                    ctrlKey: true,
                    action: () => {
                        if (options.onNewPresentation) {
                            options.onNewPresentation();
                        } else {
                            router.push('/dashboard');
                        }
                    },
                    description: 'New Presentation',
                },
                {
                    key: 's',
                    ctrlKey: true,
                    action: () => options.onSave?.(),
                    description: 'Save',
                },
                {
                    key: 'z',
                    ctrlKey: true,
                    action: () => options.onUndo?.(),
                    description: 'Undo',
                },
                {
                    key: 'y',
                    ctrlKey: true,
                    action: () => options.onRedo?.(),
                    description: 'Redo',
                },
                {
                    key: 'z',
                    ctrlKey: true,
                    shiftKey: true,
                    action: () => options.onRedo?.(),
                    description: 'Redo (alternative)',
                },
                {
                    key: 'd',
                    ctrlKey: true,
                    action: () => options.onDuplicate?.(),
                    description: 'Duplicate Slide',
                },
                {
                    key: 'Delete',
                    action: () => options.onDelete?.(),
                    description: 'Delete Slide',
                },
                {
                    key: 'ArrowLeft',
                    action: () => options.onPrevSlide?.(),
                    description: 'Previous Slide',
                },
                {
                    key: 'ArrowRight',
                    action: () => options.onNextSlide?.(),
                    description: 'Next Slide',
                },
            ];

            for (const shortcut of shortcuts) {
                const matchesKey = event.key.toLowerCase() === shortcut.key.toLowerCase();
                const matchesCtrl = !!shortcut.ctrlKey === event.ctrlKey;
                const matchesShift = !!shortcut.shiftKey === event.shiftKey;
                const matchesAlt = !!shortcut.altKey === event.altKey;

                if (matchesKey && matchesCtrl && matchesShift && matchesAlt) {
                    event.preventDefault();
                    shortcut.action();
                    return;
                }
            }
        },
        [settings.shortcuts.enabled, options, router]
    );

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    return {
        shortcutsEnabled: settings.shortcuts.enabled,
    };
}
