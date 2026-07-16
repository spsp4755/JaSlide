import type { Metadata } from 'next';
import { IBM_Plex_Sans_KR, Noto_Serif_KR } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';

// ponytail: next/font self-hosts at build time — no runtime CDN, closed-network safe
const plexSans = IBM_Plex_Sans_KR({
    weight: ['400', '500', '600', '700'],
    subsets: ['latin'],
    variable: '--font-sans',
});
const serifDisplay = Noto_Serif_KR({
    weight: ['600', '700', '900'],
    subsets: ['latin'],
    variable: '--font-display',
});

export const metadata: Metadata = {
    title: 'JaSlide - AI 프레젠테이션 자동 생성',
    description: 'AI 기반 프레젠테이션 자동 생성 시스템',
    keywords: ['프레젠테이션', 'AI', '슬라이드', 'PPT', '자동 생성'],
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="ko" suppressHydrationWarning>
            <body className={`${plexSans.variable} ${serifDisplay.variable} font-sans`}>
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
