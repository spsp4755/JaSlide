'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Minimize2, Maximize2 } from 'lucide-react';

/**
 * 포커스 모드 컴포넌트
 * 편집 영역만 강조하고 배경을 딤 처리하여 집중도를 향상시킵니다.
 */

interface FocusModeProps {
    isActive: boolean;
    onToggle: () => void;
    children: React.ReactNode;
    targetRef?: React.RefObject<HTMLElement>;
    dimOpacity?: number;
    blurAmount?: number;
}

export function FocusMode({
    isActive,
    onToggle,
    children,
    targetRef,
    dimOpacity = 0.7,
    blurAmount = 4,
}: FocusModeProps) {
    const [isAnimating, setIsAnimating] = useState(false);

    // ESC 키로 포커스 모드 해제
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isActive) {
                onToggle();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isActive, onToggle]);

    // 애니메이션 처리
    useEffect(() => {
        if (isActive) {
            setIsAnimating(true);
        } else {
            const timer = setTimeout(() => setIsAnimating(false), 300);
            return () => clearTimeout(timer);
        }
    }, [isActive]);

    if (!isActive && !isAnimating) {
        return <>{children}</>;
    }

    return (
        <>
            {/* 배경 딤 오버레이 */}
            <div
                className={`
                    fixed inset-0 z-40 transition-all duration-300
                    ${isActive ? 'opacity-100' : 'opacity-0 pointer-events-none'}
                `}
                style={{
                    backgroundColor: `rgba(0, 0, 0, ${dimOpacity})`,
                    backdropFilter: `blur(${blurAmount}px)`,
                }}
                onClick={onToggle}
            />

            {/* 포커스된 콘텐츠 */}
            <div
                className={`
                    relative z-50 transition-all duration-300
                    ${isActive ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}
                `}
            >
                {children}
            </div>

            {/* 포커스 모드 해제 힌트 */}
            {isActive && (
                <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-50 animate-fade-in">
                    <div className="flex items-center gap-2 px-4 py-2 bg-primary/90 text-primary-foreground text-sm rounded-full shadow-lg">
                        <span>ESC를 눌러 포커스 모드 종료</span>
                        <button
                            onClick={onToggle}
                            className="p-1 hover:bg-card/20 rounded-full transition-colors"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}

/**
 * 포커스 모드 토글 버튼
 */
interface FocusModeToggleProps {
    isActive: boolean;
    onToggle: () => void;
    className?: string;
}

export function FocusModeToggle({
    isActive,
    onToggle,
    className = '',
}: FocusModeToggleProps) {
    return (
        <button
            onClick={onToggle}
            className={`
                flex items-center gap-2 px-3 py-2 rounded-lg transition-all
                ${isActive
                    ? 'bg-purple-600 text-white'
                    : 'bg-secondary text-muted-foreground hover:bg-muted'
                }
                ${className}
            `}
            title={isActive ? '포커스 모드 해제' : '포커스 모드'}
        >
            {isActive ? (
                <Minimize2 className="h-4 w-4" />
            ) : (
                <Maximize2 className="h-4 w-4" />
            )}
            <span className="text-sm">{isActive ? '집중 해제' : '집중 모드'}</span>
        </button>
    );
}

/**
 * 포커스 모드 훅
 */
export function useFocusMode() {
    const [isActive, setIsActive] = useState(false);
    const [suppressNotifications, setSuppressNotifications] = useState(false);

    const toggle = useCallback(() => {
        setIsActive((prev) => !prev);
    }, []);

    const enable = useCallback(() => {
        setIsActive(true);
    }, []);

    const disable = useCallback(() => {
        setIsActive(false);
    }, []);

    // 포커스 모드 활성화 시 알림 차단
    useEffect(() => {
        if (isActive) {
            setSuppressNotifications(true);
        } else {
            // 포커스 모드 해제 후 1초 딜레이
            const timer = setTimeout(() => {
                setSuppressNotifications(false);
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, [isActive]);

    return {
        isActive,
        toggle,
        enable,
        disable,
        suppressNotifications,
    };
}

export default FocusMode;
