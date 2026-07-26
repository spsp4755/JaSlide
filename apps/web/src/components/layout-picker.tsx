'use client';

import { useState } from 'react';
import {
    LayoutGrid,
    AlignLeft,
    AlignCenter,
    AlignRight,
    Columns,
    Image as ImageIcon,
} from 'lucide-react';

interface LayoutPickerProps {
    value: string;
    onChange: (layout: string) => void;
    slideType?: string;
}

const LAYOUTS = [
    {
        id: 'center',
        label: '중앙',
        icon: AlignCenter,
        description: '콘텐츠가 중앙에 정렬됩니다',
    },
    {
        id: 'left',
        label: '왼쪽',
        icon: AlignLeft,
        description: '콘텐츠가 왼쪽에 정렬됩니다',
    },
    {
        id: 'right',
        label: '오른쪽',
        icon: AlignRight,
        description: '콘텐츠가 오른쪽에 정렬됩니다',
    },
    {
        id: 'two-column-equal',
        label: '2단 균등',
        icon: Columns,
        description: '두 개의 동일한 컬럼으로 나뉩니다',
    },
    {
        id: 'image-left',
        label: '이미지 왼쪽',
        icon: ImageIcon,
        description: '이미지가 왼쪽, 텍스트가 오른쪽',
    },
    {
        id: 'image-right',
        label: '이미지 오른쪽',
        icon: ImageIcon,
        description: '텍스트가 왼쪽, 이미지가 오른쪽',
    },
];

export function LayoutPicker({ value, onChange, slideType }: LayoutPickerProps) {
    const [isOpen, setIsOpen] = useState(false);

    // Filter layouts based on slide type
    const availableLayouts = LAYOUTS.filter((layout) => {
        if (slideType === 'TITLE' || slideType === 'SECTION_HEADER' || slideType === 'QUOTE') {
            return ['center', 'left', 'right'].includes(layout.id);
        }
        return true;
    });

    const selectedLayout = LAYOUTS.find((l) => l.id === value) || LAYOUTS[0];
    const Icon = selectedLayout.icon;

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center gap-3 px-3 py-2 border rounded-lg hover:bg-secondary transition-colors"
            >
                <Icon className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1 text-left">
                    <div className="text-sm font-medium">{selectedLayout.label}</div>
                    <div className="text-xs text-muted-foreground">{selectedLayout.description}</div>
                </div>
                <LayoutGrid className="h-4 w-4 text-muted-foreground" />
            </button>

            {isOpen && (
                <>
                    <div
                        className="fixed inset-0 z-10"
                        onClick={() => setIsOpen(false)}
                    />
                    <div className="absolute left-0 right-0 top-full mt-2 bg-card rounded-lg shadow-xl border z-20 p-2">
                        <div className="grid grid-cols-2 gap-2">
                            {availableLayouts.map((layout) => {
                                const LayoutIcon = layout.icon;
                                const isSelected = layout.id === value;
                                return (
                                    <button
                                        key={layout.id}
                                        onClick={() => {
                                            onChange(layout.id);
                                            setIsOpen(false);
                                        }}
                                        className={`flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all ${isSelected
                                                ? 'border-purple-500 bg-purple-50'
                                                : 'border-transparent hover:bg-secondary'
                                            }`}
                                    >
                                        <div
                                            className={`w-full aspect-video rounded border-2 flex items-center justify-center ${isSelected ? 'border-purple-300 bg-purple-100' : 'border-gray-200 bg-gray-50'
                                                }`}
                                        >
                                            <LayoutIcon className={`h-6 w-6 ${isSelected ? 'text-purple-600' : 'text-muted-foreground'}`} />
                                        </div>
                                        <span className={`text-xs font-medium ${isSelected ? 'text-purple-700' : 'text-muted-foreground'}`}>
                                            {layout.label}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
