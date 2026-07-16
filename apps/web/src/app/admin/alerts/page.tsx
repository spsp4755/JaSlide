'use client';

import { adminFetch } from '@/lib/admin-fetch';

import { useEffect, useState } from 'react';
import { Plus, Bell, Trash2, Edit, ToggleLeft, ToggleRight } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface Alert {
    id: string;
    name: string;
    eventType: string;
    channel: string;
    config: any;
    isActive: boolean;
    createdAt: string;
}

const eventTypes = ['ERROR', 'USER_SIGNUP', 'HIGH_USAGE', 'JOB_FAILED', 'CREDIT_LOW', 'SYSTEM_ALERT'];
const channels = ['EMAIL', 'SLACK', 'WEBHOOK', 'SMS'];

export default function AdminAlertsPage() {
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [formData, setFormData] = useState({ name: '', eventType: 'ERROR', channel: 'EMAIL', config: '{}' });

    useEffect(() => {
        fetchAlerts();
    }, []);

    const fetchAlerts = async () => {
        setLoading(true);
        try {
            const res = await adminFetch(`${API_URL}/admin/alerts`, { headers: { } });
            if (res.ok) setAlerts((await res.json()).data);
        } finally {
            setLoading(false);
        }
    };

    const toggleAlert = async (id: string, isActive: boolean) => {
        await adminFetch(`${API_URL}/admin/alerts/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive: !isActive }),
        });
        fetchAlerts();
    };

    const deleteAlert = async (id: string) => {
        if (!confirm('이 알림을 삭제하시겠습니까?')) return;
        await adminFetch(`${API_URL}/admin/alerts/${id}`, { method: 'DELETE', headers: { } });
        fetchAlerts();
    };

    const createAlert = async (e: React.FormEvent) => {
        e.preventDefault();
        let config = {};
        try { config = JSON.parse(formData.config); } catch { }

        await adminFetch(`${API_URL}/admin/alerts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...formData, config }),
        });
        setShowModal(false);
        fetchAlerts();
    };

    const channelColors: Record<string, string> = {
        EMAIL: 'bg-blue-100 text-blue-800',
        SLACK: 'bg-purple-100 text-purple-800',
        WEBHOOK: 'bg-green-100 text-green-800',
        SMS: 'bg-orange-100 text-orange-800',
    };

    return (
        <div className="p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">알림 관리</h1>
                    <p className="text-sm text-gray-500">이벤트 알림 설정</p>
                </div>
                <button onClick={() => setShowModal(true)} className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">
                    <Plus size={20} />
                    알림 추가
                </button>
            </div>

            {/* Alerts Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {loading ? (
                    <div className="col-span-full p-8 text-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto" /></div>
                ) : (
                    alerts.map((alert) => (
                        <div key={alert.id} className={`bg-white rounded-lg shadow-sm p-6 ${!alert.isActive ? 'opacity-50' : ''}`}>
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                                        <Bell className="text-purple-600" size={20} />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-gray-900">{alert.name}</h3>
                                        <p className="text-sm text-gray-500">{alert.eventType}</p>
                                    </div>
                                </div>
                                <button onClick={() => toggleAlert(alert.id, alert.isActive)}>
                                    {alert.isActive ? <ToggleRight className="text-green-500" size={24} /> : <ToggleLeft className="text-gray-400" size={24} />}
                                </button>
                            </div>

                            <div className="flex items-center gap-2 mb-4">
                                <span className={`px-2 py-1 text-xs rounded-full ${channelColors[alert.channel] || ''}`}>
                                    {alert.channel}
                                </span>
                            </div>

                            <div className="text-xs text-gray-500 mb-4">
                                <pre className="bg-gray-50 p-2 rounded overflow-x-auto">{JSON.stringify(alert.config, null, 2)}</pre>
                            </div>

                            <div className="flex gap-2 pt-4 border-t">
                                <button className="flex-1 px-3 py-2 border rounded-lg text-sm hover:bg-gray-50">
                                    <Edit size={14} className="inline mr-1" /> 수정
                                </button>
                                <button onClick={() => deleteAlert(alert.id)} className="px-3 py-2 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50">
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Create Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl w-full max-w-md p-6">
                        <h2 className="text-lg font-semibold mb-4">알림 추가</h2>
                        <form onSubmit={createAlert} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">이름</label>
                                <input type="text" value={formData.name} onChange={(e) => setFormData(p => ({ ...p, name: e.target.value }))}
                                    className="w-full px-4 py-2 border rounded-lg" required />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">이벤트 타입</label>
                                <select value={formData.eventType} onChange={(e) => setFormData(p => ({ ...p, eventType: e.target.value }))}
                                    className="w-full px-4 py-2 border rounded-lg">
                                    {eventTypes.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">채널</label>
                                <select value={formData.channel} onChange={(e) => setFormData(p => ({ ...p, channel: e.target.value }))}
                                    className="w-full px-4 py-2 border rounded-lg">
                                    {channels.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">설정 (JSON)</label>
                                <textarea value={formData.config} onChange={(e) => setFormData(p => ({ ...p, config: e.target.value }))}
                                    className="w-full px-4 py-2 border rounded-lg font-mono text-sm" rows={3} />
                            </div>
                            <div className="flex gap-3 pt-4">
                                <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-4 py-2 border rounded-lg">취소</button>
                                <button type="submit" className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">추가</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
