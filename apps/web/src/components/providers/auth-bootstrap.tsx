import { useEffect, useRef, type ReactNode } from 'react';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';

export function AuthBootstrap({ children }: { children: ReactNode }) {
    const started = useRef(false);

    useEffect(() => {
        if (started.current) return;
        started.current = true;

        // completeBootstrap already drops a stale response by comparing generation
        // numbers, so this never needs to physically cancel the in-flight request —
        // aborting it while a real submit (e.g. login) is also in flight risked the
        // browser tearing down a connection the other request was about to reuse.
        const generation = useAuthStore.getState().authGeneration;
        void authApi
            .me()
            .then(({ data }) => useAuthStore.getState().completeBootstrap(data, generation))
            .catch(() => useAuthStore.getState().completeBootstrap(null, generation));
    }, []);

    return children;
}
