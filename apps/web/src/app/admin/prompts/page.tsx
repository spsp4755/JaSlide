'use client';

import { adminFetch } from '@/lib/admin-fetch';

import { useEffect, useState } from 'react';
import { Plus, MessageSquare, History, Play, Trash2, ChevronRight, X } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface Prompt {
    id: string;
    name: string;
    category: string;
    description: string | null;
    createdAt: string;
    versions: { id: string; version: number; isActive: boolean; content: string }[];
    _count: { versions: number };
}

const defaultFormData = {
    name: '', category: 'generation', description: '', content: '', variables: ''
};

export default function AdminPromptsPage() {
    const [prompts, setPrompts] = useState<Prompt[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
    const [testInput, setTestInput] = useState<Record<string, string>>({});
    const [testResult, setTestResult] = useState<string>('');
    const [showModal, setShowModal] = useState(false);
    const [formData, setFormData] = useState(defaultFormData);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        fetchPrompts();
    }, []);

    const fetchPrompts = async () => {
        setLoading(true);
        try {
            const res = await adminFetch(`${API_URL}/admin/prompts`, { headers: { } });
            if (res.ok) setPrompts((await res.json()).data || []);
        } finally {
            setLoading(false);
        }
    };

    const selectPrompt = async (id: string) => {
        const res = await adminFetch(`${API_URL}/admin/prompts/${id}`, { headers: { } });
        if (res.ok) setSelectedPrompt(await res.json());
    };

    const openCreateModal = () => {
        setFormData(defaultFormData);
        setShowModal(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);

        const payload = {
            name: formData.name,
            category: formData.category,
            description: formData.description || null,
            content: formData.content,
            variables: formData.variables ? formData.variables.split(',').map(v => v.trim()) : [],
        };

        try {
            const res = await adminFetch(`${API_URL}/admin/prompts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (res.ok) {
                setShowModal(false);
                fetchPrompts();
            }
        } finally {
            setSubmitting(false);
        }
    };

    const deletePrompt = async (id: string) => {
        if (!confirm('이 프롬프트를 삭제하시겠습니까?')) return;
        await adminFetch(`${API_URL}/admin/prompts/${id}`, { method: 'DELETE', headers: { } });
        setSelectedPrompt(null);
        fetchPrompts();
    };

    const testPrompt = async () => {
        if (!selectedPrompt) return;
        const res = await adminFetch(`${API_URL}/admin/prompts/${selectedPrompt.id}/test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testInput),
        });
        if (res.ok) {
            const data = await res.json();
            setTestResult(data.rendered);
        }
    };

    const rollbackVersion = async (version: number) => {
        if (!selectedPrompt) return;
        await adminFetch(`${API_URL}/admin/prompts/${selectedPrompt.id}/rollback/${version}`, {
            method: 'POST',
            headers: { },
        });
        selectPrompt(selectedPrompt.id);
    };

    const categoryColors: Record<string, string> = {
        generation: 'bg-blue-100 text-blue-800',
        outline: 'bg-green-100 text-green-800',
        content: 'bg-purple-100 text-purple-800',
        design: 'bg-orange-100 text-orange-800',
    };

    return (
        <div className="p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">프롬프트 관리</h1>
                    <p className="text-sm text-gray-500">프롬프트 템플릿 및 버전 관리</p>
                </div>
                <button onClick={openCreateModal} className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">
                    <Plus size={20} />
                    프롬프트 추가
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Prompts List */}
                <div className="lg:col-span-1 bg-white rounded-lg shadow-sm overflow-hidden">
                    <div className="p-4 border-b font-medium text-gray-900">프롬프트 목록</div>
                    {loading ? (
                        <div className="p-8 text-center">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto" />
                        </div>
                    ) : prompts.length === 0 ? (
                        <div className="p-8 text-center text-gray-500">
                            등록된 프롬프트가 없습니다.
                        </div>
                    ) : (
                        <div className="divide-y max-h-[600px] overflow-y-auto">
                            {prompts.map((prompt) => (
                                <button
                                    key={prompt.id}
                                    onClick={() => selectPrompt(prompt.id)}
                                    className={`w-full p-4 text-left hover:bg-gray-50 flex items-center justify-between ${selectedPrompt?.id === prompt.id ? 'bg-purple-50' : ''}`}
                                >
                                    <div>
                                        <div className="font-medium text-gray-900">{prompt.name}</div>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className={`px-2 py-0.5 text-xs rounded ${categoryColors[prompt.category] || 'bg-gray-100'}`}>
                                                {prompt.category}
                                            </span>
                                            <span className="text-xs text-gray-500">{prompt._count.versions}개 버전</span>
                                        </div>
                                    </div>
                                    <ChevronRight size={16} className="text-gray-400" />
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Prompt Detail */}
                <div className="lg:col-span-2 space-y-6">
                    {selectedPrompt ? (
                        <>
                            {/* Header */}
                            <div className="bg-white rounded-lg shadow-sm p-6">
                                <div className="flex items-start justify-between mb-4">
                                    <div>
                                        <h2 className="text-xl font-semibold text-gray-900">{selectedPrompt.name}</h2>
                                        <p className="text-sm text-gray-500">{selectedPrompt.description}</p>
                                    </div>
                                    <button onClick={() => deletePrompt(selectedPrompt.id)} className="p-2 hover:bg-red-50 rounded"><Trash2 size={20} className="text-red-500" /></button>
                                </div>

                                {/* Current Version */}
                                {selectedPrompt.versions[0] && (
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-medium text-gray-700">현재 버전 (v{selectedPrompt.versions[0].version})</span>
                                            <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded">활성</span>
                                        </div>
                                        <pre className="p-4 bg-gray-50 rounded-lg text-sm text-gray-700 overflow-x-auto whitespace-pre-wrap max-h-48">
                                            {selectedPrompt.versions[0].content}
                                        </pre>
                                    </div>
                                )}
                            </div>

                            {/* Test */}
                            <div className="bg-white rounded-lg shadow-sm p-6">
                                <h3 className="font-medium text-gray-900 mb-4 flex items-center gap-2">
                                    <Play size={18} />
                                    프롬프트 테스트
                                </h3>
                                <div className="space-y-3 mb-4">
                                    <input
                                        type="text"
                                        placeholder="변수 key=value (쉼표로 구분)"
                                        onChange={(e) => {
                                            const pairs = e.target.value.split(',');
                                            const obj: Record<string, string> = {};
                                            pairs.forEach(p => {
                                                const [k, v] = p.split('=');
                                                if (k && v) obj[k.trim()] = v.trim();
                                            });
                                            setTestInput(obj);
                                        }}
                                        className="w-full px-4 py-2 border rounded-lg text-sm"
                                    />
                                    <button onClick={testPrompt} className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700">
                                        테스트 실행
                                    </button>
                                </div>
                                {testResult && (
                                    <pre className="p-4 bg-gray-900 text-green-400 rounded-lg text-sm overflow-x-auto whitespace-pre-wrap max-h-48">
                                        {testResult}
                                    </pre>
                                )}
                            </div>

                            {/* Version History */}
                            <div className="bg-white rounded-lg shadow-sm p-6">
                                <h3 className="font-medium text-gray-900 mb-4 flex items-center gap-2">
                                    <History size={18} />
                                    버전 기록
                                </h3>
                                <div className="space-y-2">
                                    {selectedPrompt.versions.map((v) => (
                                        <div key={v.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                            <div className="flex items-center gap-3">
                                                <span className="font-mono text-sm text-gray-600">v{v.version}</span>
                                                {v.isActive && <span className="px-2 py-0.5 text-xs bg-green-100 text-green-800 rounded">활성</span>}
                                            </div>
                                            {!v.isActive && (
                                                <button onClick={() => rollbackVersion(v.version)} className="px-3 py-1 text-sm text-purple-600 hover:bg-purple-50 rounded">
                                                    롤백
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="bg-white rounded-lg shadow-sm p-12 text-center text-gray-500">
                            <MessageSquare size={48} className="mx-auto mb-4 text-gray-300" />
                            프롬프트를 선택하세요
                        </div>
                    )}
                </div>
            </div>

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4">
                        <div className="flex items-center justify-between p-4 border-b">
                            <h2 className="text-lg font-semibold">새 프롬프트 추가</h2>
                            <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-4 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">프롬프트 이름</label>
                                <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg" required placeholder="예: PPT 생성 프롬프트" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">카테고리</label>
                                <select value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg">
                                    <option value="generation">Generation</option>
                                    <option value="outline">Outline</option>
                                    <option value="content">Content</option>
                                    <option value="design">Design</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">설명</label>
                                <input type="text" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg" placeholder="선택사항" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">프롬프트 내용</label>
                                <textarea value={formData.content} onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg h-32" required placeholder="{{variable}} 형식으로 변수를 사용할 수 있습니다" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">변수 (쉼표로 구분)</label>
                                <input type="text" value={formData.variables} onChange={(e) => setFormData({ ...formData, variables: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg" placeholder="예: topic, industry, language" />
                            </div>
                            <div className="flex justify-end gap-2 pt-4 border-t">
                                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-700 border rounded-lg hover:bg-gray-50">
                                    취소
                                </button>
                                <button type="submit" disabled={submitting} className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
                                    {submitting ? '저장 중...' : '추가'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

