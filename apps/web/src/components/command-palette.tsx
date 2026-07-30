'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '@/lib/router';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useAuthStore, isAdminRole } from '@/stores/auth-store';
import { presentationsApi } from '@/lib/api';
import { Home, FolderOpen, Settings, Shield, BookOpen, Plus, FileText, Search } from 'lucide-react';

type Item = {
    id: string;
    label: string;
    sublabel?: string;
    href: string;
    icon: typeof Home;
};

const NAV_ITEMS: Omit<Item, 'id'>[] = [
    { label: '홈', href: '/dashboard', icon: Home },
    { label: '새로 만들기', href: '/dashboard?focus=1', icon: Plus },
    { label: 'Skills', href: '/skills', icon: BookOpen },
    { label: '내 발표함', href: '/presentations', icon: FolderOpen },
    { label: '설정', href: '/settings', icon: Settings },
];

// Every page this can jump to is already behind RequireAuth, so the palette
// itself only needs to exist for logged-in users — no point wiring the
// listener (or the presentation search it triggers) on the login screen.
export function CommandPalette() {
    const router = useRouter();
    const { isAuthenticated, user } = useAuthStore();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [presentations, setPresentations] = useState<{ id: string; title: string }[]>([]);
    const [selected, setSelected] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!isAuthenticated) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setOpen((value) => !value);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isAuthenticated]);

    useEffect(() => {
        if (!open) return;
        setQuery('');
        setSelected(0);
        requestAnimationFrame(() => inputRef.current?.focus());
        // A handful of the most recently touched decks is plenty for a jump list;
        // this isn't the full "내 발표함" browser, so it doesn't need pagination.
        presentationsApi
            .list(1, 50)
            .then(({ data }) => setPresentations(data.data.map((p: any) => ({ id: p.id, title: p.title }))))
            .catch(() => setPresentations([]));
    }, [open]);

    const items: Item[] = useMemo(() => {
        const nav = NAV_ITEMS.map((item) => ({ ...item, id: `nav:${item.href}` }));
        if (isAdminRole(user?.role)) {
            nav.push({ id: 'nav:/admin', label: '관리자', href: '/admin', icon: Shield });
        }
        const decks = presentations.map((p) => ({
            id: `deck:${p.id}`,
            label: p.title || '제목 없음',
            sublabel: '발표자료',
            href: `/editor/${p.id}`,
            icon: FileText,
        }));
        const all = [...nav, ...decks];
        const q = query.trim().toLowerCase();
        if (!q) return all;
        return all.filter((item) => item.label.toLowerCase().includes(q));
    }, [query, presentations, user?.role]);

    const go = (href: string) => {
        setOpen(false);
        router.push(href);
    };

    const onInputKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelected((i) => Math.min(i + 1, Math.max(items.length - 1, 0)));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelected((i) => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const item = items[selected];
            if (item) go(item.href);
        }
    };

    if (!isAuthenticated) return null;

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent
                className="top-[20%] max-w-lg translate-y-0 gap-0 overflow-hidden p-0"
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                <div className="flex items-center gap-2 border-b px-4 py-3">
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setSelected(0);
                        }}
                        onKeyDown={onInputKeyDown}
                        placeholder="페이지나 발표자료로 이동..."
                        aria-label="빠른 이동 검색"
                        className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    />
                </div>
                <ul className="max-h-80 overflow-y-auto p-2" role="listbox">
                    {items.length === 0 && (
                        <li className="px-3 py-6 text-center text-sm text-muted-foreground">검색 결과가 없습니다</li>
                    )}
                    {items.map((item, index) => (
                        <li key={item.id} role="option" aria-selected={index === selected}>
                            <button
                                type="button"
                                onClick={() => go(item.href)}
                                onMouseEnter={() => setSelected(index)}
                                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${
                                    index === selected ? 'bg-secondary text-foreground' : 'text-muted-foreground'
                                }`}
                            >
                                <item.icon className="h-4 w-4 flex-shrink-0" />
                                <span className="flex-1 truncate">{item.label}</span>
                                {item.sublabel && (
                                    <span className="flex-shrink-0 text-xs text-muted-foreground/70">{item.sublabel}</span>
                                )}
                            </button>
                        </li>
                    ))}
                </ul>
            </DialogContent>
        </Dialog>
    );
}
