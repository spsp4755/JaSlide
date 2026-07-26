'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    HelpCircle,
    X,
    MessageCircle,
    Book,
    ExternalLink,
    Search,
    Keyboard,
    Mail,
} from 'lucide-react';

interface HelpItem {
    id: string;
    title: string;
    description: string;
    icon: React.ElementType;
    link?: string;
    action?: () => void;
}

const HELP_ITEMS: HelpItem[] = [
    {
        id: 'guide',
        title: '사용 가이드',
        description: 'TaeSlide 사용법을 단계별로 알아보세요',
        icon: Book,
        link: '/docs/guide',
    },
    {
        id: 'shortcuts',
        title: '키보드 단축키',
        description: '빠른 작업을 위한 단축키 모음',
        icon: Keyboard,
    },
    {
        id: 'faq',
        title: '자주 묻는 질문',
        description: '일반적인 질문에 대한 답변',
        icon: MessageCircle,
        link: '/docs/faq',
    },
    {
        id: 'contact',
        title: '문의하기',
        description: '도움이 필요하시면 연락주세요',
        icon: Mail,
        link: 'mailto:support@jaslide.com',
    },
];

interface QuickHelpProps {
    onShortcutsClick?: () => void;
    className?: string;
}

export function QuickHelp({ onShortcutsClick, className = '' }: QuickHelpProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    const filteredItems = HELP_ITEMS.filter(
        (item) =>
            item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.description.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleItemClick = (item: HelpItem) => {
        if (item.id === 'shortcuts') {
            onShortcutsClick?.();
            setIsOpen(false);
        } else if (item.link) {
            window.open(item.link, item.link.startsWith('mailto:') ? '_self' : '_blank');
        } else if (item.action) {
            item.action();
        }
    };

    return (
        <div className={`relative ${className}`}>
            {/* Trigger button */}
            <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsOpen(!isOpen)}
                className="text-muted-foreground hover:text-foreground"
            >
                <HelpCircle className="h-5 w-5" />
            </Button>

            {/* Dropdown */}
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 z-40"
                        onClick={() => setIsOpen(false)}
                    />

                    {/* Menu */}
                    <div className="absolute right-0 top-full mt-2 w-72 bg-card rounded-xl border shadow-lg z-50 animate-in">
                        {/* Header */}
                        <div className="p-4 border-b">
                            <div className="flex items-center justify-between mb-3">
                                <span className="font-medium text-foreground">도움말</span>
                                <button
                                    onClick={() => setIsOpen(false)}
                                    className="p-1 text-muted-foreground hover:text-muted-foreground rounded"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>

                            {/* Search */}
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="도움말 검색..."
                                    className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                />
                            </div>
                        </div>

                        {/* Items */}
                        <div className="py-2">
                            {filteredItems.map((item) => {
                                const Icon = item.icon;
                                return (
                                    <button
                                        key={item.id}
                                        onClick={() => handleItemClick(item)}
                                        className="w-full flex items-start gap-3 px-4 py-2.5 hover:bg-secondary transition-colors"
                                    >
                                        <div className="w-8 h-8 bg-secondary rounded-lg flex items-center justify-center flex-shrink-0">
                                            <Icon className="h-4 w-4 text-muted-foreground" />
                                        </div>
                                        <div className="flex-1 text-left">
                                            <div className="flex items-center gap-1">
                                                <span className="text-sm font-medium text-foreground">
                                                    {item.title}
                                                </span>
                                                {item.link && !item.link.startsWith('mailto:') && (
                                                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                                                )}
                                            </div>
                                            <p className="text-xs text-muted-foreground">{item.description}</p>
                                        </div>
                                    </button>
                                );
                            })}

                            {filteredItems.length === 0 && (
                                <p className="text-sm text-muted-foreground text-center py-4">
                                    검색 결과가 없습니다
                                </p>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="p-3 border-t bg-secondary">
                            <p className="text-xs text-muted-foreground text-center">
                                <kbd className="px-1 py-0.5 bg-muted rounded text-muted-foreground font-mono">?</kbd>
                                키를 눌러 단축키를 확인하세요
                            </p>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

// Contextual tooltip component
interface TooltipProps {
    content: string;
    children: React.ReactNode;
    position?: 'top' | 'bottom' | 'left' | 'right';
    className?: string;
}

export function Tooltip({ content, children, position = 'top', className = '' }: TooltipProps) {
    const [isVisible, setIsVisible] = useState(false);

    const positionClasses = {
        top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
        bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
        left: 'right-full top-1/2 -translate-y-1/2 mr-2',
        right: 'left-full top-1/2 -translate-y-1/2 ml-2',
    };

    return (
        <div
            className={`relative inline-block ${className}`}
            onMouseEnter={() => setIsVisible(true)}
            onMouseLeave={() => setIsVisible(false)}
        >
            {children}
            {isVisible && (
                <div
                    className={`
                        absolute z-50 px-2 py-1 text-xs text-primary-foreground bg-primary rounded whitespace-nowrap
                        ${positionClasses[position]}
                        animate-in fade-in-0 zoom-in-95
                    `}
                >
                    {content}
                </div>
            )}
        </div>
    );
}
