'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { authApi } from '@/lib/api';
import { useAuthStore, isAdminRole } from '@/stores/auth-store';
import { Sparkles, ArrowLeft } from 'lucide-react';

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
            // Role-based routing: admins go to /admin, users go to /dashboard
            if (isAdminRole(user.role)) {
                router.push('/admin');
            } else {
                router.push('/dashboard');
            }
        } catch (err: any) {
            setError(err.response?.data?.message || '로그인에 실패했습니다.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                <Link href="/" className="flex items-center gap-2 text-gray-400 hover:text-white mb-8">
                    <ArrowLeft className="h-4 w-4" />
                    홈으로
                </Link>

                <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20">
                    <div className="flex items-center justify-center gap-2 mb-8">
                        <Sparkles className="h-8 w-8 text-purple-400" />
                        <span className="text-2xl font-bold text-white">JaSlide</span>
                    </div>

                    <h1 className="text-2xl font-bold text-white text-center mb-2">
                        로그인
                    </h1>
                    <p className="text-gray-400 text-center mb-8">
                        계정에 로그인하여 프레젠테이션을 만들어보세요
                    </p>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">
                                이메일
                            </label>
                            <input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                placeholder="you@example.com"
                                required
                            />
                        </div>

                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-2">
                                비밀번호
                            </label>
                            <input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                placeholder="••••••••"
                                required
                            />
                        </div>

                        {error && (
                            <div className="text-red-400 text-sm text-center">{error}</div>
                        )}

                        <Button
                            type="submit"
                            className="w-full bg-purple-600 hover:bg-purple-700 py-6"
                            disabled={loading}
                        >
                            {loading ? '로그인 중...' : '로그인'}
                        </Button>
                    </form>

                    <div className="mt-6 text-center">
                        <p className="text-gray-400">
                            계정이 없으신가요?{' '}
                            <Link href="/register" className="text-purple-400 hover:text-purple-300">
                                회원가입
                            </Link>
                        </p>
                    </div>

                    <div className="mt-8 relative">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-white/10" />
                        </div>
                        <div className="relative flex justify-center text-sm">
                            <span className="px-2 bg-transparent text-gray-500">또는</span>
                        </div>
                    </div>

                    <Button
                        variant="outline"
                        className="w-full mt-4 border-purple-400/50 bg-purple-600/20 text-white hover:bg-purple-600/40"
                        onClick={() => window.location.assign(`${process.env.NEXT_PUBLIC_API_URL || '/api'}/auth/keycloak`)}
                    >
                        사내 SSO로 로그인
                    </Button>
                </div>
            </div>
        </div>
    );
}
