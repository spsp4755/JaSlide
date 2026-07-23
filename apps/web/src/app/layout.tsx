import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { Providers } from '@/components/providers';

const plexSans = localFont({
    src: '../../../api/src/assets/fonts/NotoSansKR-Regular.otf',
    variable: '--font-sans',
});
const serifDisplay = localFont({
    src: '../../../api/src/assets/fonts/NotoSansKR-Bold.otf',
    variable: '--font-display',
});

export const metadata: Metadata = {
    title: 'TaeSlide - AI 프레젠테이션 자동 생성',
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
