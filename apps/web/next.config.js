/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    transpilePackages: ['@jaslide/shared'],
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: 'images.unsplash.com',
            },
            {
                protocol: 'https',
                hostname: 'lh3.googleusercontent.com',
            },
        ],
    },
    async rewrites() {
        // Only reached when a request lands on the Next.js server itself — SSR/server-component
        // fetches to '/api/...', or a client hitting web:3000 directly instead of through the
        // Ingress (which normally routes /api straight to the api Service, bypassing this).
        const apiOrigin = process.env.API_INTERNAL_URL || 'http://localhost:4000';
        return [
            {
                source: '/api/:path*',
                destination: `${apiOrigin}/api/:path*`,
            },
        ];
    },
};

module.exports = nextConfig;
