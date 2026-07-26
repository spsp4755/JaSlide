'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { presentationsApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import {
    Copy,
    Check,
    Link,
    Globe,
    Eye,
    Edit2,
    Lock,
    Users,
    Mail,
    MessageSquare,
    AlertCircle,
} from 'lucide-react';

interface ShareDialogProps {
    open: boolean;
    onClose: () => void;
    presentationId: string;
    presentationTitle: string;
}

type Permission = 'view' | 'edit' | 'comment';

interface PermissionOption {
    id: Permission;
    title: string;
    description: string;
    icon: React.ElementType;
}

const PERMISSIONS: PermissionOption[] = [
    {
        id: 'view',
        title: '보기 전용',
        description: '프레젠테이션을 볼 수만 있습니다',
        icon: Eye,
    },
    {
        id: 'comment',
        title: '댓글 허용',
        description: '보기 및 댓글 작성이 가능합니다',
        icon: MessageSquare,
    },
    {
        id: 'edit',
        title: '편집 가능',
        description: '프레젠테이션을 수정할 수 있습니다',
        icon: Edit2,
    },
];

export function ShareDialog({
    open,
    onClose,
    presentationId,
    presentationTitle,
}: ShareDialogProps) {
    const [shareToken, setShareToken] = useState<string | null>(null);
    const [generating, setGenerating] = useState(false);
    const [copied, setCopied] = useState(false);
    const [permission, setPermission] = useState<Permission>('view');
    const [inviteEmail, setInviteEmail] = useState('');
    const [activeTab, setActiveTab] = useState<'link' | 'invite'>('link');

    const generateShareLink = async () => {
        setGenerating(true);
        try {
            const response = await presentationsApi.share(presentationId);
            setShareToken(response.data.shareToken);
        } catch (error) {
            toast({ title: '공유 링크 생성 실패', variant: 'destructive' });
        } finally {
            setGenerating(false);
        }
    };

    const shareUrl = shareToken
        ? `${window.location.origin}/shared/${shareToken}?permission=${permission}`
        : null;

    const copyToClipboard = async () => {
        if (!shareUrl) return;
        try {
            await navigator.clipboard.writeText(shareUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            toast({ title: '복사됨', description: '공유 링크가 클립보드에 복사되었습니다.' });
        } catch {
            toast({ title: '복사 실패', variant: 'destructive' });
        }
    };

    const handleInvite = () => {
        if (!inviteEmail.trim()) return;
        // TODO: Implement invite API
        toast({
            title: '초대 발송됨',
            description: `${inviteEmail}로 초대 이메일이 발송되었습니다.`
        });
        setInviteEmail('');
    };

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-purple-600" />
                        프레젠테이션 공유
                    </DialogTitle>
                    <DialogDescription>
                        링크를 통해 공유하거나 이메일로 초대하세요
                    </DialogDescription>
                </DialogHeader>

                {/* Tabs */}
                <div className="flex border-b">
                    <button
                        onClick={() => setActiveTab('link')}
                        className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'link'
                                ? 'border-purple-500 text-purple-600'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <Link className="h-4 w-4 inline mr-1.5" />
                        링크 공유
                    </button>
                    <button
                        onClick={() => setActiveTab('invite')}
                        className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'invite'
                                ? 'border-purple-500 text-purple-600'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <Mail className="h-4 w-4 inline mr-1.5" />
                        이메일 초대
                    </button>
                </div>

                <div className="py-4">
                    {/* Link Sharing Tab */}
                    {activeTab === 'link' && (
                        <div className="space-y-4">
                            {/* Permission Selection */}
                            <div>
                                <label className="block text-sm font-medium text-foreground mb-2">
                                    권한 설정
                                </label>
                                <div className="flex gap-2">
                                    {PERMISSIONS.map((perm) => {
                                        const Icon = perm.icon;
                                        const isSelected = permission === perm.id;
                                        return (
                                            <button
                                                key={perm.id}
                                                onClick={() => setPermission(perm.id)}
                                                className={`
                                                    flex-1 flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all
                                                    ${isSelected
                                                        ? 'border-purple-500 bg-purple-50'
                                                        : 'border-border hover:border-purple-300'
                                                    }
                                                `}
                                            >
                                                <Icon className={`h-4 w-4 ${isSelected ? 'text-purple-600' : 'text-muted-foreground'}`} />
                                                <span className={`text-xs font-medium ${isSelected ? 'text-purple-700' : 'text-muted-foreground'}`}>
                                                    {perm.title}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                                <p className="text-xs text-muted-foreground mt-2">
                                    {PERMISSIONS.find((p) => p.id === permission)?.description}
                                </p>
                            </div>

                            {/* Link Generation */}
                            {!shareToken ? (
                                <div className="text-center py-6 border rounded-lg bg-secondary">
                                    <Globe className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                                    <p className="text-sm text-muted-foreground mb-3">
                                        공유 링크를 생성하면 선택한 권한으로 접근이 가능합니다
                                    </p>
                                    <Button onClick={generateShareLink} disabled={generating}>
                                        <Link className="h-4 w-4 mr-2" />
                                        {generating ? '생성 중...' : '공유 링크 생성'}
                                    </Button>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            value={shareUrl || ''}
                                            readOnly
                                            className="flex-1 px-3 py-2 border rounded-lg text-sm bg-secondary"
                                        />
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={copyToClipboard}
                                            className="shrink-0"
                                        >
                                            {copied ? (
                                                <Check className="h-4 w-4 text-green-500" />
                                            ) : (
                                                <Copy className="h-4 w-4" />
                                            )}
                                        </Button>
                                    </div>

                                    {/* Security notice */}
                                    <div className="flex items-start gap-2 p-3 bg-yellow-50 rounded-lg">
                                        <AlertCircle className="h-4 w-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                                        <div className="text-xs text-yellow-800">
                                            <p className="font-medium">링크를 가진 모든 사람이 접근할 수 있습니다</p>
                                            <p className="text-yellow-700 mt-0.5">
                                                {permission === 'edit' && '편집 권한이 포함되어 있어 주의가 필요합니다.'}
                                                {permission === 'comment' && '댓글을 남길 수 있습니다.'}
                                                {permission === 'view' && '프레젠테이션만 볼 수 있습니다.'}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Email Invite Tab */}
                    {activeTab === 'invite' && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-foreground mb-2">
                                    이메일로 초대
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="email"
                                        value={inviteEmail}
                                        onChange={(e) => setInviteEmail(e.target.value)}
                                        placeholder="example@email.com"
                                        className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    />
                                    <Button onClick={handleInvite} disabled={!inviteEmail.trim()}>
                                        <Mail className="h-4 w-4 mr-1" />
                                        초대
                                    </Button>
                                </div>
                            </div>

                            {/* Permission for invite */}
                            <div>
                                <label className="block text-sm font-medium text-foreground mb-2">
                                    초대할 권한
                                </label>
                                <select
                                    value={permission}
                                    onChange={(e) => setPermission(e.target.value as Permission)}
                                    className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                                >
                                    {PERMISSIONS.map((perm) => (
                                        <option key={perm.id} value={perm.id}>
                                            {perm.title} - {perm.description}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <p className="text-xs text-muted-foreground">
                                초대받은 사람은 이메일을 통해 프레젠테이션에 접근할 수 있습니다.
                            </p>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        닫기
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
