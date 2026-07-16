'use client';

import { adminFetch } from '@/lib/admin-fetch';

import { useEffect, useState } from 'react';
import { RefreshCw, Play, StopCircle, XCircle, Filter } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface Job {
    id: string;
    status: string;
    progress: number;
    creditsCost: number;
    user: { id: string; email: string; name: string | null };
    presentation: { id: string; title: string } | null;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
}

interface JobStats {
    byStatus: { status: string; _count: number }[];
    last24Hours: number;
}

export default function AdminJobsPage() {
    const [jobs, setJobs] = useState<Job[]>([]);
    const [stats, setStats] = useState<JobStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('');
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const limit = 20;

    useEffect(() => {
        fetchData();
    }, [page, statusFilter]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const headers = { };
            const params = new URLSearchParams({
                page: String(page),
                limit: String(limit),
                ...(statusFilter && { status: statusFilter }),
            });

            const [jobsRes, statsRes] = await Promise.all([
                adminFetch(`${API_URL}/admin/jobs?${params}`, { headers }),
                adminFetch(`${API_URL}/admin/jobs/stats`, { headers }),
            ]);

            if (jobsRes.ok) {
                const data = await jobsRes.json();
                setJobs(data.data);
                setTotal(data.total);
            }

            if (statsRes.ok) {
                setStats(await statsRes.json());
            }
        } finally {
            setLoading(false);
        }
    };

    const retryJob = async (id: string) => {
        await adminFetch(`${API_URL}/admin/jobs/${id}/retry`, {
            method: 'POST',
            headers: { },
        });
        fetchData();
    };

    const cancelJob = async (id: string) => {
        await adminFetch(`${API_URL}/admin/jobs/${id}/cancel`, {
            method: 'POST',
            headers: { },
        });
        fetchData();
    };

    const statusColors: Record<string, string> = {
        QUEUED: 'bg-gray-100 text-gray-800',
        PROCESSING: 'bg-blue-100 text-blue-800',
        GENERATING_OUTLINE: 'bg-blue-100 text-blue-800',
        GENERATING_CONTENT: 'bg-blue-100 text-blue-800',
        APPLYING_DESIGN: 'bg-blue-100 text-blue-800',
        RENDERING: 'bg-yellow-100 text-yellow-800',
        COMPLETED: 'bg-green-100 text-green-800',
        FAILED: 'bg-red-100 text-red-800',
        CANCELLED: 'bg-gray-100 text-gray-800',
    };

    return (
        <div className="p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">작업 모니터링</h1>
                    <p className="text-sm text-gray-500">총 {total}개 작업</p>
                </div>
                <button onClick={fetchData} className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200">
                    <RefreshCw size={20} />
                    새로고침
                </button>
            </div>

            {/* Stats */}
            {stats && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    {stats.byStatus.map((s) => (
                        <div key={s.status} className="bg-white rounded-lg p-4 shadow-sm">
                            <div className="text-sm text-gray-500">{s.status}</div>
                            <div className="text-2xl font-bold text-gray-900">{s._count}</div>
                        </div>
                    ))}
                    <div className="bg-white rounded-lg p-4 shadow-sm">
                        <div className="text-sm text-gray-500">최근 24시간</div>
                        <div className="text-2xl font-bold text-gray-900">{stats.last24Hours}</div>
                    </div>
                </div>
            )}

            {/* Filters */}
            <div className="bg-white rounded-lg p-4 mb-6 shadow-sm flex items-center gap-4">
                <Filter size={20} className="text-gray-400" />
                <select
                    value={statusFilter}
                    onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                    className="px-4 py-2 border rounded-lg"
                >
                    <option value="">모든 상태</option>
                    <option value="QUEUED">대기중</option>
                    <option value="PROCESSING">처리중</option>
                    <option value="COMPLETED">완료</option>
                    <option value="FAILED">실패</option>
                    <option value="CANCELLED">취소</option>
                </select>
            </div>

            {/* Jobs Table */}
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                {loading ? (
                    <div className="p-8 text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto" />
                    </div>
                ) : (
                    <table className="w-full">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">사용자</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">상태</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">진행률</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">크레딧</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">생성일</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">작업</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {jobs.map((job) => (
                                <tr key={job.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 text-sm font-mono text-gray-500">{job.id.slice(0, 8)}...</td>
                                    <td className="px-6 py-4">
                                        <div className="text-sm font-medium text-gray-900">{job.user.email}</div>
                                        <div className="text-xs text-gray-500">{job.presentation?.title || '-'}</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`px-2 py-1 text-xs rounded-full ${statusColors[job.status] || ''}`}>
                                            {job.status}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                                            <div className="h-full bg-gray-900" style={{ width: `${job.progress}%` }} />
                                        </div>
                                        <div className="text-xs text-gray-500 mt-1">{job.progress}%</div>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900">{job.creditsCost}</td>
                                    <td className="px-6 py-4 text-sm text-gray-500">
                                        {new Date(job.createdAt).toLocaleString('ko-KR')}
                                    </td>
                                    <td className="px-6 py-4 text-right space-x-2">
                                        {job.status === 'FAILED' && (
                                            <button
                                                onClick={() => retryJob(job.id)}
                                                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                                                title="재시도"
                                            >
                                                <Play size={16} />
                                            </button>
                                        )}
                                        {['QUEUED', 'PROCESSING'].includes(job.status) && (
                                            <button
                                                onClick={() => cancelJob(job.id)}
                                                className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                                                title="취소"
                                            >
                                                <XCircle size={16} />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}

                {/* Pagination */}
                {total > limit && (
                    <div className="px-6 py-4 border-t flex items-center justify-between">
                        <p className="text-sm text-gray-500">
                            {(page - 1) * limit + 1} - {Math.min(page * limit, total)} / {total}
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page === 1}
                                className="px-3 py-1 border rounded disabled:opacity-50"
                            >
                                이전
                            </button>
                            <button
                                onClick={() => setPage(p => p + 1)}
                                disabled={page * limit >= total}
                                className="px-3 py-1 border rounded disabled:opacity-50"
                            >
                                다음
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
