'use client';

import { useEffect, useState } from 'react';
import { useEditorStore } from '@/stores/editor-store';
import { versionsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import {
    History,
    RotateCcw,
    Trash2,
    Clock,
    ChevronDown,
    ChevronUp,
    X,
} from 'lucide-react';

interface Version {
    id: string;
    versionNumber: number;
    name?: string;
    createdAt: string;
    createdBy: string;
}

interface VersionHistoryProps {
    presentationId: string;
    onClose?: () => void;
}

export function VersionHistory({ presentationId, onClose }: VersionHistoryProps) {
    const [versions, setVersions] = useState<Version[]>([]);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState(true);
    const [restoring, setRestoring] = useState<string | null>(null);
    const { setPresentation } = useEditorStore();

    useEffect(() => {
        fetchVersions();
    }, [presentationId]);

    const fetchVersions = async () => {
        try {
            setLoading(true);
            const response = await versionsApi.list(presentationId);
            setVersions(response.data);
        } catch (error) {
            toast({ title: '버전 목록 불러오기 실패', variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    };

    const handleSaveVersion = async () => {
        try {
            const name = prompt('버전 이름을 입력하세요 (선택사항):');
            await versionsApi.create(presentationId, name || undefined);
            toast({ title: '버전 저장됨', description: '현재 상태가 저장되었습니다.' });
            fetchVersions();
        } catch (error) {
            toast({ title: '버전 저장 실패', variant: 'destructive' });
        }
    };

    const handleRestore = async (versionId: string) => {
        if (!confirm('이 버전으로 복원하시겠습니까? 현재 변경사항이 손실될 수 있습니다.')) {
            return;
        }

        try {
            setRestoring(versionId);
            await versionsApi.restore(versionId);
            toast({ title: '버전 복원됨', description: '프레젠테이션이 복원되었습니다.' });
            // Reload the page to get the restored version
            window.location.reload();
        } catch (error) {
            toast({ title: '복원 실패', variant: 'destructive' });
        } finally {
            setRestoring(null);
        }
    };

    const handleDelete = async (versionId: string) => {
        if (!confirm('이 버전을 삭제하시겠습니까?')) {
            return;
        }

        try {
            await versionsApi.delete(versionId);
            toast({ title: '버전 삭제됨' });
            fetchVersions();
        } catch (error) {
            toast({ title: '삭제 실패', variant: 'destructive' });
        }
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return new Intl.DateTimeFormat('ko-KR', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        }).format(date);
    };

    return (
        <div className="bg-card border-l shadow-lg w-72 flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b">
                <div className="flex items-center gap-2">
                    <History className="h-5 w-5 text-purple-600" />
                    <h3 className="font-medium">버전 기록</h3>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="p-1 hover:bg-secondary rounded"
                    >
                        {expanded ? (
                            <ChevronUp className="h-4 w-4" />
                        ) : (
                            <ChevronDown className="h-4 w-4" />
                        )}
                    </button>
                    {onClose && (
                        <button onClick={onClose} className="p-1 hover:bg-secondary rounded">
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>
            </div>

            {expanded && (
                <>
                    {/* Save Button */}
                    <div className="p-4 border-b">
                        <Button
                            onClick={handleSaveVersion}
                            className="w-full"
                            variant="outline"
                        >
                            <History className="h-4 w-4 mr-2" />
                            현재 버전 저장
                        </Button>
                    </div>

                    {/* Version List */}
                    <div className="flex-1 overflow-y-auto p-2">
                        {loading ? (
                            <div className="flex items-center justify-center py-8">
                                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600" />
                            </div>
                        ) : versions.length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground text-sm">
                                저장된 버전이 없습니다
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {versions.map((version) => (
                                    <div
                                        key={version.id}
                                        className="p-3 bg-secondary rounded-lg hover:bg-secondary group"
                                    >
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <p className="text-sm font-medium text-foreground">
                                                    {version.name || `버전 ${version.versionNumber}`}
                                                </p>
                                                <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                                                    <Clock className="h-3 w-3" />
                                                    {formatDate(version.createdAt)}
                                                </div>
                                            </div>
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => handleRestore(version.id)}
                                                    disabled={restoring === version.id}
                                                    className="p-1 hover:bg-card rounded text-purple-600"
                                                    title="복원"
                                                >
                                                    <RotateCcw className="h-4 w-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(version.id)}
                                                    className="p-1 hover:bg-card rounded text-red-600"
                                                    title="삭제"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
