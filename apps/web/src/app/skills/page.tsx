'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SkillsGallery } from '@/components/skills/skills-gallery';
import { AppShell } from '@/components/layout/app-shell';
import { useAuthStore } from '@/stores/auth-store';

export default function SkillsPage() {
    const router = useRouter();
    const { hasHydrated, isAuthenticated } = useAuthStore();

    useEffect(() => {
        if (hasHydrated && !isAuthenticated) router.replace('/login');
    }, [hasHydrated, isAuthenticated, router]);

    if (!hasHydrated || !isAuthenticated) return <div className="min-h-screen bg-background" />;
    return <AppShell><SkillsGallery /></AppShell>;
}
