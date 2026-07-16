'use client';

import { adminFetch } from '@/lib/admin-fetch';

import { useEffect, useState } from 'react';
import { Plus, CreditCard, DollarSign, Trash2, Edit, ToggleLeft, ToggleRight } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface CreditPolicy {
    id: string;
    name: string;
    modelType: string;
    modelName: string | null;
    costPerUnit: number;
    description: string | null;
    isActive: boolean;
}

interface PricingPlan {
    id: string;
    name: string;
    displayName: string;
    monthlyCredits: number;
    price: number;
    features: string[];
    isActive: boolean;
    sortOrder: number;
}

interface CreditStats {
    last30Days: { totalUsage: number; transactionCount: number };
    byType: { type: string; _sum: { amount: number }; _count: number }[];
}

type Tab = 'policies' | 'plans';

export default function AdminCreditsPage() {
    const [tab, setTab] = useState<Tab>('policies');
    const [policies, setPolicies] = useState<CreditPolicy[]>([]);
    const [plans, setPlans] = useState<PricingPlan[]>([]);
    const [stats, setStats] = useState<CreditStats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchData();
    }, [tab]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const headers = { };

            if (tab === 'policies') {
                const res = await adminFetch(`${API_URL}/admin/credits/policies`, { headers });
                if (res.ok) setPolicies((await res.json()).data);
            } else {
                const res = await adminFetch(`${API_URL}/admin/credits/plans`, { headers });
                if (res.ok) setPlans((await res.json()).data);
            }

            const statsRes = await adminFetch(`${API_URL}/admin/credits/stats`, { headers });
            if (statsRes.ok) setStats(await statsRes.json());
        } finally {
            setLoading(false);
        }
    };

    const togglePolicy = async (id: string, isActive: boolean) => {
        await adminFetch(`${API_URL}/admin/credits/policies/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive: !isActive }),
        });
        fetchData();
    };

    const togglePlan = async (id: string, isActive: boolean) => {
        await adminFetch(`${API_URL}/admin/credits/plans/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive: !isActive }),
        });
        fetchData();
    };

    return (
        <div className="p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">크레딧 관리</h1>
                    <p className="text-sm text-gray-500">정책 및 가격 플랜 관리</p>
                </div>
                <button className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-700">
                    <Plus size={20} />
                    {tab === 'policies' ? '정책 추가' : '플랜 추가'}
                </button>
            </div>

            {/* Stats */}
            {stats && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div className="bg-white rounded-lg p-4 shadow-sm">
                        <div className="text-sm text-gray-500">30일 사용량</div>
                        <div className="text-2xl font-bold text-gray-900">{stats.last30Days.totalUsage.toLocaleString()}</div>
                    </div>
                    <div className="bg-white rounded-lg p-4 shadow-sm">
                        <div className="text-sm text-gray-500">거래 수</div>
                        <div className="text-2xl font-bold text-gray-900">{stats.last30Days.transactionCount.toLocaleString()}</div>
                    </div>
                    {stats.byType.slice(0, 2).map((item) => (
                        <div key={item.type} className="bg-white rounded-lg p-4 shadow-sm">
                            <div className="text-sm text-gray-500">{item.type}</div>
                            <div className="text-2xl font-bold text-gray-900">{Math.abs(item._sum.amount || 0).toLocaleString()}</div>
                        </div>
                    ))}
                </div>
            )}

            {/* Tabs */}
            <div className="flex border-b mb-6">
                <button
                    onClick={() => setTab('policies')}
                    className={`flex items-center gap-2 px-4 py-3 border-b-2 -mb-px ${tab === 'policies' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500'
                        }`}
                >
                    <CreditCard size={18} />
                    크레딧 정책
                </button>
                <button
                    onClick={() => setTab('plans')}
                    className={`flex items-center gap-2 px-4 py-3 border-b-2 -mb-px ${tab === 'plans' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500'
                        }`}
                >
                    <DollarSign size={18} />
                    가격 플랜
                </button>
            </div>

            {/* Content */}
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                {loading ? (
                    <div className="p-8 text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto" />
                    </div>
                ) : tab === 'policies' ? (
                    <table className="w-full">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">이름</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">모델 타입</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">단위당 비용</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">상태</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">작업</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {policies.map((policy) => (
                                <tr key={policy.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4">
                                        <div className="font-medium text-gray-900">{policy.name}</div>
                                        <div className="text-sm text-gray-500">{policy.description}</div>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-700">{policy.modelType}</td>
                                    <td className="px-6 py-4 text-sm text-gray-900">{policy.costPerUnit} 크레딧</td>
                                    <td className="px-6 py-4">
                                        <button onClick={() => togglePolicy(policy.id, policy.isActive)} className="flex items-center">
                                            {policy.isActive ? (
                                                <ToggleRight className="text-green-500" size={28} />
                                            ) : (
                                                <ToggleLeft className="text-gray-400" size={28} />
                                            )}
                                        </button>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <button className="p-1.5 hover:bg-gray-100 rounded"><Edit size={16} className="text-gray-500" /></button>
                                        <button className="p-1.5 hover:bg-red-50 rounded"><Trash2 size={16} className="text-red-500" /></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-6">
                        {plans.map((plan) => (
                            <div key={plan.id} className={`border rounded-xl p-6 ${plan.isActive ? '' : 'opacity-50'}`}>
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <h3 className="font-semibold text-gray-900">{plan.displayName}</h3>
                                        <p className="text-sm text-gray-500">{plan.name}</p>
                                    </div>
                                    <button onClick={() => togglePlan(plan.id, plan.isActive)}>
                                        {plan.isActive ? <ToggleRight className="text-green-500" size={24} /> : <ToggleLeft className="text-gray-400" size={24} />}
                                    </button>
                                </div>
                                <div className="mb-4">
                                    <span className="text-3xl font-bold text-gray-900">${plan.price}</span>
                                    <span className="text-gray-500">/월</span>
                                </div>
                                <div className="text-sm text-gray-900 mb-4">{plan.monthlyCredits.toLocaleString()} 크레딧/월</div>
                                <ul className="space-y-2 text-sm text-gray-600">
                                    {plan.features.map((feature, i) => (
                                        <li key={i}>✓ {feature}</li>
                                    ))}
                                </ul>
                                <div className="mt-4 pt-4 border-t flex gap-2">
                                    <button className="flex-1 px-3 py-2 border rounded-lg text-sm hover:bg-gray-50">수정</button>
                                    <button className="px-3 py-2 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50">삭제</button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
