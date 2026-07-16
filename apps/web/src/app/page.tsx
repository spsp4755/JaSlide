'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';

// ponytail: marketing landing removed — root goes straight to login (or home when signed in)
export default function RootPage() {
    const router = useRouter();
    const { isAuthenticated, hasHydrated } = useAuthStore();

    useEffect(() => {
        if (!hasHydrated) return;
        router.replace(isAuthenticated ? '/dashboard' : '/login');
    }, [hasHydrated, isAuthenticated, router]);

    return (
        <div className="min-h-screen bg-background flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground"></div>
        </div>
    );
}
