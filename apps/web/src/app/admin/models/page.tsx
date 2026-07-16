'use client';

import { adminFetch } from '@/lib/admin-fetch';

import { useEffect, useState } from 'react';
import { Plus, Cpu, Trash2, Edit, Star, ToggleLeft, ToggleRight, RefreshCw, X } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface LlmModel {
    id: string;
    name: string;
    provider: string;
    modelId: string;
    endpoint: string | null;
    apiKeyEnvVar: string;
    maxTokens: number;
    rateLimit: number | null;
    costPerToken: number;
    isActive: boolean;
    isDefault: boolean;
    config: any;
    createdAt: string;
}

const defaultFormData = {
    name: '', provider: 'openai', modelId: '', endpoint: '', apiKeyEnvVar: 'OPENAI_API_KEY',
    maxTokens: 4096, rateLimit: '', costPerToken: 0.002, isActive: true
};

export default function AdminModelsPage() {
    const [models, setModels] = useState<LlmModel[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingModel, setEditingModel] = useState<LlmModel | null>(null);
    const [formData, setFormData] = useState(defaultFormData);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        fetchModels();
    }, []);

    const fetchModels = async () => {
        setLoading(true);
        try {
            const res = await adminFetch(`${API_URL}/admin/models`, { headers: { } });
            if (res.ok) setModels((await res.json()).data || []);
        } finally {
            setLoading(false);
        }
    };

    const openCreateModal = () => {
        setEditingModel(null);
        setFormData(defaultFormData);
        setShowModal(true);
    };

    const openEditModal = (model: LlmModel) => {
        setEditingModel(model);
        setFormData({
            name: model.name,
            provider: model.provider,
            modelId: model.modelId,
            endpoint: model.endpoint || '',
            apiKeyEnvVar: model.apiKeyEnvVar,
            maxTokens: model.maxTokens,
            rateLimit: model.rateLimit?.toString() || '',
            costPerToken: model.costPerToken,
            isActive: model.isActive,
        });
        setShowModal(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);

        const payload = {
            ...formData,
            rateLimit: formData.rateLimit ? parseInt(formData.rateLimit as string) : null,
        };

        try {
            if (editingModel) {
                await adminFetch(`${API_URL}/admin/models/${editingModel.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
            } else {
                await adminFetch(`${API_URL}/admin/models`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
            }
            setShowModal(false);
            fetchModels();
        } finally {
            setSubmitting(false);
        }
    };

    const setDefault = async (id: string) => {
        await adminFetch(`${API_URL}/admin/models/${id}/set-default`, {
            method: 'POST',
            headers: { },
        });
        fetchModels();
    };

    const toggleActive = async (id: string, isActive: boolean) => {
        await adminFetch(`${API_URL}/admin/models/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive: !isActive }),
        });
        fetchModels();
    };

    const deleteModel = async (id: string) => {
        if (!confirm('이 모델을 삭제하시겠습니까?')) return;
        await adminFetch(`${API_URL}/admin/models/${id}`, { method: 'DELETE', headers: { } });
        fetchModels();
    };

    const providerColors: Record<string, string> = {
        openai: 'bg-green-100 text-green-800',
        anthropic: 'bg-orange-100 text-orange-800',
        google: 'bg-blue-100 text-blue-800',
        azure: 'bg-sky-100 text-sky-800',
        vllm: 'bg-violet-100 text-violet-800',
    };

    return (
        <div className="p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">모델 설정</h1>
                    <p className="text-sm text-gray-500">LLM 모델 레지스트리 관리</p>
                </div>
                <div className="flex gap-2">
                    <button onClick={fetchModels} className="p-2 bg-gray-100 rounded-lg hover:bg-gray-200">
                        <RefreshCw size={20} />
                    </button>
                    <button onClick={openCreateModal} className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">
                        <Plus size={20} />
                        모델 추가
                    </button>
                </div>
            </div>

            {/* Models Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {loading ? (
                    <div className="col-span-full p-8 text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto" />
                    </div>
                ) : models.length === 0 ? (
                    <div className="col-span-full p-8 text-center text-gray-500">
                        등록된 모델이 없습니다. 새 모델을 추가해주세요.
                    </div>
                ) : (
                    models.map((model) => (
                        <div key={model.id} className={`bg-white rounded-lg shadow-sm p-6 ${!model.isActive ? 'opacity-50' : ''}`}>
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                                        <Cpu className="text-purple-600" size={20} />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h3 className="font-semibold text-gray-900">{model.name}</h3>
                                            {model.isDefault && <Star className="text-yellow-500 fill-yellow-500" size={16} />}
                                        </div>
                                        <p className="text-sm text-gray-500">{model.modelId}</p>
                                    </div>
                                </div>
                                <button onClick={() => toggleActive(model.id, model.isActive)}>
                                    {model.isActive ? <ToggleRight className="text-green-500" size={24} /> : <ToggleLeft className="text-gray-400" size={24} />}
                                </button>
                            </div>

                            <div className="flex items-center gap-2 mb-4">
                                <span className={`px-2 py-1 text-xs rounded-full ${providerColors[model.provider] || 'bg-gray-100'}`}>
                                    {model.provider}
                                </span>
                                <span className="px-2 py-1 text-xs bg-gray-100 rounded-full">{model.maxTokens} tokens</span>
                            </div>

                            <div className="text-sm text-gray-500 space-y-1">
                                <div className="flex justify-between">
                                    <span>Cost/token:</span>
                                    <span className="text-gray-900">${model.costPerToken}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Rate limit:</span>
                                    <span className="text-gray-900">{model.rateLimit || '없음'}/min</span>
                                </div>
                            </div>

                            <div className="flex gap-2 pt-4 mt-4 border-t">
                                {!model.isDefault && (
                                    <button onClick={() => setDefault(model.id)} className="flex-1 px-3 py-2 bg-yellow-50 text-yellow-700 rounded-lg text-sm hover:bg-yellow-100">
                                        기본 설정
                                    </button>
                                )}
                                <button onClick={() => openEditModal(model)} className="p-2 hover:bg-gray-100 rounded-lg"><Edit size={16} className="text-gray-500" /></button>
                                <button onClick={() => deleteModel(model.id)} className="p-2 hover:bg-red-50 rounded-lg"><Trash2 size={16} className="text-red-500" /></button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
                        <div className="flex items-center justify-between p-4 border-b">
                            <h2 className="text-lg font-semibold">{editingModel ? '모델 수정' : '새 모델 추가'}</h2>
                            <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-4 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">모델 이름</label>
                                <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg" required placeholder="예: GPT-4o" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Provider</label>
                                <select value={formData.provider} onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg">
                                    <option value="openai">OpenAI</option>
                                    <option value="anthropic">Anthropic</option>
                                    <option value="google">Google</option>
                                    <option value="azure">Azure OpenAI</option>
                                    <option value="vllm">vLLM (OpenAI Compatible)</option>
                                </select>
                            </div>
                            {(formData.provider === 'vllm' || formData.provider === 'azure') && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        API URL <span className="text-red-500">*</span>
                                    </label>
                                    <input type="url" value={formData.endpoint} onChange={(e) => setFormData({ ...formData, endpoint: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-lg" required
                                        placeholder={formData.provider === 'vllm' ? 'http://localhost:8000/v1' : 'https://your-resource.openai.azure.com/'} />
                                    <p className="text-xs text-gray-500 mt-1">
                                        {formData.provider === 'vllm' ? 'vLLM 서버의 OpenAI Compatible API 엔드포인트' : 'Azure OpenAI 리소스 URL'}
                                    </p>
                                </div>
                            )}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Model ID</label>
                                <input type="text" value={formData.modelId} onChange={(e) => setFormData({ ...formData, modelId: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg" required placeholder="예: gpt-4o" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">API Key 환경변수</label>
                                <input type="text" value={formData.apiKeyEnvVar} onChange={(e) => setFormData({ ...formData, apiKeyEnvVar: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg" placeholder="OPENAI_API_KEY" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Max Tokens</label>
                                    <input type="number" value={formData.maxTokens} onChange={(e) => setFormData({ ...formData, maxTokens: parseInt(e.target.value) })}
                                        className="w-full px-3 py-2 border rounded-lg" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Cost/Token ($)</label>
                                    <input type="number" step="0.0001" value={formData.costPerToken} onChange={(e) => setFormData({ ...formData, costPerToken: parseFloat(e.target.value) })}
                                        className="w-full px-3 py-2 border rounded-lg" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Rate Limit (요청/분)</label>
                                <input type="number" value={formData.rateLimit} onChange={(e) => setFormData({ ...formData, rateLimit: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg" placeholder="선택사항" />
                            </div>
                            <div className="flex justify-end gap-2 pt-4 border-t">
                                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-700 border rounded-lg hover:bg-gray-50">
                                    취소
                                </button>
                                <button type="submit" disabled={submitting} className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
                                    {submitting ? '저장 중...' : (editingModel ? '수정' : '추가')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

