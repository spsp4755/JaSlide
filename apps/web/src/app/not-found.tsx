import Link from 'next/link';

// Next's built-in 404 is English and offers no way back, which strands a visitor
// who mistypes a URL or follows a link to a deleted deck.
export default function NotFound() {
    return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 text-center">
            <h1 className="font-display text-4xl font-black tracking-tight text-foreground">404</h1>
            <p className="mt-3 text-muted-foreground">요청한 페이지를 찾을 수 없습니다.</p>
            <Link
                href="/dashboard"
                className="mt-8 px-5 py-3 rounded-xl bg-foreground text-background font-medium hover:opacity-85 transition-opacity"
            >
                홈으로 돌아가기
            </Link>
        </div>
    );
}
