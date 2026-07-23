'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';

export default function RegisterPage() {
    const router = useRouter();
    const { setAuth } = useAuthStore();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (password !== confirmPassword) {
            setError('비밀번호가 일치하지 않습니다.');
            return;
        }

        if (password.length < 8) {
            setError('비밀번호는 8자 이상이어야 합니다.');
            return;
        }

        setLoading(true);

        try {
            const response = await authApi.register({ email, password, name });
            const { user } = response.data;
            setAuth(user);
            router.push('/dashboard');
        } catch (err: any) {
            setError(err.response?.data?.message || '회원가입에 실패했습니다.');
        } finally {
            setLoading(false);
        }
    };

    const inputClass =
        'w-full px-4 py-3.5 bg-card border border-border rounded-xl text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-shadow';

    return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
            <div className="w-full max-w-sm">
                <div className="text-center mb-10">
                    <h1 className="font-display text-4xl font-black tracking-tight text-foreground">
                        TaeSlide
                    </h1>
                    <p className="mt-3 text-muted-foreground">
                        계정을 만들고 바로 시작하세요.
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-3">
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className={inputClass}
                        placeholder="이름"
                        aria-label="이름"
                        required
                    />
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={inputClass}
                        placeholder="이메일"
                        aria-label="이메일"
                        required
                    />
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={inputClass}
                        placeholder="비밀번호 (8자 이상)"
                        aria-label="비밀번호"
                        required
                    />
                    <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className={inputClass}
                        placeholder="비밀번호 확인"
                        aria-label="비밀번호 확인"
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
                        {loading ? '가입 중...' : '회원가입'}
                    </button>
                </form>

                <p className="mt-8 text-center text-sm text-muted-foreground">
                    이미 계정이 있으신가요?{' '}
                    <Link href="/login" className="text-foreground underline underline-offset-4 hover:opacity-70">
                        로그인
                    </Link>
                </p>
            </div>
        </div>
    );
}
