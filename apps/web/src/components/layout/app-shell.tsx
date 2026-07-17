'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore, isAdminRole } from '@/stores/auth-store';
import { authApi } from '@/lib/api';
import { Plus, Home, FolderOpen, Settings, Shield, LogOut, Sparkles, BookOpen } from 'lucide-react';

const NAV_ITEMS = [
    { href: '/dashboard', label: '홈', icon: Home },
    { href: '/skills', label: 'Skills', icon: BookOpen },
    { href: '/presentations', label: '내 발표함', icon: FolderOpen },
    { href: '/settings', label: '설정', icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const { user, clearAuth } = useAuthStore();

    const handleLogout = async () => {
        try {
            await authApi.logout();
        } catch {
            // ignore; clear local state regardless
        } finally {
            clearAuth();
            router.push('/');
        }
    };

    return (
        <div className="min-h-screen flex bg-background">
            <aside className="w-56 flex-shrink-0 border-r border-border bg-card flex flex-col">
                <Link href="/dashboard" className="flex items-center gap-2 px-4 py-4 border-b">
                    <Sparkles className="h-6 w-6 text-foreground" />
                    <span className="text-lg font-bold font-display tracking-tight">JaSlide</span>
                </Link>

                <div className="p-3">
                    <Link
                        href="/dashboard?focus=1"
                        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-foreground text-background hover:opacity-85 transition-opacity text-sm font-medium"
                    >
                        <Plus className="h-4 w-4" />
                        새로 만들기
                    </Link>
                </div>

                <nav className="flex-1 px-3 space-y-1">
                    {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
                        <Link
                            key={href}
                            href={href}
                            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${
                                pathname === href
                                    ? 'bg-secondary text-foreground font-medium'
                                    : 'text-muted-foreground hover:bg-secondary'
                            }`}
                        >
                            <Icon className="h-4 w-4" />
                            {label}
                        </Link>
                    ))}
                    {isAdminRole(user?.role) && (
                        <Link
                            href="/admin"
                            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-secondary"
                        >
                            <Shield className="h-4 w-4" />
                            관리자
                        </Link>
                    )}
                </nav>

                <div className="p-3 border-t">
                    <div className="flex items-center gap-2 px-3 py-2">
                        <div className="w-8 h-8 bg-secondary rounded-full flex items-center justify-center flex-shrink-0">
                            <span className="text-foreground font-medium text-sm">
                                {user?.name?.[0] || user?.email?.[0] || 'U'}
                            </span>
                        </div>
                        <span className="text-sm text-foreground truncate">{user?.name || user?.email}</span>
                    </div>
                    <button
                        onClick={handleLogout}
                        className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50"
                    >
                        <LogOut className="h-4 w-4" />
                        로그아웃
                    </button>
                </div>
            </aside>

            <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
        </div>
    );
}
