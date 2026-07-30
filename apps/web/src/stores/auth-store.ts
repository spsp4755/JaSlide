import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type UserRole = 'USER' | 'ADMIN' | 'ORG_ADMIN' | 'SYSTEM_ADMIN' | 'OPERATOR' | 'AUDITOR';

interface User {
    id: string;
    email: string;
    name: string | null;
    role: UserRole;
}

// Helper to determine if user has admin-level access
export const isAdminRole = (role?: UserRole | string): boolean =>
    ['ADMIN', 'SYSTEM_ADMIN', 'ORG_ADMIN', 'OPERATOR'].includes(role || '');

interface AuthState {
    user: User | null;
    isAuthenticated: boolean;
    hasHydrated: boolean;
    authGeneration: number;
    setAuth: (user: User, token?: string) => void;
    clearAuth: () => void;
    completeBootstrap: (user: User | null, generation: number) => void;
    setHasHydrated: (state: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            user: null,
            isAuthenticated: false,
            hasHydrated: false,
            authGeneration: 0,
            setAuth: (user) =>
                set((state) => ({
                    user,
                    isAuthenticated: true,
                    hasHydrated: true,
                    authGeneration: state.authGeneration + 1,
                })),
            clearAuth: () =>
                set((state) => ({
                    user: null,
                    isAuthenticated: false,
                    authGeneration: state.authGeneration + 1,
                })),
            completeBootstrap: (user, generation) =>
                set((state) =>
                    state.authGeneration === generation
                        ? { user, isAuthenticated: user !== null, hasHydrated: true }
                        : state
                ),
            setHasHydrated: (state) => set({ hasHydrated: state }),
        }),
        {
            name: 'auth-storage',
            partialize: (state) => ({
                user: state.user,
                isAuthenticated: state.isAuthenticated,
            }),
        }
    )
);

