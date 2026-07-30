// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createMemoryRouter,
    matchRoutes,
    RouterProvider,
} from 'react-router-dom';
import { authApi } from '../src/lib/api';
import { Providers } from '../src/components/providers';
import { appRoutes } from '../src/router';
import { useAuthStore } from '../src/stores/auth-store';

vi.mock('@/app/login/page', () => ({ default: () => 'login-screen' }));
vi.mock('@/app/dashboard/page', () => ({ default: () => 'dashboard-screen' }));
vi.mock('@/app/editor/[id]/page', async () => {
    const { useParams } = await import('react-router-dom');
    return {
        default: () => <div data-testid="editor-id">{useParams().id}</div>,
    };
});
vi.mock('@/app/admin/layout', async () => {
    const { Outlet } = await import('react-router-dom');
    return { default: Outlet };
});
vi.mock('@/app/admin/templates/page', () => ({ default: () => 'admin-templates-screen' }));

const routeId = (path: string) => matchRoutes(appRoutes, path)?.at(-1)?.route.id;
const regularUser = {
    id: 'user-1',
    email: 'user@example.com',
    name: 'User',
    role: 'USER' as const,
};
const adminUser = {
    id: 'admin-1',
    email: 'admin@example.com',
    name: 'Admin',
    role: 'ADMIN' as const,
};

function renderRoute(path: string, withProviders = false) {
    const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
    const view = <RouterProvider router={router} />;
    render(withProviders ? <Providers>{view}</Providers> : view);
    return router;
}

describe('SPA routes', () => {
    beforeEach(() => {
        useAuthStore.setState({
            user: null,
            isAuthenticated: false,
            hasHydrated: true,
        });
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        window.localStorage.clear();
    });

    it('renders a stable loading surface while a directly opened lazy route loads', () => {
        expect(appRoutes[0].HydrateFallback).toBeTypeOf('function');
    });

    it('renders /login when it is opened directly', async () => {
        const router = renderRoute('/login');

        expect(await screen.findByText('login-screen')).toBeTruthy();
        expect(router.state.location.pathname).toBe('/login');
    });

    it('passes the direct editor URL parameter to the rendered editor', async () => {
        useAuthStore.setState({ user: regularUser, isAuthenticated: true, hasHydrated: true });
        const router = renderRoute('/editor/deck-123');

        expect((await screen.findByTestId('editor-id')).textContent).toBe('deck-123');
        expect(router.state.location.pathname).toBe('/editor/deck-123');
    });

    it('redirects an unauthenticated direct editor visit to login', async () => {
        const router = renderRoute('/editor/deck-123');

        expect(await screen.findByText('login-screen')).toBeTruthy();
        expect(router.state.location.pathname).toBe('/login');
    });

    it('redirects a non-admin user away from admin routes', async () => {
        useAuthStore.setState({ user: regularUser, isAuthenticated: true, hasHydrated: true });
        const router = renderRoute('/admin/templates');

        expect(await screen.findByText('dashboard-screen')).toBeTruthy();
        expect(router.state.location.pathname).toBe('/dashboard');
    });

    it('rehydrates a fresh Keycloak cookie before rendering an admin route', async () => {
        useAuthStore.setState({ user: null, isAuthenticated: false, hasHydrated: false });
        const me = vi.spyOn(authApi, 'me').mockResolvedValue({ data: adminUser } as never);
        const router = renderRoute('/admin/templates', true);

        expect(await screen.findByText('admin-templates-screen')).toBeTruthy();
        expect(me).toHaveBeenCalledOnce();
        expect(router.state.location.pathname).toBe('/admin/templates');
        expect(useAuthStore.getState().user).toEqual(adminUser);
    });

    it('clears an invalid cookie and redirects an admin route to login after /auth/me returns 401', async () => {
        useAuthStore.setState({ user: adminUser, isAuthenticated: true, hasHydrated: false });
        vi.spyOn(authApi, 'me').mockRejectedValue({ response: { status: 401 } });
        const router = renderRoute('/admin/templates', true);

        expect(await screen.findByText('login-screen')).toBeTruthy();
        await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
        expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it.each([
        ['/login', 'login'],
        ['/editor/deck-123', 'editor'],
        ['/admin/templates', 'admin-templates'],
        ['/', 'root'],
        ['/register', 'register'],
        ['/home', 'home'],
        ['/dashboard', 'dashboard'],
        ['/presentations', 'presentations'],
        ['/skills', 'skills'],
        ['/settings', 'settings'],
        ['/create', 'create'],
        ['/demo', 'demo'],
        ['/demo/skills', 'demo-skills'],
        ['/admin', 'admin-dashboard'],
        ['/admin/users', 'admin-users'],
        ['/admin/organizations', 'admin-organizations'],
        ['/admin/roles', 'admin-roles'],
        ['/admin/models', 'admin-models'],
        ['/admin/prompts', 'admin-prompts'],
        ['/admin/assets', 'admin-assets'],
        ['/admin/jobs', 'admin-jobs'],
        ['/admin/documents', 'admin-documents'],
        ['/admin/policies', 'admin-policies'],
        ['/admin/logs', 'admin-logs'],
        ['/admin/operations', 'admin-operations'],
        ['/admin/alerts', 'admin-alerts'],
    ])('preserves %s', (path, id) => {
        expect(routeId(path)).toBe(id);
    });
});

describe('Vite and production proxies', () => {
    it('allows deployment-sized uploads and proxies every API-owned path', () => {
        const webRoot = process.cwd();
        const repositoryRoot = path.resolve(webRoot, '../..');
        const nginx = readFileSync(path.join(repositoryRoot, 'docker/web-nginx.conf'), 'utf8');
        const dockerfile = readFileSync(path.join(repositoryRoot, 'docker/web.Dockerfile'), 'utf8');
        const kubernetes = readFileSync(path.join(repositoryRoot, 'deploy/k8s/jaslide-k8s.yaml'), 'utf8');
        const vite = readFileSync(path.join(webRoot, 'vite.config.ts'), 'utf8');

        expect(nginx).toMatch(/client_max_body_size\s+100m/);
        expect(nginx).toMatch(/try_files\s+\$uri\s+\$uri\/\s+\/index\.html/);
        expect(nginx).toMatch(/location\s+\/api\//);
        expect(nginx).toMatch(/location\s+\/uploads\//);
        expect(vite).toMatch(/['"]\/uploads['"]\s*:/);
        expect(dockerfile).toContain('COPY --from=build /app/apps/web/dist');
        expect(kubernetes).toMatch(/path:\s*\/socket\.io[\s\S]{0,180}name:\s*jaslide-api/);
        expect(webRoot).toContain('apps');
    });
});
