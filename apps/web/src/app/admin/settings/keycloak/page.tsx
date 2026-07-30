'use client';

import { adminFetch } from '@/lib/admin-fetch';

import { useEffect, useState } from 'react';
import { ShieldCheck, Save, RefreshCw } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '/api';

interface KeycloakSettings {
    issuer: string;
    clientId: string;
    clientSecretSet: boolean;
    redirectUri: string;
    adminRoles: string;
}

const emptyForm = { issuer: '', clientId: '', clientSecret: '', redirectUri: '', adminRoles: '' };

export default function AdminKeycloakSettingsPage() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [clientSecretSet, setClientSecretSet] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 6000);
    };

    const fetchSettings = async () => {
        setLoading(true);
        try {
            const res = await adminFetch(`${API_URL}/admin/settings/keycloak`);
            if (res.ok) {
                const data: KeycloakSettings = await res.json();
                setForm({
                    issuer: data.issuer, clientId: data.clientId, clientSecret: '',
                    redirectUri: data.redirectUri, adminRoles: data.adminRoles,
                });
                setClientSecretSet(data.clientSecretSet);
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSettings();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            const payload: any = {
                issuer: form.issuer, clientId: form.clientId,
                redirectUri: form.redirectUri, adminRoles: form.adminRoles,
            };
            // 비워두면 기존에 저장된 클라이언트 시크릿을 유지합니다.
            if (form.clientSecret) payload.clientSecret = form.clientSecret;

            const res = await adminFetch(`${API_URL}/admin/settings/keycloak`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) {
                showToast(data.message || '저장하지 못했습니다.', 'error');
                return;
            }
            setForm((prev) => ({ ...prev, clientSecret: '' }));
            setClientSecretSet(data.clientSecretSet);
            showToast('저장되었습니다. 다음 로그인부터 즉시 적용됩니다 (재시작 불필요).');
        } catch {
            showToast('관리자 API에 연결할 수 없습니다.', 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="p-6 max-w-2xl">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                        <ShieldCheck size={24} /> Keycloak / SSO 설정
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        저장하면 재시작 없이 다음 로그인부터 바로 적용됩니다. 모두 비워두면 SSO 로그인이 비활성화됩니다.
                    </p>
                </div>
                <button onClick={fetchSettings} className="p-2 bg-secondary rounded-lg hover:bg-muted">
                    <RefreshCw size={20} />
                </button>
            </div>

            {loading ? (
                <div className="p-8 text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto" />
                </div>
            ) : (
                <form onSubmit={handleSubmit} className="bg-card rounded-lg shadow-sm p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-foreground mb-1">Issuer URL</label>
                        <input type="text" value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })}
                            className="w-full px-3 py-2 border rounded-lg" placeholder="https://keycloak.internal/realms/company" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-foreground mb-1">Client ID</label>
                        <input type="text" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                            className="w-full px-3 py-2 border rounded-lg" placeholder="jaslide-web" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-foreground mb-1">Client Secret</label>
                        <input type="password" value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
                            className="w-full px-3 py-2 border rounded-lg" autoComplete="new-password"
                            placeholder={clientSecretSet ? '저장됨 — 변경하려면 새 값을 입력하세요' : '(선택) 공개 클라이언트라면 비워두세요'} />
                        <p className="mt-1 text-xs text-muted-foreground">
                            {clientSecretSet ? '값이 저장되어 있습니다. 비워두면 기존 값을 유지합니다.' : '저장된 값이 없습니다.'}
                        </p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-foreground mb-1">Redirect URI</label>
                        <input type="text" value={form.redirectUri} onChange={(e) => setForm({ ...form, redirectUri: e.target.value })}
                            className="w-full px-3 py-2 border rounded-lg" placeholder="https://jaslide.internal/api/auth/keycloak/callback" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-foreground mb-1">관리자 매핑 역할 (Realm/Client Role)</label>
                        <input type="text" value={form.adminRoles} onChange={(e) => setForm({ ...form, adminRoles: e.target.value })}
                            className="w-full px-3 py-2 border rounded-lg" placeholder="jaslide-admin, jaslide-owner" />
                        <p className="mt-1 text-xs text-muted-foreground">쉼표로 구분합니다. 이 역할을 가진 사용자는 로그인 시 ADMIN으로 매핑됩니다.</p>
                    </div>
                    <div className="flex justify-end pt-4 border-t">
                        <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50">
                            <Save size={16} /> {saving ? '저장 중...' : '저장'}
                        </button>
                    </div>
                </form>
            )}

            {toast && (
                <div role="status" aria-live="polite" className={`fixed top-4 right-4 z-50 max-w-md rounded-lg px-4 py-3 shadow-lg ${toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
                    {toast.message}
                </div>
            )}
        </div>
    );
}
