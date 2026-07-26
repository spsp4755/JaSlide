'use client';

import { useState, useCallback } from 'react';
import {
    Package,
    Plus,
    Search,
    Star,
    Trash2,
    Edit3,
    Copy,
    MoreVertical,
    Grid,
    List,
    Layout,
    Type,
    Image,
    BarChart2,
} from 'lucide-react';

interface ComponentLibraryProps {
    components: ComponentItem[];
    onInsertComponent: (component: ComponentItem) => void;
    onSaveComponent: (name: string, description: string, content: any) => void;
    onDeleteComponent: (id: string) => void;
    onUpdateComponent: (id: string, updates: Partial<ComponentItem>) => void;
}

export interface ComponentItem {
    id: string;
    name: string;
    description?: string;
    type: 'text' | 'image' | 'chart' | 'layout' | 'custom';
    thumbnail?: string;
    content: any;
    isFavorite: boolean;
    usageCount: number;
    createdAt: string;
    updatedAt: string;
}

// 기본 컴포넌트 카테고리
const COMPONENT_CATEGORIES = [
    { id: 'all', name: '전체', icon: Package },
    { id: 'text', name: '텍스트', icon: Type },
    { id: 'image', name: '이미지', icon: Image },
    { id: 'chart', name: '차트', icon: BarChart2 },
    { id: 'layout', name: '레이아웃', icon: Layout },
];

// 기본 제공 컴포넌트
const DEFAULT_COMPONENTS: ComponentItem[] = [
    {
        id: 'default-heading',
        name: '섹션 제목',
        description: '강조된 섹션 제목 스타일',
        type: 'text',
        content: {
            text: '섹션 제목',
            style: {
                fontSize: 32,
                fontWeight: '700',
                color: '#1F2937',
            },
        },
        isFavorite: true,
        usageCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    },
    {
        id: 'default-subtitle',
        name: '부제목',
        description: '가벼운 부제목 스타일',
        type: 'text',
        content: {
            text: '부제목 텍스트',
            style: {
                fontSize: 18,
                fontWeight: '400',
                color: '#6B7280',
            },
        },
        isFavorite: false,
        usageCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    },
    {
        id: 'default-callout',
        name: '강조 박스',
        description: '중요 내용 강조 박스',
        type: 'layout',
        content: {
            style: {
                backgroundColor: '#EEF2FF',
                borderLeft: '4px solid #6366F1',
                padding: '16px',
                borderRadius: '8px',
            },
        },
        isFavorite: true,
        usageCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    },
    {
        id: 'default-quote',
        name: '인용문',
        description: '인용문 스타일',
        type: 'text',
        content: {
            text: '"인용문 텍스트"',
            style: {
                fontSize: 24,
                fontStyle: 'italic',
                color: '#4B5563',
                textAlign: 'center',
            },
        },
        isFavorite: false,
        usageCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    },
];

