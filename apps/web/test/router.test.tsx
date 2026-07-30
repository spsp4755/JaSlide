import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { matchRoutes } from 'react-router-dom';
import { appRoutes } from '../src/router';

const routeId = (path: string) => matchRoutes(appRoutes, path)?.at(-1)?.route.id;

describe('SPA routes', () => {
    it('renders a stable loading surface while a directly opened lazy route loads', () => {
        expect(appRoutes[0].HydrateFallback).toBeTypeOf('function');
    });

    it.each([
        ['/login', 'login'],
        ['/editor/deck-123', 'editor'],
        ['/admin/templates', 'admin-templates'],
    ])('opens %s directly', (path, id) => {
        expect(routeId(path)).toBe(id);
    });

    it.each([
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

describe('production static server', () => {
    it('falls back to index.html for hard-refreshed SPA routes and proxies API traffic', () => {
        const webRoot = fileURLToPath(new URL('..', import.meta.url));
        const nginx = readFileSync(new URL('../../../docker/web-nginx.conf', import.meta.url), 'utf8');
        const dockerfile = readFileSync(new URL('../../../docker/web.Dockerfile', import.meta.url), 'utf8');
        const kubernetes = readFileSync(new URL('../../../deploy/k8s/jaslide-k8s.yaml', import.meta.url), 'utf8');

        expect(nginx).toMatch(/try_files\s+\$uri\s+\$uri\/\s+\/index\.html/);
        expect(nginx).toMatch(/location\s+\/api\//);
        expect(nginx).toMatch(/location\s+\/uploads\//);
        expect(dockerfile).toContain('COPY --from=build /app/apps/web/dist');
        expect(kubernetes).toMatch(/path:\s*\/socket\.io[\s\S]{0,180}name:\s*jaslide-api/);
        expect(webRoot).toContain('apps');
    });
});
