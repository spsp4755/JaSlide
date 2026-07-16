'use client';

import { adminFetch } from '@/lib/admin-fetch';

import { useEffect, useState } from 'react';
import { Plus, Settings, Trash2, Edit, Save } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface Policy {
    id: string;
    category: string;
    key: string;
    value: any;
    description: string | null;
    createdAt: string;
}

const categories = ['security', 'retention', 'limits', 'features', 'general'];

export default function AdminPoliciesPage() {
    const [policies, setPolicies] = useState<Policy[]>([]);
    const [loading, setLoading] = useState(true);
    const [categoryFilter, setCategoryFilter] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState<string>('');

    useEffect(() => {
        fetchPolicies();
    }, [categoryFilter]);

    const fetchPolicies = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ ...(categoryFilter && { category: categoryFilter }) });
            const res = await adminFetch(`${API_URL}/admin/policies?${params}`, {
                headers: { },
            });
            if (res.ok) setPolicies((await res.json()).data);
        } finally {
            setLoading(false);
        }
    };

    const startEdit = (policy: Policy) => {
        setEditingId(policy.id);
        setEditValue(typeof policy.value === 'object' ? JSON.stringify(policy.value) : String(policy.value));
    };

    const saveEdit = async (id: string) => {
        let value: any = editValue;
        try { value = JSON.parse(editValue); } catch { }

        await adminFetch(`${API_URL}/admin/policies/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value }),
        });
        setEditingId(null);
        fetchPolicies();
    };

    const deletePolicy = async (id: string) => {
        if (!confirm('이 정책을 삭제하시겠습니까?')) return;
        await adminFetch(`${API_URL}/admin/policies/${id}`, { method: 'DELETE', headers: { } });
        fetchPolicies();
    };

    const categoryColors: Record<string, string> = {
        security: 'bg-red-100 text-red-800',
        retention: 'bg-yellow-100 text-yellow-800',
        limits: 'bg-blue-100 text-blue-800',
        features: 'bg-green-100 text-green-800',
        general: 'bg-gray-100 text-gray-800',
    };

    return (
        <div className="p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">정책 관리</h1>
                    <p className="text-sm text-gray-500">시스템 정책 및 설정</p>
                </div>
                <button className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-700">
                    <Plus size={20} />
                    정책 추가
                </button>
            </div>

            {/* Category Tabs */}
            <div className="flex gap-2 mb-6 flex-wrap">
                <button onClick={() => setCategoryFilter('')} className={`px-4 py-2 rounded-lg text-sm ${!categoryFilter ? 'bg-gray-900 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}>
                    전체
                </button>
                {categories.map((cat) => (
                    <button key={cat} onClick={() => setCategoryFilter(cat)} className={`px-4 py-2 rounded-lg text-sm capitalize ${categoryFilter === cat ? 'bg-gray-900 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}>
                        {cat}
                    </button>
                ))}
            </div>

            {/* Policies Table */}
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                {loading ? (
                    <div className="p-8 text-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto" /></div>
                ) : (
                    <table className="w-full">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">카테고리</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">키</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">값</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">설명</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">작업</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {policies.map((policy) => (
                                <tr key={policy.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4">
                                        <span className={`px-2 py-1 text-xs rounded-full capitalize ${categoryColors[policy.category] || ''}`}>
                                            {policy.category}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 font-mono text-sm text-gray-900">{policy.key}</td>
                                    <td className="px-6 py-4">
                                        {editingId === policy.id ? (
                                            <input type="text" value={editValue} onChange={(e) => setEditValue(e.target.value)}
                                                className="px-2 py-1 border rounded text-sm w-full max-w-xs" autoFocus />
                                        ) : (
                                            <span className="text-sm text-gray-600 font-mono">
                                                {typeof policy.value === 'object' ? JSON.stringify(policy.value) : String(policy.value)}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-500">{policy.description || '-'}</td>
                                    <td className="px-6 py-4 text-right">
                                        {editingId === policy.id ? (
                                            <button onClick={() => saveEdit(policy.id)} className="p-1.5 hover:bg-green-50 rounded">
                                                <Save size={16} className="text-green-600" />
                                            </button>
                                        ) : (
                                            <button onClick={() => startEdit(policy)} className="p-1.5 hover:bg-gray-100 rounded">
                                                <Edit size={16} className="text-gray-500" />
                                            </button>
                                        )}
                                        <button onClick={() => deletePolicy(policy.id)} className="p-1.5 hover:bg-red-50 rounded">
                                            <Trash2 size={16} className="text-red-500" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
