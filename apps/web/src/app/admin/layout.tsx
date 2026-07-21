'use client';

import { ReactNode, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
    Users,
    Building2,
    Shield,
    FileText,
    Cpu,
    MessageSquare,
    Image,
    Activity,
    FolderOpen,
    Settings,
    ScrollText,
    Wrench,
    Bell,
    LayoutDashboard,
    ChevronLeft,
    ChevronRight,
} from 'lucide-react';

const menuItems = [
    { href: '/admin', label: '대시보드', icon: LayoutDashboard },
    { href: '/admin/users', label: '사용자 관리', icon: Users },
    { href: '/admin/organizations', label: '조직 관리', icon: Building2 },
    { href: '/admin/roles', label: '권한 관리', icon: Shield },
    { href: '/admin/templates', label: '템플릿 관리', icon: FileText },
    { href: '/admin/models', label: '모델 설정', icon: Cpu },
    { href: '/admin/prompts', label: '프롬프트 관리', icon: MessageSquare },
    { href: '/admin/assets', label: '에셋 라이브러리', icon: Image },
    { href: '/admin/jobs', label: '작업 모니터링', icon: Activity },
    { href: '/admin/documents', label: '문서 관리', icon: FolderOpen },
    { href: '/admin/policies', label: '정책 관리', icon: Settings },
    { href: '/admin/logs', label: '로그 & 감사', icon: ScrollText },
    { href: '/admin/operations', label: '운영 도구', icon: Wrench },
    { href: '/admin/alerts', label: '알림 관리', icon: Bell },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const [collapsed, setCollapsed] = useState(false);

    return (
        <div className="flex min-h-screen bg-background">
            {/* Sidebar */}
            <aside
                className={`${collapsed ? 'w-16' : 'w-64'
                    } bg-card border-r border-border transition-all duration-300 flex flex-col`}
            >
                <div className="p-4 border-b border-border flex items-center justify-between">
                    {!collapsed && (
                        <Link href="/admin" className="text-lg font-bold font-display tracking-tight text-foreground">
                            JaSlide <span className="text-muted-foreground font-sans text-sm font-medium">관리자</span>
                        </Link>
                    )}
                    <button
                        onClick={() => setCollapsed(!collapsed)}
                        className="p-1 hover:bg-secondary rounded text-muted-foreground"
                    >
                        {collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
                    </button>
                </div>

                <nav className="flex-1 overflow-y-auto py-4">
                    {menuItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = pathname === item.href;

                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={`flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg transition-colors ${isActive
                                    ? 'bg-foreground text-background'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                                    }`}
                                title={collapsed ? item.label : undefined}
                            >
                                <Icon size={20} />
                                {!collapsed && <span className="text-sm">{item.label}</span>}
                            </Link>
                        );
                    })}
                </nav>

                <div className="p-4 border-t border-border">
                    <Link
                        href="/dashboard"
                        className="flex items-center gap-2 text-muted-foreground hover:text-foreground text-sm"
                    >
                        {!collapsed && '← 메인으로 돌아가기'}
                    </Link>
                </div>
            </aside>

            {/* Main content */}
            <main className="flex-1 overflow-auto">{children}</main>
        </div>
    );
}
