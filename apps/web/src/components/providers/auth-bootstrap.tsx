import { useEffect, useRef, type ReactNode } from 'react';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';

export function AuthBootstrap({ children }: { children: ReactNode }) {
    const started = useRef(false);

    useEffect(() => {
        if (started.current) return;
        started.current = true;

        const generation = useAuthStore.getState().authGeneration;
        const controller = new AbortController();
        const unsubscribe = useAuthStore.subscribe((state) => {
            if (state.authGeneration !== generation) controller.abort();
        });

        void authApi
            .me(controller.signal)
            .then(({ data }) => useAuthStore.getState().completeBootstrap(data, generation))
            .catch(() => useAuthStore.getState().completeBootstrap(null, generation))
            .finally(unsubscribe);
    }, []);

    return children;
}
