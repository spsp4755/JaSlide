'use client';

import { useEffect, useState } from 'react';
import { useCollaborationStore, Comment } from '@/stores/collaboration-store';
import { commentsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import {
    MessageSquare,
    Send,
    X,
    Check,
    MoreVertical,
    Trash2,
    Edit2,
    Eye,
    EyeOff,
} from 'lucide-react';

interface CommentsPanelProps {
    presentationId: string;
    slideId?: string;
    onClose?: () => void;
}

export function CommentsPanel({ presentationId, slideId, onClose }: CommentsPanelProps) {
    const {
        comments,
        isLoadingComments,
        showResolvedComments,
        setComments,
        addComment,
        updateComment,
        removeComment,
        setLoadingComments,
        toggleResolvedComments,
    } = useCollaborationStore();

    const [newComment, setNewComment] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editContent, setEditContent] = useState('');

    useEffect(() => {
        fetchComments();
    }, [presentationId, slideId]);

    const fetchComments = async () => {
        try {
            setLoadingComments(true);
            const response = slideId
                ? await commentsApi.listBySlide(slideId)
                : await commentsApi.listByPresentation(presentationId);
            setComments(response.data);
        } catch (error) {
            toast({ title: '댓글 불러오기 실패', variant: 'destructive' });
        } finally {
            setLoadingComments(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newComment.trim()) return;

        try {
            setSubmitting(true);
            const response = await commentsApi.create(presentationId, {
                content: newComment,
                slideId,
            });
            addComment(response.data);
            setNewComment('');
            toast({ title: '댓글 작성됨' });
        } catch (error) {
            toast({ title: '댓글 작성 실패', variant: 'destructive' });
        } finally {
            setSubmitting(false);
        }
    };

    const handleEdit = async (commentId: string) => {
        if (!editContent.trim()) return;

        try {
            const response = await commentsApi.update(commentId, { content: editContent });
            updateComment(commentId, response.data);
            setEditingId(null);
            toast({ title: '댓글 수정됨' });
        } catch (error) {
            toast({ title: '댓글 수정 실패', variant: 'destructive' });
        }
    };

    const handleDelete = async (commentId: string) => {
        if (!confirm('댓글을 삭제하시겠습니까?')) return;

        try {
            await commentsApi.delete(commentId);
            removeComment(commentId);
            toast({ title: '댓글 삭제됨' });
        } catch (error) {
            toast({ title: '댓글 삭제 실패', variant: 'destructive' });
        }
    };

    const handleResolve = async (commentId: string, isResolved: boolean) => {
        try {
            if (isResolved) {
                await commentsApi.unresolve(commentId);
            } else {
                await commentsApi.resolve(commentId);
            }
            updateComment(commentId, { isResolved: !isResolved });
        } catch (error) {
            toast({ title: '상태 변경 실패', variant: 'destructive' });
        }
    };

    const filteredComments = showResolvedComments
        ? comments
        : comments.filter((c) => !c.isResolved);

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 1) return '방금 전';
        if (diffMins < 60) return `${diffMins}분 전`;
        if (diffHours < 24) return `${diffHours}시간 전`;
        if (diffDays < 7) return `${diffDays}일 전`;

        return new Intl.DateTimeFormat('ko-KR', {
            month: 'short',
            day: 'numeric',
        }).format(date);
    };

    return (
        <div className="bg-card border-l shadow-lg w-80 flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b">
                <div className="flex items-center gap-2">
                    <MessageSquare className="h-5 w-5 text-purple-600" />
                    <h3 className="font-medium">
                        댓글 {slideId ? '(슬라이드)' : '(전체)'}
                    </h3>
                    <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                        {filteredComments.length}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={toggleResolvedComments}
                        className={`p-1 rounded ${showResolvedComments ? 'bg-purple-100 text-purple-600' : 'hover:bg-secondary'
                            }`}
                        title={showResolvedComments ? '해결됨 숨기기' : '해결됨 보기'}
                    >
                        {showResolvedComments ? (
                            <Eye className="h-4 w-4" />
                        ) : (
                            <EyeOff className="h-4 w-4" />
                        )}
                    </button>
                    {onClose && (
                        <button onClick={onClose} className="p-1 hover:bg-secondary rounded">
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>
            </div>

            {/* Comments List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {isLoadingComments ? (
                    <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600" />
                    </div>
                ) : filteredComments.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                        댓글이 없습니다
                    </div>
                ) : (
                    filteredComments.map((comment) => (
                        <div
                            key={comment.id}
                            className={`p-3 rounded-lg ${comment.isResolved ? 'bg-green-50' : 'bg-secondary'
                                }`}
                        >
                            <div className="flex items-start justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    {comment.user.image ? (
                                        <img
                                            src={comment.user.image}
                                            alt={comment.user.name}
                                            className="w-6 h-6 rounded-full"
                                        />
                                    ) : (
                                        <div className="w-6 h-6 rounded-full bg-purple-200 flex items-center justify-center text-xs font-medium text-purple-700">
                                            {comment.user.name?.[0] || 'U'}
                                        </div>
                                    )}
                                    <div>
                                        <p className="text-sm font-medium text-foreground">
                                            {comment.user.name}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {formatDate(comment.createdAt)}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => handleResolve(comment.id, comment.isResolved)}
                                        className={`p-1 rounded ${comment.isResolved
                                            ? 'text-green-600 hover:bg-green-100'
                                            : 'text-muted-foreground hover:bg-muted'
                                            }`}
                                        title={comment.isResolved ? '다시 열기' : '해결됨 표시'}
                                    >
                                        <Check className="h-4 w-4" />
                                    </button>
                                    <button
                                        onClick={() => {
                                            setEditingId(comment.id);
                                            setEditContent(comment.content);
                                        }}
                                        className="p-1 hover:bg-muted rounded text-muted-foreground"
                                        title="수정"
                                    >
                                        <Edit2 className="h-4 w-4" />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(comment.id)}
                                        className="p-1 hover:bg-muted rounded text-muted-foreground"
                                        title="삭제"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>

                            {editingId === comment.id ? (
                                <div className="mt-2">
                                    <textarea
                                        value={editContent}
                                        onChange={(e) => setEditContent(e.target.value)}
                                        className="w-full px-3 py-2 text-sm border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
                                        rows={2}
                                    />
                                    <div className="flex justify-end gap-2 mt-2">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setEditingId(null)}
                                        >
                                            취소
                                        </Button>
                                        <Button
                                            size="sm"
                                            onClick={() => handleEdit(comment.id)}
                                        >
                                            저장
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-sm text-foreground">{comment.content}</p>
                            )}
                        </div>
                    ))
                )}
            </div>

            {/* New Comment Form */}
            <form onSubmit={handleSubmit} className="p-4 border-t">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        placeholder="댓글을 입력하세요..."
                        className="flex-1 px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                    <Button type="submit" size="sm" disabled={submitting || !newComment.trim()}>
                        <Send className="h-4 w-4" />
                    </Button>
                </div>
            </form>
        </div>
    );
}
