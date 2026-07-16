'use client';

import { adminFetch } from '@/lib/admin-fetch';

import { useEffect, useState } from 'react';
import { RefreshCw, Server, Database, Trash2, Play, StopCircle, CheckCircle, XCircle } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface SystemHealth {
    status: string;
    services: Record<string, { status: string; latency: number }>;
    memory: { heapUsed: number; heapTotal: number; rss: number };
    uptime: number;
}

interface QueueStatus {
    queued: number;
    processing: number;
}

export default function AdminOperationsPage() {
    const [health, setHealth] = useState<SystemHealth | null>(null);
    const [queue, setQueue] = useState<QueueStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [testModelId, setTestModelId] = useState('');
    const [testResult, setTestResult] = useState<any>(null);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
    }, []);

    const fetchData = async () => {
        try {
            const headers = { };

            const [healthRes, queueRes] = await Promise.all([
                adminFetch(`${API_URL}/admin/operations/health`, { headers }),
                adminFetch(`${API_URL}/admin/operations/queue`, { headers }),
            ]);

            if (healthRes.ok) setHealth(await healthRes.json());
            if (queueRes.ok) setQueue(await queueRes.json());
        } finally {
            setLoading(false);
        }
    };

    const clearCache = async (type: string) => {
        await adminFetch(`${API_URL}/admin/operations/cache/clear`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type }),
        });
        alert('캐시가 삭제되었습니다.');
    };

    const forceStopJobs = async () => {
        if (!confirm('처리 중인 모든 작업을 중지하시겠습니까?')) return;
        const res = await adminFetch(`${API_URL}/admin/operations/jobs/force-stop`, {
            method: 'POST',
            headers: { },
        });
        if (res.ok) {
            const data = await res.json();
            alert(`${data.affectedJobs}개 작업이 중지되었습니다.`);
            fetchData();
        }
    };

    const testModel = async () => {
        if (!testModelId) return;
        const res = await adminFetch(`${API_URL}/admin/operations/model-test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ modelId: testModelId }),
        });
        if (res.ok) {
            setTestResult(await res.json());
        }
    };

    const formatUptime = (seconds: number) => {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        return `${days}d ${hours}h ${mins}m`;
    };

    if (loading) {
        return (
            <div className="p-6 flex items-center justify-center min-h-96">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
            </div>
        );
    }

    return (
        <div className="p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">운영 도구</h1>
                    <p className="text-sm text-gray-500">시스템 상태 및 관리 도구</p>
                </div>
                <button onClick={fetchData} className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200">
                    <RefreshCw size={20} />
                    새로고침
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* System Health */}
                <div className="bg-white rounded-lg p-6 shadow-sm">
                    <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                        <Server size={20} />
                        시스템 상태
                    </h2>

                    {health && (
                        <>
                            <div className="mb-4">
                                <div className="flex items-center gap-2 mb-2">
                                    {health.status === 'healthy' ? (
                                        <CheckCircle className="text-green-500" size={20} />
                                    ) : (
                                        <XCircle className="text-red-500" size={20} />
                                    )}
                                    <span className={`font-medium ${health.status === 'healthy' ? 'text-green-600' : 'text-red-600'}`}>
                                        {health.status === 'healthy' ? '정상' : '문제 발생'}
                                    </span>
                                </div>
                                <p className="text-sm text-gray-500">Uptime: {formatUptime(health.uptime)}</p>
                            </div>

                            <div className="space-y-3">
                                {Object.entries(health.services).map(([name, service]) => (
                                    <div key={name} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                        <div className="flex items-center gap-3">
                                            <div className={`h-2.5 w-2.5 rounded-full ${service.status === 'up' ? 'bg-green-500' : 'bg-red-500'}`} />
                                            <span className="font-medium text-gray-700 capitalize">{name}</span>
                                        </div>
                                        <span className="text-sm text-gray-500">{service.latency}ms</span>
                                    </div>
                                ))}
                            </div>

                            <div className="mt-4 pt-4 border-t">
                                <h3 className="text-sm font-medium text-gray-700 mb-2">메모리 사용량</h3>
                                <div className="space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-500">Heap Used</span>
                                        <span className="text-gray-900">{health.memory.heapUsed} MB</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-500">Heap Total</span>
                                        <span className="text-gray-900">{health.memory.heapTotal} MB</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-500">RSS</span>
                                        <span className="text-gray-900">{health.memory.rss} MB</span>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* Queue Status & Actions */}
                <div className="space-y-6">
                    {/* Queue Status */}
                    <div className="bg-white rounded-lg p-6 shadow-sm">
                        <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                            <Database size={20} />
                            큐 상태
                        </h2>
                        {queue && (
                            <div className="grid grid-cols-2 gap-4">
                                <div className="text-center p-4 bg-gray-50 rounded-lg">
                                    <div className="text-3xl font-bold text-gray-900">{queue.queued}</div>
                                    <div className="text-sm text-gray-500">대기중</div>
                                </div>
                                <div className="text-center p-4 bg-blue-50 rounded-lg">
                                    <div className="text-3xl font-bold text-blue-600">{queue.processing}</div>
                                    <div className="text-sm text-gray-500">처리중</div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Cache Actions */}
                    <div className="bg-white rounded-lg p-6 shadow-sm">
                        <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                            <Trash2 size={20} />
                            캐시 관리
                        </h2>
                        <div className="flex flex-wrap gap-3">
                            <button onClick={() => clearCache('templates')} className="px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 text-sm">
                                템플릿 캐시
                            </button>
                            <button onClick={() => clearCache('models')} className="px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 text-sm">
                                모델 캐시
                            </button>
                            <button onClick={() => clearCache('all')} className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 text-sm">
                                전체 캐시
                            </button>
                        </div>
                    </div>

                    {/* Emergency Actions */}
                    <div className="bg-white rounded-lg p-6 shadow-sm">
                        <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                            <StopCircle size={20} />
                            긴급 작업
                        </h2>
                        <button
                            onClick={forceStopJobs}
                            className="w-full px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center justify-center gap-2"
                        >
                            <StopCircle size={20} />
                            모든 처리 중 작업 강제 중지
                        </button>
                    </div>

                    {/* Model Test */}
                    <div className="bg-white rounded-lg p-6 shadow-sm">
                        <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                            <Play size={20} />
                            모델 테스트
                        </h2>
                        <div className="flex gap-2 mb-4">
                            <input
                                type="text"
                                placeholder="모델 ID 입력..."
                                value={testModelId}
                                onChange={(e) => setTestModelId(e.target.value)}
                                className="flex-1 px-4 py-2 border rounded-lg"
                            />
                            <button onClick={testModel} className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-700">
                                테스트
                            </button>
                        </div>
                        {testResult && (
                            <div className="p-4 bg-gray-50 rounded-lg text-sm">
                                <pre>{JSON.stringify(testResult, null, 2)}</pre>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
