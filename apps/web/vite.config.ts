import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
        },
    },
    server: {
        port: 3000,
        proxy: {
            '/api': 'http://localhost:4000',
            '/uploads': 'http://localhost:4000',
            '/socket.io': {
                target: 'http://localhost:4000',
                ws: true,
            },
        },
    },
    preview: {
        port: 3000,
        host: '0.0.0.0',
    },
    test: {
        setupFiles: ['./test/setup.ts'],
    },
});
