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
import { exportApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import {
    Download,
    FileText,
    File,
    Loader2,
    AlertCircle,
    Check,
    Edit2,
    Presentation,
    Info,
} from 'lucide-react';

interface ExportDialogProps {
    open: boolean;
    onClose: () => void;
    presentationId: string;
    presentationTitle: string;
}

interface FormatInfo {
    id: 'pptx' | 'pdf';
    name: string;
    extension: string;
    icon: React.ElementType;
    iconColor: string;
    features: string[];
    recommended?: string;
    description: string;
}

const FORMATS: FormatInfo[] = [
    {
        id: 'pptx',
        name: 'PowerPoint',
        extension: '.pptx',
        icon: Presentation,
        iconColor: 'text-orange-500',
        description: '편집 가능한 프레젠테이션 파일',
        features: [
            '슬라이드 편집 가능',
            '애니메이션 유지',
            'Microsoft Office 호환',
            'Google Slides 가져오기 가능',
        ],
        recommended: '편집이 필요한 경우',
    },
    {
        id: 'pdf',
        name: 'PDF',
        extension: '.pdf',
        icon: File,
        iconColor: 'text-red-500',
        description: '인쇄/공유용 고정 레이아웃',
        features: [
            '모든 기기에서 동일하게 보임',
            '편집 불가능 (보안)',
            '파일 크기 작음',
            '인쇄에 최적화',
        ],
        recommended: '공유/보관 목적',
    },
];

export function ExportDialog({
    open,
    onClose,
    presentationId,
    presentationTitle,
}: ExportDialogProps) {
    const [selectedFormat, setSelectedFormat] = useState<'pptx' | 'pdf'>('pptx');
    const [exporting, setExporting] = useState<string | null>(null);
    const [showDetails, setShowDetails] = useState(false);

    const handleExport = async (format: 'pptx' | 'pdf') => {
        setExporting(format);
        try {
            let response;
            if (format === 'pptx') {
                response = await exportApi.pptx(presentationId);
            } else {
                response = await exportApi.pdf(presentationId);
            }

            // Create download link
            const blob = new Blob([response.data], {
                type: format === 'pptx'
                    ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
                    : 'application/pdf',
            });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${presentationTitle}.${format}`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);

            toast({ title: '내보내기 완료', description: `${format.toUpperCase()} 파일이 다운로드됩니다.` });
            onClose();
        } catch (error) {
            toast({ title: '내보내기 실패', description: '파일 생성 중 오류가 발생했습니다.', variant: 'destructive' });
        } finally {
            setExporting(null);
        }
    };

    const selectedFormatInfo = FORMATS.find((f) => f.id === selectedFormat)!;

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Download className="h-5 w-5 text-purple-600" />
                        프레젠테이션 내보내기
                    </DialogTitle>
                    <DialogDescription>
                        원하는 형식을 선택하여 프레젠테이션을 다운로드하세요
                    </DialogDescription>
                </DialogHeader>

                {/* Format Selection */}
                <div className="grid grid-cols-2 gap-3 py-4">
                    {FORMATS.map((format) => {
                        const Icon = format.icon;
                        const isSelected = selectedFormat === format.id;

                        return (
                            <button
                                key={format.id}
                                onClick={() => setSelectedFormat(format.id)}
                                disabled={exporting !== null}
                                className={`
                                    relative flex flex-col items-center gap-3 p-5 border-2 rounded-xl transition-all
                                    ${isSelected
                                        ? 'border-purple-500 bg-purple-50'
                                        : 'border-border hover:border-purple-300'
                                    }
                                    disabled:opacity-50
                                `}
                            >
                                {/* Selection indicator */}
                                {isSelected && (
                                    <div className="absolute top-2 right-2 w-5 h-5 bg-purple-500 rounded-full flex items-center justify-center">
                                        <Check className="h-3 w-3 text-white" />
                                    </div>
                                )}

                                <Icon className={`h-10 w-10 ${format.iconColor}`} />
                                <div className="text-center">
                                    <div className="font-medium text-foreground">{format.name}</div>
                                    <div className="text-xs text-muted-foreground">{format.extension}</div>
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Format Details */}
                <div className="bg-secondary rounded-lg p-4 space-y-3">
                    <div className="flex items-start justify-between">
                        <div>
                            <h4 className="font-medium text-foreground flex items-center gap-1.5">
                                {selectedFormatInfo.name}
                                {selectedFormatInfo.recommended && (
                                    <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full">
                                        {selectedFormatInfo.recommended}
                                    </span>
                                )}
                            </h4>
                            <p className="text-sm text-muted-foreground mt-0.5">{selectedFormatInfo.description}</p>
                        </div>
                        <button
                            onClick={() => setShowDetails(!showDetails)}
                            className="text-muted-foreground hover:text-muted-foreground"
                        >
                            <Info className="h-4 w-4" />
                        </button>
                    </div>

                    {/* Expandable features */}
                    {showDetails && (
                        <div className="pt-2 border-t">
                            <p className="text-xs font-medium text-muted-foreground mb-2">특징:</p>
                            <ul className="space-y-1">
                                {selectedFormatInfo.features.map((feature, index) => (
                                    <li key={index} className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Check className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                                        {feature}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>

                {/* Export Tips */}
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <p>
                        {selectedFormat === 'pptx'
                            ? 'PowerPoint에서 열어 추가 편집이 가능합니다. 폰트가 다르게 보일 수 있습니다.'
                            : 'PDF는 모든 기기에서 동일하게 표시되지만 편집할 수 없습니다.'
                        }
                    </p>
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={onClose}>
                        취소
                    </Button>
                    <Button
                        onClick={() => handleExport(selectedFormat)}
                        disabled={exporting !== null}
                        className="bg-purple-600 hover:bg-purple-700"
                    >
                        {exporting ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                내보내는 중...
                            </>
                        ) : (
                            <>
                                <Download className="h-4 w-4 mr-2" />
                                {selectedFormat.toUpperCase()} 다운로드
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
