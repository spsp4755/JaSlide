'use client';

import { useState, useMemo } from 'react';
import {
    History,
    Clock,
    RotateCcw,
    GitBranch,
    Eye,
    Diff,
    ChevronDown,
    ChevronRight,
    Calendar,
    User,
    Check,
    X,
} from 'lucide-react';

interface VersionHistoryProps {
    versions: Version[];
    currentVersionId: string | null;
    onRestore: (versionId: string) => void;
    onPreview: (versionId: string) => void;
    onCompare: (versionId1: string, versionId2: string) => void;
}

export interface Version {
    id: string;
    name: string;
    timestamp: string;
    author?: string;
    type: 'auto' | 'manual' | 'checkpoint';
    slideCount: number;
    changes: VersionChange[];
    thumbnail?: string;
}

interface VersionChange {
    type: 'add' | 'modify' | 'delete';
    target: string;
    description: string;
}

// 시간 포맷팅
function formatTime(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return '방금 전';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}일 전`;

    return date.toLocaleDateString('ko-KR', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

// 버전 타입별 스타일
function getVersionTypeStyle(type: Version['type']) {
    switch (type) {
        case 'auto':
            return { bg: 'bg-secondary', text: 'text-muted-foreground', label: '자동 저장' };
        case 'manual':
            return { bg: 'bg-blue-100', text: 'text-blue-600', label: '수동 저장' };
        case 'checkpoint':
            return { bg: 'bg-purple-100', text: 'text-purple-600', label: '체크포인트' };
    }
}

export function VersionHistory({
    versions,
    currentVersionId,
    onRestore,
    onPreview,
    onCompare,
}: VersionHistoryProps) {
    const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());
    const [compareMode, setCompareMode] = useState(false);
    const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
    const [filterType, setFilterType] = useState<'all' | 'auto' | 'manual' | 'checkpoint'>('all');

    // 필터링된 버전
    const filteredVersions = useMemo(() => {
        if (filterType === 'all') return versions;
        return versions.filter(v => v.type === filterType);
    }, [versions, filterType]);

    // 날짜별 그룹화
    const groupedVersions = useMemo(() => {
        const groups: { date: string; versions: Version[] }[] = [];
        let currentDate = '';

        filteredVersions.forEach(version => {
            const date = new Date(version.timestamp).toLocaleDateString('ko-KR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
            });

            if (date !== currentDate) {
                currentDate = date;
                groups.push({ date, versions: [] });
            }

            groups[groups.length - 1].versions.push(version);
        });

        return groups;
    }, [filteredVersions]);

    const toggleVersion = (versionId: string) => {
        setExpandedVersions(prev => {
            const next = new Set(prev);
            if (next.has(versionId)) {
                next.delete(versionId);
            } else {
                next.add(versionId);
            }
            return next;
        });
    };

    const handleSelectForCompare = (versionId: string) => {
        setSelectedForCompare(prev => {
            if (prev.includes(versionId)) {
                return prev.filter(id => id !== versionId);
            }
            if (prev.length >= 2) {
                return [prev[1], versionId];
            }
            return [...prev, versionId];
        });
    };

    const handleCompare = () => {
        if (selectedForCompare.length === 2) {
            onCompare(selectedForCompare[0], selectedForCompare[1]);
        }
    };

    return (
        <div className="h-full flex flex-col bg-card">
            {/* 헤더 */}
            <div className="px-3 py-2 border-b">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <History className="h-4 w-4 text-purple-600" />
                        <span className="text-sm font-medium text-foreground">버전 히스토리</span>
                        <span className="text-xs text-muted-foreground">({versions.length})</span>
                    </div>
                    <button
                        onClick={() => {
                            setCompareMode(!compareMode);
                            setSelectedForCompare([]);
                        }}
                        className={`px-2 py-1 text-xs rounded transition-colors ${compareMode
                                ? 'bg-purple-100 text-purple-700'
                                : 'bg-secondary text-muted-foreground hover:bg-muted'
                            }`}
                    >
                        <Diff className="h-3 w-3 inline-block mr-1" />
                        비교
                    </button>
                </div>

                {/* 필터 */}
                <div className="flex gap-1">
                    {(['all', 'checkpoint', 'manual', 'auto'] as const).map((type) => (
                        <button
                            key={type}
                            onClick={() => setFilterType(type)}
                            className={`px-2 py-1 text-[10px] rounded transition-colors ${filterType === type
                                    ? 'bg-purple-100 text-purple-700'
                                    : 'bg-secondary text-muted-foreground hover:bg-muted'
                                }`}
                        >
                            {type === 'all' ? '전체' :
                                type === 'checkpoint' ? '체크포인트' :
                                    type === 'manual' ? '수동' : '자동'}
                        </button>
                    ))}
                </div>
            </div>

            {/* 비교 모드 안내 */}
            {compareMode && (
                <div className="px-3 py-2 bg-purple-50 border-b">
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-purple-700">
                            비교할 버전 2개를 선택하세요 ({selectedForCompare.length}/2)
                        </span>
                        <button
                            onClick={handleCompare}
                            disabled={selectedForCompare.length !== 2}
                            className={`px-2 py-1 text-xs rounded ${selectedForCompare.length === 2
                                    ? 'bg-purple-600 text-white hover:bg-purple-700'
                                    : 'bg-muted text-muted-foreground cursor-not-allowed'
                                }`}
                        >
                            비교하기
                        </button>
                    </div>
                </div>
            )}

            {/* 버전 목록 */}
            <div className="flex-1 overflow-y-auto">
                {filteredVersions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full p-4 text-center">
                        <Clock className="h-10 w-10 text-muted-foreground mb-2" />
                        <span className="text-sm text-muted-foreground">
                            저장된 버전이 없습니다
                        </span>
                    </div>
                ) : (
                    <div className="py-2">
                        {groupedVersions.map((group) => (
                            <div key={group.date} className="mb-2">
                                {/* 날짜 헤더 */}
                                <div className="flex items-center gap-2 px-3 py-1">
                                    <Calendar className="h-3 w-3 text-muted-foreground" />
                                    <span className="text-xs font-medium text-muted-foreground">
                                        {group.date}
                                    </span>
                                </div>

                                {/* 버전 항목 */}
                                {group.versions.map((version) => {
                                    const isExpanded = expandedVersions.has(version.id);
                                    const isCurrent = version.id === currentVersionId;
                                    const isSelectedForCompare = selectedForCompare.includes(version.id);
                                    const typeStyle = getVersionTypeStyle(version.type);

                                    return (
                                        <div
                                            key={version.id}
                                            className={`mx-2 mb-1 rounded-lg border transition-colors ${isCurrent
                                                    ? 'border-purple-300 bg-purple-50'
                                                    : isSelectedForCompare
                                                        ? 'border-blue-300 bg-blue-50'
                                                        : 'border-border hover:border-border'
                                                }`}
                                        >
                                            {/* 버전 헤더 */}
                                            <div
                                                className="flex items-center gap-2 p-2 cursor-pointer"
                                                onClick={() =>
                                                    compareMode
                                                        ? handleSelectForCompare(version.id)
                                                        : toggleVersion(version.id)
                                                }
                                            >
                                                {compareMode ? (
                                                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${isSelectedForCompare
                                                            ? 'bg-blue-500 border-blue-500'
                                                            : 'border-border'
                                                        }`}>
                                                        {isSelectedForCompare && (
                                                            <Check className="h-3 w-3 text-white" />
                                                        )}
                                                    </div>
                                                ) : isExpanded ? (
                                                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                                ) : (
                                                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                                )}

                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs font-medium text-foreground truncate">
                                                            {version.name}
                                                        </span>
                                                        {isCurrent && (
                                                            <span className="text-[10px] px-1.5 py-0.5 bg-purple-200 text-purple-700 rounded">
                                                                현재
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                                        <span>{formatTime(version.timestamp)}</span>
                                                        <span className={`px-1 py-0.5 rounded ${typeStyle.bg} ${typeStyle.text}`}>
                                                            {typeStyle.label}
                                                        </span>
                                                    </div>
                                                </div>

                                                {!compareMode && !isCurrent && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onRestore(version.id);
                                                        }}
                                                        className="p-1.5 text-muted-foreground hover:text-purple-600 hover:bg-purple-50 rounded"
                                                        title="이 버전으로 복원"
                                                    >
                                                        <RotateCcw className="h-3.5 w-3.5" />
                                                    </button>
                                                )}
                                            </div>

                                            {/* 확장된 상세 정보 */}
                                            {isExpanded && !compareMode && (
                                                <div className="px-2 pb-2 pt-1 border-t border-border">
                                                    <div className="text-[10px] text-muted-foreground mb-2">
                                                        슬라이드 {version.slideCount}개
                                                        {version.author && (
                                                            <span className="ml-2">
                                                                <User className="h-3 w-3 inline-block mr-0.5" />
                                                                {version.author}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {version.changes.length > 0 && (
                                                        <div className="space-y-1">
                                                            {version.changes.slice(0, 3).map((change, idx) => (
                                                                <div
                                                                    key={idx}
                                                                    className="flex items-center gap-1 text-[10px]"
                                                                >
                                                                    <span className={`w-1.5 h-1.5 rounded-full ${change.type === 'add'
                                                                            ? 'bg-green-500'
                                                                            : change.type === 'delete'
                                                                                ? 'bg-red-500'
                                                                                : 'bg-blue-500'
                                                                        }`} />
                                                                    <span className="text-muted-foreground">
                                                                        {change.description}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                            {version.changes.length > 3 && (
                                                                <span className="text-[10px] text-muted-foreground">
                                                                    +{version.changes.length - 3}개 더...
                                                                </span>
                                                            )}
                                                        </div>
                                                    )}

                                                    <div className="flex gap-1 mt-2">
                                                        <button
                                                            onClick={() => onPreview(version.id)}
                                                            className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] bg-secondary hover:bg-muted rounded"
                                                        >
                                                            <Eye className="h-3 w-3" />
                                                            미리보기
                                                        </button>
                                                        {!isCurrent && (
                                                            <button
                                                                onClick={() => onRestore(version.id)}
                                                                className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] bg-purple-100 text-purple-700 hover:bg-purple-200 rounded"
                                                            >
                                                                <RotateCcw className="h-3 w-3" />
                                                                복원
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

export default VersionHistory;
