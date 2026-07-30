import { useEffect, useRef, type ReactNode } from 'react';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';

export function AuthBootstrap({ children }: { children: ReactNode }) {
    const started = useRef(false);

    useEffect(() => {
        if (started.current) return;
        started.current = true;

        void authApi
            .me()
            .then(({ data }) => useAuthStore.getState().setAuth(data))
            .catch(() => useAuthStore.getState().clearAuth())
            .finally(() => useAuthStore.getState().setHasHydrated(true));
    }, []);

    return children;
}
