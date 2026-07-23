'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';

export default function LoginPage() {
    const router = useRouter();
    const { setAuth } = useAuthStore();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const response = await authApi.login({ email, password });
            const { user } = response.data;
            setAuth(user);
            router.push('/dashboard'); // 관리자도 홈으로 — 관리자 메뉴는 사이드바에서 진입
        } catch (err: any) {
            setError(err.response?.data?.message || '로그인에 실패했습니다.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
            <div className="w-full max-w-sm">
                {/* Wordmark */}
                <div className="text-center mb-10">
                    <h1 className="font-display text-4xl font-black tracking-tight text-foreground">
                        TaeSlide
                    </h1>
                    <p className="mt-3 text-muted-foreground">
                        누구나 전문가처럼 덱을 만들 수 있도록.
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-3">
                    <input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full px-4 py-3.5 bg-card border border-border rounded-xl text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-shadow"
                        placeholder="이메일"
                        aria-label="이메일"
                        required
                    />
                    <input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full px-4 py-3.5 bg-card border border-border rounded-xl text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-shadow"
                        placeholder="비밀번호"
                        aria-label="비밀번호"
                        required
                    />

                    {error && (
                        <p className="text-destructive text-sm text-center" role="alert">{error}</p>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-3.5 rounded-xl bg-foreground text-background font-medium hover:opacity-85 disabled:opacity-40 transition-opacity"
                    >
                        {loading ? '로그인 중...' : '로그인'}
                    </button>
                </form>

                <button
                    type="button"
                    onClick={() => window.location.assign(`${process.env.NEXT_PUBLIC_API_URL || '/api'}/auth/keycloak`)}
                    className="w-full mt-3 py-3.5 rounded-xl border border-border bg-card text-foreground font-medium hover:bg-secondary transition-colors"
                >
                    사내 SSO로 로그인
                </button>

                <p className="mt-8 text-center text-sm text-muted-foreground">
                    계정이 없으신가요?{' '}
                    <Link href="/register" className="text-foreground underline underline-offset-4 hover:opacity-70">
                        회원가입
                    </Link>
                </p>
            </div>
        </div>
    );
}
