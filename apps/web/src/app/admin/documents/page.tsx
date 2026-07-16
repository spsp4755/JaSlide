'use client';

import { adminFetch } from '@/lib/admin-fetch';

import { useEffect, useState } from 'react';
import { Search, FileText, Trash2, Eye, Filter } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface Document {
    id: string;
    title: string;
    status: string;
    user: { id: string; email: string; name: string | null };
    _count: { slides: number };
    createdAt: string;
    updatedAt: string;
}

export default function AdminDocumentsPage() {
    const [documents, setDocuments] = useState<Document[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const limit = 20;

    useEffect(() => {
        fetchDocuments();
    }, [page, statusFilter]);

    const fetchDocuments = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                page: String(page), limit: String(limit),
                ...(search && { search }), ...(statusFilter && { status: statusFilter }),
            });
            const res = await adminFetch(`${API_URL}/admin/documents?${params}`, {
                headers: { },
            });
            if (res.ok) {
                const data = await res.json();
                setDocuments(data.data);
                setTotal(data.total);
            }
        } finally {
            setLoading(false);
        }
    };

    const deleteDocument = async (id: string) => {
        if (!confirm('이 문서를 삭제하시겠습니까?')) return;
        await adminFetch(`${API_URL}/admin/documents/${id}`, { method: 'DELETE', headers: { } });
        fetchDocuments();
    };

    const statusColors: Record<string, string> = {
        DRAFT: 'bg-gray-100 text-gray-800',
        GENERATING: 'bg-blue-100 text-blue-800',
        COMPLETED: 'bg-green-100 text-green-800',
        FAILED: 'bg-red-100 text-red-800',
    };

    return (
        <div className="p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">문서 관리</h1>
                    <p className="text-sm text-gray-500">총 {total}개 프레젠테이션</p>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white rounded-lg p-4 mb-6 shadow-sm flex items-center gap-4">
                <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <input type="text" placeholder="제목으로 검색..." value={search} onChange={(e) => setSearch(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && fetchDocuments()}
                        className="w-full pl-10 pr-4 py-2 border rounded-lg" />
                </div>
                <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="px-4 py-2 border rounded-lg">
                    <option value="">모든 상태</option>
                    <option value="DRAFT">초안</option>
                    <option value="GENERATING">생성중</option>
                    <option value="COMPLETED">완료</option>
                    <option value="FAILED">실패</option>
                </select>
            </div>

            {/* Documents Table */}
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                {loading ? (
                    <div className="p-8 text-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto" /></div>
                ) : (
                    <table className="w-full">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">제목</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">소유자</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">상태</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">슬라이드</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">수정일</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">작업</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {documents.map((doc) => (
                                <tr key={doc.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <FileText size={20} className="text-gray-400" />
                                            <span className="font-medium text-gray-900">{doc.title}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-600">{doc.user.email}</td>
                                    <td className="px-6 py-4">
                                        <span className={`px-2 py-1 text-xs rounded-full ${statusColors[doc.status] || ''}`}>{doc.status}</span>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-600">{doc._count.slides}장</td>
                                    <td className="px-6 py-4 text-sm text-gray-500">{new Date(doc.updatedAt).toLocaleDateString('ko-KR')}</td>
                                    <td className="px-6 py-4 text-right">
                                        <button className="p-1.5 hover:bg-gray-100 rounded"><Eye size={16} className="text-gray-500" /></button>
                                        <button onClick={() => deleteDocument(doc.id)} className="p-1.5 hover:bg-red-50 rounded"><Trash2 size={16} className="text-red-500" /></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}

                {total > limit && (
                    <div className="px-6 py-4 border-t flex items-center justify-between">
                        <p className="text-sm text-gray-500">{(page - 1) * limit + 1} - {Math.min(page * limit, total)} / {total}</p>
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
