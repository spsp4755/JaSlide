'use client';

import { useState } from 'react';
import {
    ChevronDown,
    ChevronUp,
    Type,
    Palette,
    Layout as LayoutIcon,
    Wand2,
    Accessibility,
} from 'lucide-react';
import { TextProperties } from './properties/text-properties';
import { StyleProperties } from './properties/style-properties';
import { LayoutProperties } from './properties/layout-properties';

interface PropertySection {
    id: string;
    title: string;
    icon: any;
    component: React.ComponentType<any>;
}

const PROPERTY_SECTIONS: PropertySection[] = [
    { id: 'text', title: '텍스트', icon: Type, component: TextProperties },
    { id: 'style', title: '스타일', icon: Palette, component: StyleProperties },
    { id: 'layout', title: '레이아웃', icon: LayoutIcon, component: LayoutProperties },
];

interface PropertyPanelProps {
    selectedObject: any;
    objectType?: 'text' | 'image' | 'shape' | 'chart' | 'slide' | null;
    onUpdate: (updates: any) => void;
}

export function PropertyPanel({ selectedObject, objectType, onUpdate }: PropertyPanelProps) {
    const [expandedSections, setExpandedSections] = useState<string[]>(['text', 'style']);

    const toggleSection = (sectionId: string) => {
        setExpandedSections((prev) =>
            prev.includes(sectionId)
                ? prev.filter((id) => id !== sectionId)
                : [...prev, sectionId]
        );
    };

    // Filter sections based on object type
    const getVisibleSections = (): PropertySection[] => {
        switch (objectType) {
            case 'text':
                return PROPERTY_SECTIONS;
            case 'image':
                return PROPERTY_SECTIONS.filter((s) => ['style', 'layout'].includes(s.id));
            case 'shape':
                return PROPERTY_SECTIONS.filter((s) => ['style', 'layout'].includes(s.id));
            case 'chart':
                return PROPERTY_SECTIONS.filter((s) => ['style', 'layout'].includes(s.id));
            case 'slide':
                return PROPERTY_SECTIONS;
            default:
                return PROPERTY_SECTIONS;
        }
    };

    const visibleSections = getVisibleSections();

    if (!selectedObject) {
        return (
            <div className="p-4">
                <h3 className="font-medium text-foreground mb-4">속성</h3>
                <p className="text-sm text-muted-foreground">객체를 선택하면 속성을 편집할 수 있습니다.</p>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col">
            <div className="p-4 border-b">
                <h3 className="font-medium text-foreground">속성</h3>
                <p className="text-xs text-muted-foreground mt-1">
                    {objectType === 'slide' ? '슬라이드' : objectType || '객체'} 편집
                </p>
            </div>

            <div className="flex-1 overflow-y-auto">
                {visibleSections.map((section) => {
                    const isExpanded = expandedSections.includes(section.id);
                    const SectionComponent = section.component;
                    const Icon = section.icon;

                    return (
                        <div key={section.id} className="border-b">
                            <button
                                onClick={() => toggleSection(section.id)}
                                className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary transition-colors"
                            >
                                <div className="flex items-center gap-2">
                                    <Icon className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-sm font-medium text-foreground">
                                        {section.title}
                                    </span>
                                </div>
                                {isExpanded ? (
                                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                )}
                            </button>

                            {isExpanded && (
                                <div className="px-4 pb-4">
                                    <SectionComponent
                                        value={selectedObject}
                                        onChange={onUpdate}
                                    />
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default PropertyPanel;
