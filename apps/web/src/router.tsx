import { createBrowserRouter, Outlet, type RouteObject } from 'react-router-dom';
import { RequireAdmin, RequireAuth } from '@/components/auth-guards';
import { CommandPalette } from '@/components/command-palette';

const page = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({
    Component: (await load()).default,
});

function RouteLoading() {
    return (
        <main className="grid min-h-screen place-items-center bg-background" aria-label="화면 불러오는 중">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
        </main>
    );
}

function RootLayout() {
    return (
        <>
            <CommandPalette />
            <Outlet />
        </>
    );
}

export const appRoutes: RouteObject[] = [
    {
        element: <RootLayout />,
        HydrateFallback: RouteLoading,
        children: [
            { index: true, id: 'root', lazy: page(() => import('@/app/page')) },
            { path: 'login', id: 'login', lazy: page(() => import('@/app/login/page')) },
            { path: 'register', id: 'register', lazy: page(() => import('@/app/register/page')) },
            { path: 'demo', id: 'demo', lazy: page(() => import('@/app/demo/page')) },
            { path: 'demo/skills', id: 'demo-skills', lazy: page(() => import('@/app/demo/skills/page')) },
            {
                id: 'authenticated',
                element: <RequireAuth />,
                children: [
                    { path: 'home', id: 'home', lazy: page(() => import('@/app/home/page')) },
                    { path: 'dashboard', id: 'dashboard', lazy: page(() => import('@/app/dashboard/page')) },
                    { path: 'presentations', id: 'presentations', lazy: page(() => import('@/app/presentations/page')) },
                    { path: 'skills', id: 'skills', lazy: page(() => import('@/app/skills/page')) },
                    { path: 'settings', id: 'settings', lazy: page(() => import('@/app/settings/page')) },
                    { path: 'create', id: 'create', lazy: page(() => import('@/app/create/page')) },
                    { path: 'editor/:id', id: 'editor', lazy: page(() => import('@/app/editor/[id]/page')) },
                    {
                        path: 'admin',
                        id: 'admin-guard',
                        element: <RequireAdmin />,
                        children: [
                            {
                                id: 'admin',
                                lazy: page(() => import('@/app/admin/layout')),
                                children: [
                                    { index: true, id: 'admin-dashboard', lazy: page(() => import('@/app/admin/page')) },
                                    { path: 'users', id: 'admin-users', lazy: page(() => import('@/app/admin/users/page')) },
                                    { path: 'organizations', id: 'admin-organizations', lazy: page(() => import('@/app/admin/organizations/page')) },
                                    { path: 'roles', id: 'admin-roles', lazy: page(() => import('@/app/admin/roles/page')) },
                                    { path: 'templates', id: 'admin-templates', lazy: page(() => import('@/app/admin/templates/page')) },
                                    { path: 'models', id: 'admin-models', lazy: page(() => import('@/app/admin/models/page')) },
                                    { path: 'prompts', id: 'admin-prompts', lazy: page(() => import('@/app/admin/prompts/page')) },
                                    { path: 'assets', id: 'admin-assets', lazy: page(() => import('@/app/admin/assets/page')) },
                                    { path: 'jobs', id: 'admin-jobs', lazy: page(() => import('@/app/admin/jobs/page')) },
                                    { path: 'documents', id: 'admin-documents', lazy: page(() => import('@/app/admin/documents/page')) },
                                    { path: 'policies', id: 'admin-policies', lazy: page(() => import('@/app/admin/policies/page')) },
                                    { path: 'logs', id: 'admin-logs', lazy: page(() => import('@/app/admin/logs/page')) },
                                    { path: 'operations', id: 'admin-operations', lazy: page(() => import('@/app/admin/operations/page')) },
                                    { path: 'alerts', id: 'admin-alerts', lazy: page(() => import('@/app/admin/alerts/page')) },
                                ],
                            },
                        ],
                    },
                ],
            },
            { path: '*', id: 'not-found', lazy: page(() => import('@/app/not-found')) },
        ],
    },
];

export const createAppRouter = () => createBrowserRouter(appRoutes);
