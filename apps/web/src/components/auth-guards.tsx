import { Navigate, Outlet } from 'react-router-dom';
import { isAdminRole, useAuthStore } from '@/stores/auth-store';

function AuthLoading() {
    return (
        <main className="grid min-h-screen place-items-center bg-background" aria-label="인증 확인 중">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
        </main>
    );
}

export function RequireAuth() {
    const { hasHydrated, isAuthenticated } = useAuthStore();

    if (!hasHydrated) return <AuthLoading />;
    if (!isAuthenticated) return <Navigate to="/login" replace />;
    return <Outlet />;
}

export function RequireAdmin() {
    const user = useAuthStore((state) => state.user);

    if (!isAdminRole(user?.role)) return <Navigate to="/dashboard" replace />;
    return <Outlet />;
}