export function ComponentLibrary({
    components: userComponents,
    onInsertComponent,
    onSaveComponent,
    onDeleteComponent,
    onUpdateComponent,
}: ComponentLibraryProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [isCreating, setIsCreating] = useState(false);
    const [newComponentName, setNewComponentName] = useState('');
    const [newComponentDesc, setNewComponentDesc] = useState('');

    // 기본 + 사용자 컴포넌트 합치기
    const allComponents = [...DEFAULT_COMPONENTS, ...userComponents];

    // 필터링
    const filteredComponents = allComponents.filter((comp) => {
        const matchesSearch = comp.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            comp.description?.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = selectedCategory === 'all' || comp.type === selectedCategory;
        return matchesSearch && matchesCategory;
    });

    // 즐겨찾기 토글
    const toggleFavorite = (id: string) => {
        const comp = allComponents.find(c => c.id === id);
        if (comp && !comp.id.startsWith('default-')) {
            onUpdateComponent(id, { isFavorite: !comp.isFavorite });
        }
    };

    // 타입별 아이콘
    const getTypeIcon = (type: ComponentItem['type']) => {
        switch (type) {
            case 'text': return Type;
            case 'image': return Image;
            case 'chart': return BarChart2;
            case 'layout': return Layout;
            default: return Package;
        }
    };

    return (
        <div className="h-full flex flex-col bg-card">
            {/* 헤더 */}
            <div className="px-3 py-2 border-b">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <Package className="h-4 w-4 text-purple-600" />
                        <span className="text-sm font-medium text-foreground">컴포넌트</span>
                    </div>
                    <div className="flex gap-1">
                        <button
                            onClick={() => setViewMode('grid')}
                            className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-purple-100 text-purple-600' : 'text-muted-foreground hover:bg-secondary'}`}
                        >
                            <Grid className="h-3.5 w-3.5" />
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-purple-100 text-purple-600' : 'text-muted-foreground hover:bg-secondary'}`}
                        >
                            <List className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>

                {/* 검색 */}
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="컴포넌트 검색..."
                        className="w-full pl-8 pr-3 py-1.5 text-xs border rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                </div>
            </div>

            {/* 카테고리 필터 */}
            <div className="flex gap-1 px-3 py-2 border-b overflow-x-auto">
                {COMPONENT_CATEGORIES.map((cat) => (
                    <button
                        key={cat.id}
                        onClick={() => setSelectedCategory(cat.id)}
                        className={`flex items-center gap-1 px-2 py-1 text-xs rounded-full whitespace-nowrap transition-colors ${selectedCategory === cat.id
                                ? 'bg-purple-100 text-purple-700'
                                : 'bg-secondary text-muted-foreground hover:bg-muted'
                            }`}
                    >
                        <cat.icon className="h-3 w-3" />
                        {cat.name}
                    </button>
                ))}
            </div>

            {/* 컴포넌트 목록 */}
            <div className="flex-1 overflow-y-auto p-2">
                {filteredComponents.length === 0 ? (
                    <div className="text-center text-xs text-muted-foreground py-8">
                        검색 결과가 없습니다
                    </div>
                ) : viewMode === 'grid' ? (
                    <div className="grid grid-cols-2 gap-2">
                        {filteredComponents.map((comp) => {
                            const TypeIcon = getTypeIcon(comp.type);
                            return (
                                <div
                                    key={comp.id}
                                    className="group border rounded-lg p-2 hover:border-purple-300 hover:bg-purple-50/50 transition-colors cursor-pointer"
                                    onClick={() => onInsertComponent(comp)}
                                >
                                    {/* 미리보기 영역 */}
                                    <div className="aspect-video bg-gray-100 rounded mb-2 flex items-center justify-center relative">
                                        <TypeIcon className="h-6 w-6 text-muted-foreground" />
                                        {comp.isFavorite && (
                                            <Star className="absolute top-1 right-1 h-3 w-3 text-amber-400 fill-amber-400" />
                                        )}
                                    </div>
                                    <div className="text-xs font-medium text-foreground truncate">
                                        {comp.name}
                                    </div>
                                    {comp.description && (
                                        <div className="text-[10px] text-muted-foreground truncate">
                                            {comp.description}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="space-y-1">
                        {filteredComponents.map((comp) => {
                            const TypeIcon = getTypeIcon(comp.type);
                            return (
                                <div
                                    key={comp.id}
                                    className="group flex items-center gap-2 p-2 rounded-lg hover:bg-secondary transition-colors cursor-pointer"
                                    onClick={() => onInsertComponent(comp)}
                                >
                                    <div className="w-8 h-8 bg-secondary rounded flex items-center justify-center">
                                        <TypeIcon className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1">
                                            <span className="text-xs font-medium text-foreground truncate">
                                                {comp.name}
                                            </span>
                                            {comp.isFavorite && (
                                                <Star className="h-3 w-3 text-amber-400 fill-amber-400" />
                                            )}
                                        </div>
                                        {comp.description && (
                                            <div className="text-[10px] text-muted-foreground truncate">
                                                {comp.description}
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            toggleFavorite(comp.id);
                                        }}
                                        className="p-1 opacity-0 group-hover:opacity-100 hover:bg-muted rounded transition-all"
                                    >
                                        <Star className={`h-3 w-3 ${comp.isFavorite ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground'}`} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* 새 컴포넌트 추가 */}
            <div className="border-t p-2">
                {isCreating ? (
                    <div className="space-y-2">
                        <input
                            type="text"
                            value={newComponentName}
                            onChange={(e) => setNewComponentName(e.target.value)}
                            placeholder="컴포넌트 이름"
                            className="w-full px-2.5 py-1.5 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                        />
                        <input
                            type="text"
                            value={newComponentDesc}
                            onChange={(e) => setNewComponentDesc(e.target.value)}
                            placeholder="설명 (선택)"
                            className="w-full px-2.5 py-1.5 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                        />
                        <div className="flex gap-1">
                            <button
                                onClick={() => {
                                    if (newComponentName) {
                                        onSaveComponent(newComponentName, newComponentDesc, {});
                                        setNewComponentName('');
                                        setNewComponentDesc('');
                                        setIsCreating(false);
                                    }
                                }}
                                className="flex-1 py-1.5 text-xs bg-purple-600 text-white rounded hover:bg-purple-700"
                            >
                                저장
                            </button>
                            <button
                                onClick={() => {
                                    setIsCreating(false);
                                    setNewComponentName('');
                                    setNewComponentDesc('');
                                }}
                                className="flex-1 py-1.5 text-xs bg-secondary text-muted-foreground rounded hover:bg-muted"
                            >
                                취소
                            </button>
                        </div>
                    </div>
                ) : (
                    <button
                        onClick={() => setIsCreating(true)}
                        className="w-full flex items-center justify-center gap-1 py-2 text-xs text-purple-600 hover:bg-purple-50 rounded transition-colors"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        선택 영역을 컴포넌트로 저장
                    </button>
                )}
            </div>
        </div>
    );
}

export default ComponentLibrary;
