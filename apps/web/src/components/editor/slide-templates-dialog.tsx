'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    X,
    Layout,
    Type,
    List,
    Image as ImageIcon,
    BarChart2,
    Quote,
    Columns,
    Grid3X3,
    Sparkles,
} from 'lucide-react';

interface SlideTemplate {
    id: string;
    type: string;
    name: string;
    description: string;
    icon: any;
    category: 'basic' | 'content' | 'data' | 'special';
    preview?: string;
}

const SLIDE_TEMPLATES: SlideTemplate[] = [
    {
        id: 'title',
        type: 'TITLE',
        name: '제목 슬라이드',
        description: '발표 시작을 위한 제목과 부제목',
        icon: Type,
        category: 'basic',
    },
    {
        id: 'section',
        type: 'SECTION_HEADER',
        name: '섹션 헤더',
        description: '새로운 섹션 시작을 알리는 슬라이드',
        icon: Type,
        category: 'basic',
    },
    {
        id: 'content',
        type: 'CONTENT',
        name: '내용',
        description: '제목과 본문 텍스트',
        icon: Layout,
        category: 'content',
    },
    {
        id: 'bullet',
        type: 'BULLET_LIST',
        name: '글머리 기호',
        description: '제목과 글머리 기호 목록',
        icon: List,
        category: 'content',
    },
    {
        id: 'two-column',
        type: 'TWO_COLUMN',
        name: '2단 레이아웃',
        description: '내용을 두 열로 나눠 표시',
        icon: Columns,
        category: 'content',
    },
    {
        id: 'image',
        type: 'IMAGE',
        name: '이미지 중심',
        description: '큰 이미지와 캡션',
        icon: ImageIcon,
        category: 'content',
    },
    {
        id: 'chart',
        type: 'CHART',
        name: '차트',
        description: '데이터 시각화 차트',
        icon: BarChart2,
        category: 'data',
    },
    {
        id: 'quote',
        type: 'QUOTE',
        name: '인용문',
        description: '명언이나 중요 인용문 강조',
        icon: Quote,
        category: 'special',
    },
    {
        id: 'grid',
        type: 'CONTENT',
        name: '그리드',
        description: '여러 항목을 그리드로 표시',
        icon: Grid3X3,
        category: 'special',
    },
];

const CATEGORIES = [
    { id: 'all', name: '전체' },
    { id: 'basic', name: '기본' },
    { id: 'content', name: '내용' },
    { id: 'data', name: '데이터' },
    { id: 'special', name: '특수' },
];

interface SlideTemplatesDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectTemplate: (type: string) => void;
    onAiGenerate?: () => void;
}

export function SlideTemplatesDialog({
    isOpen,
    onClose,
    onSelectTemplate,
    onAiGenerate,
}: SlideTemplatesDialogProps) {
    const [selectedCategory, setSelectedCategory] = useState('all');

    if (!isOpen) return null;

    const filteredTemplates = SLIDE_TEMPLATES.filter(
        (t) => selectedCategory === 'all' || t.category === selectedCategory
    );

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-card rounded-xl w-[600px] max-h-[80vh] flex flex-col shadow-xl">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b">
                    <h2 className="text-lg font-semibold">슬라이드 추가</h2>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-secondary rounded transition-colors"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* AI Generate option */}
                {onAiGenerate && (
                    <div className="px-6 py-3 bg-gradient-to-r from-purple-50 to-blue-50 border-b">
                        <button
                            onClick={() => {
                                onAiGenerate();
                                onClose();
                            }}
                            className="w-full flex items-center gap-3 p-3 bg-card rounded-lg border border-purple-200 hover:border-purple-400 hover:shadow-md transition-all"
                        >
                            <div className="p-2 bg-purple-100 rounded-lg">
                                <Sparkles className="h-5 w-5 text-purple-600" />
                            </div>
                            <div className="text-left">
                                <h3 className="font-medium text-foreground">AI로 슬라이드 생성</h3>
                                <p className="text-xs text-muted-foreground">
                                    내용을 입력하면 AI가 적절한 슬라이드를 만들어줍니다
                                </p>
                            </div>
                        </button>
                    </div>
                )}

                {/* Category tabs */}
                <div className="px-6 py-3 flex gap-2 border-b overflow-x-auto">
                    {CATEGORIES.map((cat) => (
                        <button
                            key={cat.id}
                            onClick={() => setSelectedCategory(cat.id)}
                            className={`px-3 py-1.5 text-sm rounded-full whitespace-nowrap transition-colors ${selectedCategory === cat.id
                                    ? 'bg-purple-100 text-purple-700 font-medium'
                                    : 'text-muted-foreground hover:bg-secondary'
                                }`}
                        >
                            {cat.name}
                        </button>
                    ))}
                </div>

                {/* Templates grid */}
                <div className="flex-1 overflow-y-auto p-6">
                    <div className="grid grid-cols-3 gap-4">
                        {filteredTemplates.map((template) => {
                            const Icon = template.icon;
                            return (
                                <button
                                    key={template.id}
                                    onClick={() => {
                                        onSelectTemplate(template.type);
                                        onClose();
                                    }}
                                    className="group flex flex-col items-center p-4 border rounded-lg hover:border-purple-300 hover:bg-purple-50 transition-all"
                                >
                                    <div className="w-full aspect-video bg-gray-100 rounded mb-3 flex items-center justify-center group-hover:bg-white transition-colors">
                                        <Icon className="h-8 w-8 text-muted-foreground group-hover:text-purple-500 transition-colors" />
                                    </div>
                                    <h3 className="text-sm font-medium text-foreground mb-1">
                                        {template.name}
                                    </h3>
                                    <p className="text-xs text-muted-foreground text-center line-clamp-2">
                                        {template.description}
                                    </p>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t bg-secondary flex justify-end">
                    <Button variant="outline" onClick={onClose}>
                        취소
                    </Button>
                </div>
            </div>
        </div>
    );
}

export default SlideTemplatesDialog;
