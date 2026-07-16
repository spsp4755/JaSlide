'use client';

import { adminFetch } from '@/lib/admin-fetch';

import { useEffect, useState } from 'react';
import { Download, Filter, RefreshCw, FileText, Activity } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface AuditLog {
    id: string;
    action: string;
    resource: string;
    resourceId: string | null;
    user: { email: string; name: string | null } | null;
    details: any;
    ipAddress: string | null;
    createdAt: string;
}

interface ApiLog {
    id: string;
    method: string;
    path: string;
    statusCode: number;
    responseTime: number;
    userId: string | null;
    createdAt: string;
}

type LogTab = 'audit' | 'api';

export default function AdminLogsPage() {
    const [tab, setTab] = useState<LogTab>('audit');
    const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
    const [apiLogs, setApiLogs] = useState<ApiLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const limit = 30;

    useEffect(() => {
        fetchLogs();
    }, [tab, page]);

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: String(page), limit: String(limit) });
            const endpoint = tab === 'audit' ? 'audit' : 'api';

            const res = await adminFetch(`${API_URL}/admin/logs/${endpoint}?${params}`, {
                headers: { },
            });

            if (res.ok) {
                const data = await res.json();
                if (tab === 'audit') {
                    setAuditLogs(data.data);
                } else {
                    setApiLogs(data.data);
                }
                setTotal(data.total);
            }
        } finally {
            setLoading(false);
        }
    };

    const exportLogs = async (format: 'json' | 'csv') => {
        const endpoint = tab === 'audit' ? 'audit' : 'api';

        const res = await adminFetch(`${API_URL}/admin/logs/export/${endpoint}?format=${format}`, {
            headers: { },
        });

        if (res.ok) {
            const data = await res.json();
            const blob = new Blob([format === 'json' ? JSON.stringify(data.data, null, 2) : data.data], {
                type: format === 'json' ? 'application/json' : 'text/csv',
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${endpoint}_logs.${format}`;
            a.click();
        }
    };

    return (
        <div className="p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">로그 & 감사</h1>
                    <p className="text-sm text-gray-500">시스템 활동 및 API 호출 로그</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => exportLogs('json')}
                        className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200"
                    >
                        <Download size={18} />
                        JSON
                    </button>
                    <button
                        onClick={() => exportLogs('csv')}
                        className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200"
                    >
                        <Download size={18} />
                        CSV
                    </button>
                    <button onClick={fetchLogs} className="p-2 bg-gray-100 rounded-lg hover:bg-gray-200">
                        <RefreshCw size={20} />
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b mb-6">
                <button
                    onClick={() => { setTab('audit'); setPage(1); }}
                    className={`flex items-center gap-2 px-4 py-3 border-b-2 -mb-px ${tab === 'audit' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500'
                        }`}
                >
                    <FileText size={18} />
                    감사 로그
                </button>
                <button
                    onClick={() => { setTab('api'); setPage(1); }}
                    className={`flex items-center gap-2 px-4 py-3 border-b-2 -mb-px ${tab === 'api' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500'
                        }`}
                >
                    <Activity size={18} />
                    API 로그
                </button>
            </div>

            {/* Logs Table */}
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                {loading ? (
                    <div className="p-8 text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto" />
                    </div>
                ) : tab === 'audit' ? (
                    <table className="w-full">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">시간</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">사용자</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">작업</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">리소스</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">IP</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {auditLogs.map((log) => (
                                <tr key={log.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 text-sm text-gray-500">
                                        {new Date(log.createdAt).toLocaleString('ko-KR')}
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900">{log.user?.email || 'System'}</td>
                                    <td className="px-6 py-4">
                                        <span className="px-2 py-1 text-xs bg-gray-100 rounded">{log.action}</span>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-500">{log.resource}</td>
                                    <td className="px-6 py-4 text-sm text-gray-500">{log.ipAddress || '-'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <table className="w-full">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">시간</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">메소드</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">경로</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">상태</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">응답시간</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {apiLogs.map((log) => (
                                <tr key={log.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 text-sm text-gray-500">
                                        {new Date(log.createdAt).toLocaleString('ko-KR')}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`px-2 py-1 text-xs rounded ${log.method === 'GET' ? 'bg-green-100 text-green-800' :
                                            log.method === 'POST' ? 'bg-blue-100 text-blue-800' :
                                                log.method === 'PUT' || log.method === 'PATCH' ? 'bg-yellow-100 text-yellow-800' :
                                                    'bg-red-100 text-red-800'
                                            }`}>
                                            {log.method}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-sm font-mono text-gray-500">{log.path}</td>
                                    <td className="px-6 py-4">
                                        <span className={`px-2 py-1 text-xs rounded ${log.statusCode < 300 ? 'bg-green-100 text-green-800' :
                                            log.statusCode < 400 ? 'bg-yellow-100 text-yellow-800' :
                                                'bg-red-100 text-red-800'
                                            }`}>
                                            {log.statusCode}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-500">{log.responseTime}ms</td>
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
                            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 border rounded disabled:opacity-50">이전</button>
                            <button onClick={() => setPage(p => p + 1)} disabled={page * limit >= total} className="px-3 py-1 border rounded disabled:opacity-50">다음</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
