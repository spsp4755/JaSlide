'use client';

import { adminFetch } from '@/lib/admin-fetch';
import { assetUrl } from '@/lib/api';

import { useEffect, useState } from 'react';
import { Search, Image, File, Video, Music, Trash2, Download, Filter } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface Asset {
    id: string;
    name: string;
    type: string;
    url: string;
    size: number;
    user: { id: string; email: string } | null;
    organization: { id: string; name: string } | null;
    createdAt: string;
}

export default function AdminAssetsPage() {
    const [assets, setAssets] = useState<Asset[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [typeFilter, setTypeFilter] = useState('');
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const limit = 24;

    useEffect(() => {
        fetchAssets();
    }, [page, typeFilter]);

    const fetchAssets = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                page: String(page), limit: String(limit),
                ...(search && { search }), ...(typeFilter && { type: typeFilter }),
            });
            const res = await adminFetch(`${API_URL}/admin/assets?${params}`, {
                headers: { },
            });
            if (res.ok) {
                const data = await res.json();
                setAssets(data.data);
                setTotal(data.total);
            }
        } finally {
            setLoading(false);
        }
    };

    const deleteAsset = async (id: string) => {
        if (!confirm('이 에셋을 삭제하시겠습니까?')) return;
        await adminFetch(`${API_URL}/admin/assets/${id}`, { method: 'DELETE', headers: { } });
        fetchAssets();
    };

    const formatSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    };

    const typeIcons: Record<string, any> = { IMAGE: Image, DOCUMENT: File, VIDEO: Video, AUDIO: Music };

    return (
        <div className="p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">에셋 라이브러리</h1>
                    <p className="text-sm text-gray-500">총 {total}개 에셋</p>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white rounded-lg p-4 mb-6 shadow-sm flex items-center gap-4">
                <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <input type="text" placeholder="에셋 검색..." value={search} onChange={(e) => setSearch(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && fetchAssets()}
                        className="w-full pl-10 pr-4 py-2 border rounded-lg" />
                </div>
                <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }} className="px-4 py-2 border rounded-lg">
                    <option value="">모든 타입</option>
                    <option value="IMAGE">이미지</option>
                    <option value="DOCUMENT">문서</option>
                    <option value="VIDEO">비디오</option>
                    <option value="AUDIO">오디오</option>
                </select>
            </div>

            {/* Assets Grid */}
            {loading ? (
                <div className="p-8 text-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto" /></div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {assets.map((asset) => {
                        const Icon = typeIcons[asset.type] || File;
                        return (
                            <div key={asset.id} className="bg-white rounded-lg shadow-sm overflow-hidden group">
                                <div className="h-24 bg-gray-100 flex items-center justify-center relative">
                                    {asset.type === 'IMAGE' ? (
                                        <img src={assetUrl(asset.url)} alt={asset.name} className="h-full w-full object-cover" />
                                    ) : (
                                        <Icon size={32} className="text-gray-400" />
                                    )}
                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                        <a href={assetUrl(asset.url)} target="_blank" className="p-2 bg-white rounded-full"><Download size={16} /></a>
                                        <button onClick={() => deleteAsset(asset.id)} className="p-2 bg-white rounded-full"><Trash2 size={16} className="text-red-500" /></button>
                                    </div>
                                </div>
                                <div className="p-2">
                                    <p className="text-xs font-medium text-gray-900 truncate" title={asset.name}>{asset.name}</p>
                                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                                        <span>{asset.type}</span>
                                        <span>{formatSize(asset.size)}</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Pagination */}
            {total > limit && (
                <div className="mt-6 flex items-center justify-center gap-2">
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-4 py-2 border rounded-lg disabled:opacity-50">이전</button>
                    <span className="text-gray-500">페이지 {page} / {Math.ceil(total / limit)}</span>
                    <button onClick={() => setPage(p => p + 1)} disabled={page * limit >= total} className="px-4 py-2 border rounded-lg disabled:opacity-50">다음</button>
                </div>
            )}
        </div>
    );
}
