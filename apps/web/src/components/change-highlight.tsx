'use client';

import { useEffect, useState } from 'react';

interface ChangeHighlightProps {
    children: React.ReactNode;
    isChanged?: boolean;
    changeType?: 'added' | 'modified' | 'removed';
    highlightDuration?: number;
}

export function ChangeHighlight({
    children,
    isChanged = false,
    changeType = 'modified',
    highlightDuration = 3000,
}: ChangeHighlightProps) {
    const [showHighlight, setShowHighlight] = useState(isChanged);

    useEffect(() => {
        if (isChanged) {
            setShowHighlight(true);
            const timer = setTimeout(() => {
                setShowHighlight(false);
            }, highlightDuration);
            return () => clearTimeout(timer);
        }
    }, [isChanged, highlightDuration]);

    const highlightColors = {
        added: 'ring-green-400 bg-green-50',
        modified: 'ring-yellow-400 bg-yellow-50',
        removed: 'ring-red-400 bg-red-50',
    };

    const indicatorColors = {
        added: 'bg-green-500',
        modified: 'bg-yellow-500',
        removed: 'bg-red-500',
    };

    const indicatorLabels = {
        added: '추가됨',
        modified: '수정됨',
        removed: '삭제됨',
    };

    return (
        <div className="relative">
            <div
                className={`
                    transition-all duration-300
                    ${showHighlight ? `ring-2 ${highlightColors[changeType]} rounded-lg` : ''}
                `}
            >
                {children}
            </div>

            {/* Change indicator badge */}
            {showHighlight && (
                <div
                    className={`
                        absolute -top-2 -right-2 px-2 py-0.5 rounded-full text-xs text-white font-medium
                        ${indicatorColors[changeType]}
                        animate-in fade-in-0 zoom-in-95
                    `}
                >
                    {indicatorLabels[changeType]}
                </div>
            )}
        </div>
    );
}

// Hook for tracking changes
export function useChangeTracking<T>(initialValue: T) {
    const [value, setValue] = useState<T>(initialValue);
    const [previousValue, setPreviousValue] = useState<T>(initialValue);
    const [hasChanged, setHasChanged] = useState(false);

    const updateValue = (newValue: T) => {
        setPreviousValue(value);
        setValue(newValue);
        setHasChanged(true);

        setTimeout(() => {
            setHasChanged(false);
        }, 3000);
    };

    return {
        value,
        previousValue,
        hasChanged,
        updateValue,
        clearChange: () => setHasChanged(false),
    };
}

// Diff visualization for text changes
interface TextDiffProps {
    oldText: string;
    newText: string;
    className?: string;
}

export function TextDiff({ oldText, newText, className = '' }: TextDiffProps) {
    // Simple word-level diff
    const oldWords = oldText.split(/\s+/);
    const newWords = newText.split(/\s+/);

    const diff: { word: string; type: 'same' | 'added' | 'removed' }[] = [];

    let i = 0;
    let j = 0;

    while (i < oldWords.length || j < newWords.length) {
        if (i >= oldWords.length) {
            diff.push({ word: newWords[j], type: 'added' });
            j++;
        } else if (j >= newWords.length) {
            diff.push({ word: oldWords[i], type: 'removed' });
            i++;
        } else if (oldWords[i] === newWords[j]) {
            diff.push({ word: oldWords[i], type: 'same' });
            i++;
            j++;
        } else {
            // Check if word was added or removed
            const foundInNew = newWords.slice(j).indexOf(oldWords[i]);
            const foundInOld = oldWords.slice(i).indexOf(newWords[j]);

            if (foundInNew > 0 && (foundInOld < 0 || foundInNew < foundInOld)) {
                diff.push({ word: newWords[j], type: 'added' });
                j++;
            } else {
                diff.push({ word: oldWords[i], type: 'removed' });
                i++;
            }
        }
    }

    return (
        <div className={`text-sm ${className}`}>
            {diff.map((item, index) => (
                <span
                    key={index}
                    className={`
                        ${item.type === 'added' ? 'bg-green-100 text-green-800' : ''}
                        ${item.type === 'removed' ? 'bg-red-100 text-red-800 line-through' : ''}
                        ${item.type === 'same' ? 'text-foreground' : ''}
                    `}
                >
                    {item.word}{' '}
                </span>
            ))}
        </div>
    );
}
