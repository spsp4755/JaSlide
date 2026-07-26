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
import { generationApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { Sparkles, Loader2 } from 'lucide-react';

interface AIEditDialogProps {
    open: boolean;
    onClose: () => void;
    slideId: string;
    currentContent: string;
    onSuccess?: (updatedSlide: any) => void;
}

const QUICK_ACTIONS = [
    { label: '더 간결하게', instruction: '내용을 더 간결하게 줄여주세요.' },
    { label: '더 자세하게', instruction: '내용을 더 자세하게 설명해주세요.' },
    { label: '전문적으로', instruction: '더 전문적인 어조로 수정해주세요.' },
    { label: '친근하게', instruction: '더 친근한 어조로 수정해주세요.' },
    { label: '글머리 기호 추가', instruction: '주요 포인트를 글머리 기호로 정리해주세요.' },
];

export function AIEditDialog({
    open,
    onClose,
    slideId,
    currentContent,
    onSuccess,
}: AIEditDialogProps) {
    const [instruction, setInstruction] = useState('');
    const [processing, setProcessing] = useState(false);

    const handleEdit = async (editInstruction: string) => {
        if (!editInstruction.trim()) return;

        setProcessing(true);
        try {
            const response = await generationApi.edit({
                slideId,
                instruction: editInstruction,
            });

            if (response.data.success) {
                toast({ title: 'AI 편집 완료', description: '슬라이드가 업데이트되었습니다.' });
                onSuccess?.(response.data.slide);
                onClose();
            }
        } catch (error: any) {
            const message = error.response?.data?.message || 'AI 편집에 실패했습니다.';
            toast({ title: '편집 실패', description: message, variant: 'destructive' });
        } finally {
            setProcessing(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-purple-500" />
                        AI로 슬라이드 편집
                    </DialogTitle>
                    <DialogDescription>
                        AI에게 원하는 편집 방향을 알려주세요.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4 space-y-4">
                    {/* Quick Actions */}
                    <div>
                        <label className="block text-sm font-medium text-foreground mb-2">빠른 편집</label>
                        <div className="flex flex-wrap gap-2">
                            {QUICK_ACTIONS.map((action) => (
                                <button
                                    key={action.label}
                                    onClick={() => handleEdit(action.instruction)}
                                    disabled={processing}
                                    className="px-3 py-1.5 text-sm border rounded-full hover:bg-purple-50 hover:border-purple-500 transition-colors disabled:opacity-50"
                                >
                                    {action.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-card px-2 text-muted-foreground">또는</span>
                        </div>
                    </div>

                    {/* Custom Instruction */}
                    <div>
                        <label className="block text-sm font-medium text-foreground mb-2">직접 입력</label>
                        <textarea
                            value={instruction}
                            onChange={(e) => setInstruction(e.target.value)}
                            placeholder="예: 마지막 문장을 더 강하게 마무리해주세요..."
                            rows={3}
                            disabled={processing}
                            className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none disabled:bg-secondary"
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={processing}>
                        취소
                    </Button>
                    <Button
                        onClick={() => handleEdit(instruction)}
                        disabled={processing || !instruction.trim()}
                    >
                        {processing ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                편집 중...
                            </>
                        ) : (
                            <>
                                <Sparkles className="h-4 w-4 mr-2" />
                                적용
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
