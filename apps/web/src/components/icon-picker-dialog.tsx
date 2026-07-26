'use client';

import { useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
    Smile,
    Heart,
    Star,
    Zap,
    Target,
    Trophy,
    Lightbulb,
    Rocket,
    Check,
    AlertCircle,
    Clock,
    TrendingUp,
    Users,
    Globe,
    Shield,
    Award,
    Briefcase,
    Calendar,
    BarChart,
    Coffee,
    Compass,
    Crown,
    Diamond,
    Flag,
    Gift,
    Headphones,
    Home,
    Key,
    Layers,
    Lock,
    Map,
    MessageCircle,
    Moon,
    Phone,
    PieChart,
    Settings,
    Sun,
    ThumbsUp,
    Wrench,
} from 'lucide-react';

interface IconPickerDialogProps {
    open: boolean;
    onClose: () => void;
    onSelect: (iconName: string) => void;
}

const ICON_CATEGORIES = {
    인기: [
        { name: 'star', Icon: Star },
        { name: 'heart', Icon: Heart },
        { name: 'check', Icon: Check },
        { name: 'zap', Icon: Zap },
        { name: 'target', Icon: Target },
        { name: 'trophy', Icon: Trophy },
        { name: 'lightbulb', Icon: Lightbulb },
        { name: 'rocket', Icon: Rocket },
    ],
    비즈니스: [
        { name: 'briefcase', Icon: Briefcase },
        { name: 'chart-bar', Icon: BarChart },
        { name: 'pie-chart', Icon: PieChart },
        { name: 'trending-up', Icon: TrendingUp },
        { name: 'users', Icon: Users },
        { name: 'calendar', Icon: Calendar },
        { name: 'clock', Icon: Clock },
        { name: 'phone', Icon: Phone },
    ],
    상태: [
        { name: 'thumbs-up', Icon: ThumbsUp },
        { name: 'alert-circle', Icon: AlertCircle },
        { name: 'shield', Icon: Shield },
        { name: 'lock', Icon: Lock },
        { name: 'key', Icon: Key },
        { name: 'award', Icon: Award },
        { name: 'crown', Icon: Crown },
        { name: 'diamond', Icon: Diamond },
    ],
    기타: [
        { name: 'globe', Icon: Globe },
        { name: 'home', Icon: Home },
        { name: 'compass', Icon: Compass },
        { name: 'map', Icon: Map },
        { name: 'sun', Icon: Sun },
        { name: 'moon', Icon: Moon },
        { name: 'coffee', Icon: Coffee },
        { name: 'gift', Icon: Gift },
    ],
};

export function IconPickerDialog({ open, onClose, onSelect }: IconPickerDialogProps) {
    const [selectedCategory, setSelectedCategory] = useState<string>('인기');
    const [searchQuery, setSearchQuery] = useState('');

    const allIcons = Object.values(ICON_CATEGORIES).flat();

    const filteredIcons = searchQuery
        ? allIcons.filter((icon) =>
            icon.name.toLowerCase().includes(searchQuery.toLowerCase())
        )
        : ICON_CATEGORIES[selectedCategory as keyof typeof ICON_CATEGORIES] || [];

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>아이콘 선택</DialogTitle>
                    <DialogDescription>
                        슬라이드에 추가할 아이콘을 선택하세요.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4">
                    {/* Search */}
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="아이콘 검색..."
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 mb-4"
                    />

                    {/* Category Tabs */}
                    {!searchQuery && (
                        <div className="flex gap-2 mb-4 overflow-x-auto">
                            {Object.keys(ICON_CATEGORIES).map((category) => (
                                <button
                                    key={category}
                                    onClick={() => setSelectedCategory(category)}
                                    className={`px-3 py-1 text-sm rounded-full whitespace-nowrap transition-colors ${selectedCategory === category
                                        ? 'bg-purple-100 text-purple-700'
                                        : 'bg-secondary text-muted-foreground hover:bg-muted'
                                        }`}
                                >
                                    {category}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Icons Grid */}
                    <div className="grid grid-cols-6 gap-2 max-h-48 overflow-y-auto">
                        {filteredIcons.map(({ name, Icon }) => (
                            <button
                                key={name}
                                onClick={() => {
                                    onSelect(name);
                                    onClose();
                                }}
                                className="aspect-square flex items-center justify-center rounded-lg border hover:bg-purple-50 hover:border-purple-500 transition-colors"
                                title={name}
                            >
                                <Icon className="h-5 w-5 text-muted-foreground" />
                            </button>
                        ))}
                    </div>

                    {filteredIcons.length === 0 && (
                        <div className="text-center py-8 text-muted-foreground">
                            검색 결과가 없습니다
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
