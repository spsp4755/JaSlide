'use client';

import { adminFetch } from '@/lib/admin-fetch';

import { useEffect, useState } from 'react';
import { Plus, Search, Building2, MoreVertical, Users, RefreshCw } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface Organization {
    id: string;
    name: string;
    slug: string;
    domain: string | null;
    logo: string | null;
    plan: string;
    createdAt: string;
    _count: { users: number; templates: number; assets: number };
}

export default function AdminOrganizationsPage() {
    const [organizations, setOrganizations] = useState<Organization[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const limit = 20;

    useEffect(() => {
        fetchOrganizations();
    }, [page]);

    const fetchOrganizations = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                page: String(page),
                limit: String(limit),
                ...(search && { search }),
            });

            const res = await adminFetch(`${API_URL}/admin/organizations?${params}`, {
                headers: { },
            });

            if (res.ok) {
                const data = await res.json();
                setOrganizations(data.data);
                setTotal(data.total);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setPage(1);
        fetchOrganizations();
    };

    const planColors: Record<string, string> = {
        FREE: 'bg-secondary text-foreground',
        STARTER: 'bg-blue-100 text-blue-800',
        PROFESSIONAL: 'bg-secondary text-foreground',
        ENTERPRISE: 'bg-orange-100 text-orange-800',
    };

    return (
        <div className="p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">조직 관리</h1>
                    <p className="text-sm text-muted-foreground">총 {total}개 조직</p>
                </div>
                <button className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90">
                    <Plus size={20} />
                    조직 추가
                </button>
            </div>

            {/* Search */}
            <div className="bg-card rounded-lg p-4 mb-6 shadow-sm">
                <form onSubmit={handleSearch} className="flex items-center gap-4">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="조직 이름, 슬러그, 도메인으로 검색..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-gray-400"
                        />
                    </div>
                    <button type="button" onClick={fetchOrganizations} className="px-4 py-2 bg-secondary rounded-lg hover:bg-muted">
                        <RefreshCw size={20} />
                    </button>
                </form>
            </div>

            {/* Organizations Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {loading ? (
                    <div className="col-span-full p-8 text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto" />
                    </div>
                ) : (
                    organizations.map((org) => (
                        <div key={org.id} className="bg-card rounded-lg shadow-sm overflow-hidden">
                            <div className="p-6">
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        {org.logo ? (
                                            <img src={org.logo} alt={org.name} className="w-12 h-12 rounded-lg object-cover" />
                                        ) : (
                                            <div className="w-12 h-12 bg-secondary rounded-lg flex items-center justify-center">
                                                <Building2 className="text-foreground" size={24} />
                                            </div>
                                        )}
                                        <div>
                                            <h3 className="font-semibold text-foreground">{org.name}</h3>
                                            <p className="text-sm text-muted-foreground">@{org.slug}</p>
                                        </div>
                                    </div>
                                    <button className="p-1 hover:bg-secondary rounded">
                                        <MoreVertical size={16} className="text-muted-foreground" />
                                    </button>
                                </div>

                                <div className="flex items-center gap-2 mb-4">
                                    <span className={`px-2 py-1 text-xs rounded-full ${planColors[org.plan] || ''}`}>
                                        {org.plan}
                                    </span>
                                    {org.domain && (
                                        <span className="px-2 py-1 text-xs bg-secondary text-muted-foreground rounded-full">
                                            {org.domain}
                                        </span>
                                    )}
                                </div>

                                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                    <div className="flex items-center gap-1">
                                        <Users size={16} />
                                        <span>{org._count.users} 멤버</span>
                                    </div>
                                    <span>템플릿 {org._count.templates}</span>
                                    <span>에셋 {org._count.assets}</span>
                                </div>
                            </div>
                            <div className="px-6 py-3 border-t bg-secondary text-xs text-muted-foreground">
                                생성일: {new Date(org.createdAt).toLocaleDateString('ko-KR')}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Pagination */}
            {total > limit && (
                <div className="mt-6 flex items-center justify-center gap-2">
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-4 py-2 border rounded-lg disabled:opacity-50">이전</button>
                    <span className="text-muted-foreground">페이지 {page}</span>
                    <button onClick={() => setPage(p => p + 1)} disabled={page * limit >= total} className="px-4 py-2 border rounded-lg disabled:opacity-50">다음</button>
                </div>
            )}
        </div>
    );
}
