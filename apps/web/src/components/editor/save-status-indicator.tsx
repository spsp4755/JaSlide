'use client';

import { useState, useEffect } from 'react';
import { CheckCircle2, Loader2, CloudOff, AlertCircle } from 'lucide-react';
import { autoSaveService } from '@/lib/auto-save-service';

type SaveStatus = 'saved' | 'saving' | 'pending' | 'error' | 'offline';

interface SaveStatusIndicatorProps {
    presentationId: string;
    isDirty?: boolean;
}

export function SaveStatusIndicator({ presentationId, isDirty = false }: SaveStatusIndicatorProps) {
    const [status, setStatus] = useState<SaveStatus>('saved');
    const [lastSaved, setLastSaved] = useState<Date | null>(null);
    const [isOnline, setIsOnline] = useState(true);

    useEffect(() => {
        // Check online status
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        setIsOnline(navigator.onLine);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    useEffect(() => {
        // Update status based on save service
        const checkStatus = () => {
            if (!isOnline) {
                setStatus('offline');
                return;
            }

            const isSaving = autoSaveService.isSavingPresentation(presentationId);
            const isPending = autoSaveService.isDirty(presentationId);

            if (isSaving) {
                setStatus('saving');
            } else if (isPending || isDirty) {
                setStatus('pending');
            } else {
                setStatus('saved');
                setLastSaved(new Date());
            }
        };

        checkStatus();
        const interval = setInterval(checkStatus, 1000);
        return () => clearInterval(interval);
    }, [presentationId, isDirty, isOnline]);

    const getStatusDisplay = () => {
        switch (status) {
            case 'saved':
                return {
                    icon: <CheckCircle2 className="h-4 w-4 text-green-500" />,
                    text: lastSaved ? `저장됨 ${formatTime(lastSaved)}` : '저장됨',
                    className: 'text-green-600',
                };
            case 'saving':
                return {
                    icon: <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />,
                    text: '저장 중...',
                    className: 'text-blue-600',
                };
            case 'pending':
                return {
                    icon: <div className="h-2 w-2 bg-yellow-500 rounded-full animate-pulse" />,
                    text: '저장 대기 중',
                    className: 'text-yellow-600',
                };
            case 'error':
                return {
                    icon: <AlertCircle className="h-4 w-4 text-red-500" />,
                    text: '저장 실패',
                    className: 'text-red-600',
                };
            case 'offline':
                return {
                    icon: <CloudOff className="h-4 w-4 text-muted-foreground" />,
                    text: '오프라인',
                    className: 'text-muted-foreground',
                };
        }
    };

    const formatTime = (date: Date): string => {
        const now = new Date();
        const diff = Math.floor((now.getTime() - date.getTime()) / 1000);

        if (diff < 5) return '';
        if (diff < 60) return `${diff}초 전`;
        if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
        return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    };

    const display = getStatusDisplay();

    return (
        <div className={`flex items-center gap-1.5 text-xs ${display.className}`}>
            {display.icon}
            <span>{display.text}</span>
        </div>
    );
}

export default SaveStatusIndicator;
