'use client';

import { adminFetch } from '@/lib/admin-fetch';

import { useEffect, useState } from 'react';
import { Plus, Shield, Trash2, Edit, Users, CheckCircle } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface Role {
    id: string;
    name: string;
    description: string | null;
    permissions: string[];
    isSystem: boolean;
    createdAt: string;
    _count: { users: number };
}

const allPermissions = [
    'user:read', 'user:write', 'user:delete',
    'org:read', 'org:write', 'org:delete',
    'template:read', 'template:write', 'template:delete',
    'model:read', 'model:write',
    'prompt:read', 'prompt:write',
    'billing:read', 'billing:write',
    'logs:read', 'settings:write',
];

export default function AdminRolesPage() {
    const [roles, setRoles] = useState<Role[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingRole, setEditingRole] = useState<Role | null>(null);
    const [formData, setFormData] = useState({ name: '', description: '', permissions: [] as string[] });

    useEffect(() => {
        fetchRoles();
    }, []);

    const fetchRoles = async () => {
        setLoading(true);
        try {
            const res = await adminFetch(`${API_URL}/admin/roles`, {
                headers: { },
            });
            if (res.ok) {
                const data = await res.json();
                setRoles(data.data);
            }
        } finally {
            setLoading(false);
        }
    };

    const openCreateModal = () => {
        setEditingRole(null);
        setFormData({ name: '', description: '', permissions: [] });
        setShowModal(true);
    };

    const openEditModal = (role: Role) => {
        setEditingRole(role);
        setFormData({ name: role.name, description: role.description || '', permissions: role.permissions });
        setShowModal(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const method = editingRole ? 'PATCH' : 'POST';
        const url = editingRole ? `${API_URL}/admin/roles/${editingRole.id}` : `${API_URL}/admin/roles`;

        await adminFetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData),
        });

        setShowModal(false);
        fetchRoles();
    };

    const deleteRole = async (id: string) => {
        if (!confirm('이 역할을 삭제하시겠습니까?')) return;
        await adminFetch(`${API_URL}/admin/roles/${id}`, {
            method: 'DELETE',
            headers: { },
        });
        fetchRoles();
    };

    const togglePermission = (perm: string) => {
        setFormData(prev => ({
            ...prev,
            permissions: prev.permissions.includes(perm)
                ? prev.permissions.filter(p => p !== perm)
                : [...prev.permissions, perm],
        }));
    };

    return (
        <div className="p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">권한 관리</h1>
                    <p className="text-sm text-gray-500">역할 및 권한 설정</p>
                </div>
                <button onClick={openCreateModal} className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">
                    <Plus size={20} />
                    역할 추가
                </button>
            </div>

            {/* Roles Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {loading ? (
                    <div className="col-span-full p-8 text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto" />
                    </div>
                ) : (
                    roles.map((role) => (
                        <div key={role.id} className="bg-white rounded-lg shadow-sm p-6">
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${role.isSystem ? 'bg-orange-100' : 'bg-purple-100'}`}>
                                        <Shield className={role.isSystem ? 'text-orange-600' : 'text-purple-600'} size={20} />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-gray-900">{role.name}</h3>
                                        {role.isSystem && <span className="text-xs text-orange-600">시스템 역할</span>}
                                    </div>
                                </div>
                                {!role.isSystem && (
                                    <div className="flex gap-1">
                                        <button onClick={() => openEditModal(role)} className="p-1.5 hover:bg-gray-100 rounded">
                                            <Edit size={16} className="text-gray-500" />
                                        </button>
                                        <button onClick={() => deleteRole(role.id)} className="p-1.5 hover:bg-red-50 rounded">
                                            <Trash2 size={16} className="text-red-500" />
                                        </button>
                                    </div>
                                )}
                            </div>

                            <p className="text-sm text-gray-500 mb-4">{role.description || '설명 없음'}</p>

                            <div className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-1 text-gray-500">
                                    <Users size={16} />
                                    <span>{role._count.users}명</span>
                                </div>
                                <span className="text-purple-600">{role.permissions.length}개 권한</span>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
                        <h2 className="text-lg font-semibold mb-4">{editingRole ? '역할 수정' : '역할 추가'}</h2>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">역할 이름</label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                    className="w-full px-4 py-2 border rounded-lg"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">설명</label>
                                <input
                                    type="text"
                                    value={formData.description}
                                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                                    className="w-full px-4 py-2 border rounded-lg"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">권한</label>
                                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2 border rounded-lg bg-gray-50">
                                    {allPermissions.map((perm) => (
                                        <label key={perm} className="flex items-center gap-2 text-sm cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={formData.permissions.includes(perm)}
                                                onChange={() => togglePermission(perm)}
                                                className="rounded text-purple-600"
                                            />
                                            <span>{perm}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                            <div className="flex gap-3 pt-4">
                                <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-4 py-2 border rounded-lg">
                                    취소
                                </button>
                                <button type="submit" className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">
                                    {editingRole ? '수정' : '추가'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
