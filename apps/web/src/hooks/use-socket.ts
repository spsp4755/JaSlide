'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '@/stores/auth-store';

interface UseSocketOptions {
    presentationId: string;
    onSlideUpdated?: (data: { slideId: string; changes: any; updatedBy: string }) => void;
    onSlidesReordered?: (data: { slideIds: string[]; reorderedBy: string }) => void;
    onUserJoined?: (data: { socketId: string; userId: string; userName: string }) => void;
    onUserLeft?: (data: { socketId: string }) => void;
    onUserSelectedSlide?: (data: { socketId: string; slideId: string }) => void;
    onCursorMoved?: (data: { socketId: string; x: number; y: number }) => void;
}

export function useSocket(options: UseSocketOptions) {
    const { presentationId, onSlideUpdated, onSlidesReordered, onUserJoined, onUserLeft, onUserSelectedSlide, onCursorMoved } = options;
    const { user } = useAuthStore();
    const socketRef = useRef<Socket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [activeUsers, setActiveUsers] = useState<number>(0);

    useEffect(() => {
        if (!presentationId) return;

        // Connect to WebSocket server
        const apiOrigin = (import.meta.env.VITE_API_URL || '/api').replace(/\/api\/?$/, '') || window.location.origin;
        const socket = io(`${apiOrigin}/presentations`, {
            transports: ['websocket', 'polling'],
        });

        socketRef.current = socket;

        socket.on('connect', () => {
            setIsConnected(true);
            // Join presentation room
            socket.emit('join-presentation', {
                presentationId,
                userId: user?.id,
                userName: user?.name,
            });
        });

        socket.on('disconnect', () => {
            setIsConnected(false);
        });

        socket.on('joined', (data) => {
            setActiveUsers(data.users);
        });

        socket.on('user-joined', (data) => {
            setActiveUsers((prev) => prev + 1);
            onUserJoined?.(data);
        });

        socket.on('user-left', (data) => {
            setActiveUsers((prev) => Math.max(0, prev - 1));
            onUserLeft?.(data);
        });

        socket.on('slide-updated', (data) => {
            onSlideUpdated?.(data);
        });

        socket.on('slides-reordered', (data) => {
            onSlidesReordered?.(data);
        });

        socket.on('user-selected-slide', (data) => {
            onUserSelectedSlide?.(data);
        });

        socket.on('cursor-moved', (data) => {
            onCursorMoved?.(data);
        });

        return () => {
            socket.emit('leave-presentation', { presentationId });
            socket.disconnect();
        };
    }, [presentationId, user?.id, user?.name]);

    const emitSlideUpdate = useCallback((slideId: string, changes: any) => {
        socketRef.current?.emit('slide-update', {
            presentationId,
            slideId,
            changes,
        });
    }, [presentationId]);

    const emitSlideReorder = useCallback((slideIds: string[]) => {
        socketRef.current?.emit('slide-reorder', {
            presentationId,
            slideIds,
        });
    }, [presentationId]);

    const emitSlideSelect = useCallback((slideId: string) => {
        socketRef.current?.emit('slide-select', {
            presentationId,
            slideId,
        });
    }, [presentationId]);

    const emitCursorMove = useCallback((x: number, y: number) => {
        socketRef.current?.emit('cursor-move', {
            presentationId,
            x,
            y,
        });
    }, [presentationId]);

    return {
        isConnected,
        activeUsers,
        emitSlideUpdate,
        emitSlideReorder,
        emitSlideSelect,
        emitCursorMove,
    };
}
