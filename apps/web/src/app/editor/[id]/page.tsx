'use client';

import { useEffect, useState, useCallback, useRef, type CSSProperties } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { Button } from '@/components/ui/button';
import { useEditorStore } from '@/stores/editor-store';
import { useAuthStore } from '@/stores/auth-store';
import { presentationsApi, slidesApi, exportApi, generationApi, templatesApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { UndoRedoButtons } from '@/components/editor/undo-redo-buttons';
import { VersionHistory } from '@/components/editor/version-history';
import { CommentsPanel } from '@/components/editor/comments-panel';
import { SaveStatusIndicator } from '@/components/editor/save-status-indicator';
import { SlideThumbnail } from '@/components/editor/slide-thumbnail';
import { SlideTemplatesDialog } from '@/components/editor/slide-templates-dialog';
import {
    ArrowLeft,
    Save,
    Download,
    Share2,
    Plus,
    Trash2,
    Copy,
    MoreVertical,
    Sparkles,
    Layout,
    Type,
    List,
    Image as ImageIcon,
    BarChart2,
    Quote,
    History,
    MessageSquare,
    X,
    Link as LinkIcon,
    FileText,
    FileSpreadsheet,
    Loader2,
} from 'lucide-react';

// Slide type icons mapping
const slideTypeIcons: Record<string, any> = {
    TITLE: Type,
    CONTENT: Layout,
    BULLET_LIST: List,
    TWO_COLUMN: Layout,
    IMAGE: ImageIcon,
    CHART: BarChart2,
    QUOTE: Quote,
    SECTION_HEADER: Type,
};

function resolveTemplateValue(value: string | undefined, html: string): string | undefined {
    const variables = Object.fromEntries([...html.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)].map(([, name, value]) => [name, value.trim()]));
    return value?.replace(/var\((--[\w-]+)\)/g, (_, name) => variables[name] || _).trim();
}

function getTemplatePreviewStyle(template: any): CSSProperties {
    const config = template?.config || {};
    const html = config.htmlTemplate || '';
    const background = resolveTemplateValue(config.colors?.background || html.match(/background(?:-color)?\s*:\s*([^;}]+)/)?.[1], html);
    const color = resolveTemplateValue(config.colors?.text || html.match(/(?:^|[;\s])color\s*:\s*([^;}]+)/)?.[1], html);
    const fontFamily = resolveTemplateValue(config.typography?.titleFont || html.match(/font-family\s*:\s*([^;}]+)/)?.[1], html);
    return { backgroundColor: background, color, fontFamily };
}

function resolveAiEditTargets(instruction: string, slides: Array<{ id: string }>): string[] {
    const numbers = new Set<number>();
    for (const match of instruction.matchAll(/(\d+)\s*[~〜-]\s*(\d+)\s*(?:번|페이지|슬라이드)?/g)) {
        const [start, end] = [Number(match[1]), Number(match[2])].sort((a, b) => a - b);
        for (let number = start; number <= end; number += 1) numbers.add(number);
    }
    for (const match of instruction.matchAll(/(\d+)\s*(?:번\s*(?:슬라이드)?|페이지|슬라이드)/g)) numbers.add(Number(match[1]));
    const ids = [...numbers].map((number) => slides[number - 1]?.id).filter((id): id is string => Boolean(id));
    return ids.length ? ids : slides.map((slide) => slide.id);
}

function htmlTextElements(document: Document): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('[data-object="true"]'))
        .filter((element) => element.dataset.objectType !== 'shape')
        .flatMap((element) => {
            const cells = Array.from(element.querySelectorAll<HTMLElement>('th, td')).filter((cell) => !!cell.textContent?.trim());
            return cells.length ? cells : [element];
        })
        .filter((element) => !!element.textContent?.trim() && !element.querySelector('[data-object="true"]'));
}

function getHtmlTextFields(html: string) {
    return htmlTextElements(new DOMParser().parseFromString(html, 'text/html')).map((element) => ({
        text: element.textContent?.trim() || '',
        left: element.style.left || '0',
        top: element.style.top || '0',
        width: element.style.width || '640',
        height: element.style.height || element.style.minHeight || '64',
        positionable: element.dataset.object === 'true',
    }));
}

function getHtmlSelectionAreas(html: string) {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const fields = htmlTextElements(document);
    return Array.from(document.querySelectorAll<HTMLElement>('[data-object="true"]'))
        .filter((element) => element.dataset.objectType !== 'shape' && !!element.textContent?.trim())
        .map((element) => {
            const target = element.querySelector<HTMLElement>('th, td') || element;
            return {
                index: fields.indexOf(target),
                left: element.style.left || '0', top: element.style.top || '0',
                width: element.style.width || '0', height: element.style.height || '0',
            };
        })
        .filter((area) => area.index >= 0);
}

function updateHtmlText(html: string, index: number, updates: { text?: string; left?: string; top?: string; width?: string; height?: string }): string {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const element = htmlTextElements(document)[index];
    if (!element) return html;
    if (updates.text !== undefined) {
        element.replaceChildren(...updates.text.split('\n').flatMap((line, lineIndex) => lineIndex ? [document.createElement('br'), document.createTextNode(line)] : [document.createTextNode(line)]));
    }
    if (updates.left !== undefined) element.style.left = `${updates.left}px`;
    if (updates.top !== undefined) element.style.top = `${updates.top}px`;
    if (updates.width !== undefined) element.style.width = `${updates.width}px`;
    if (updates.height !== undefined) element.style.height = `${updates.height}px`;
    return document.documentElement.outerHTML;
}

function addHtmlText(html: string): string {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const container = document.querySelector('.slide-container') || document.body;
    const element = document.createElement('div');
    element.dataset.object = 'true';
    element.dataset.objectType = 'textbox';
    element.style.cssText = 'position:absolute;left:120px;top:120px;width:640px;min-height:64px;font-size:32px;color:#1A1A1A;z-index:100';
    element.textContent = '새 텍스트';
    container.append(element);
    return document.documentElement.outerHTML;
}

interface DraggableSlideProps {
    slide: any;
    index: number;
    isSelected: boolean;
    isChecked: boolean;
    onSelect: () => void;
    onToggleCheck: () => void;
    onMove: (from: number, to: number) => void;
}

function DraggableSlide({ slide, index, isSelected, isChecked, onSelect, onToggleCheck, onMove }: DraggableSlideProps) {
    const [{ isDragging }, drag] = useDrag({
        type: 'SLIDE',
        item: { index },
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
        }),
    });

    const [, drop] = useDrop({
        accept: 'SLIDE',
        hover: (item: { index: number }) => {
            if (item.index !== index) {
                onMove(item.index, index);
                item.index = index;
            }
        },
    });

    const Icon = slideTypeIcons[slide.type] || Layout;

    // Combine drag and drop refs properly
    const setRefs = (node: HTMLDivElement | null) => {
        drag(drop(node));
    };

    return (
        <div
            ref={setRefs}
            onClick={onSelect}
            className={`slide-panel relative p-2 cursor-move ${isSelected ? 'active' : ''} ${isDragging ? 'opacity-50' : ''
                }`}
        >
            <input
                type="checkbox"
                checked={isChecked}
                onClick={(e) => e.stopPropagation()}
                onChange={onToggleCheck}
                title="AI 편집 대상으로 선택"
                className="absolute top-1 left-1 z-10 h-4 w-4 cursor-pointer accent-purple-600"
            />
            <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-50 rounded flex items-center justify-center mb-2">
                <Icon className="h-6 w-6 text-gray-400" />
            </div>
            <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-600 truncate">
                    {index + 1}. {slide.title || 'Untitled'}
                </span>
            </div>
        </div>
    );
}

export default function EditorPage() {
    const params = useParams();
    const router = useRouter();
    const presentationId = params.id as string;
    const { isAuthenticated, hasHydrated } = useAuthStore();
    const {
        presentation,
        selectedSlideId,
        isDirty,
        canUndo,
        canRedo,
        setPresentation,
        setSelectedSlide,
        updateSlide,
        reorderSlides,
        removeSlide,
        setDirty,
        undo,
        redo,
    } = useEditorStore();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showSlideTypes, setShowSlideTypes] = useState(false);
    const [showVersionHistory, setShowVersionHistory] = useState(false);
    const [showCommentsPanel, setShowCommentsPanel] = useState(false);
    const [showShareDialog, setShowShareDialog] = useState(false);
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [shareUrl, setShareUrl] = useState('');
    const [rightTab, setRightTab] = useState<'edit' | 'chat'>('chat');
    const [aiChatInput, setAiChatInput] = useState('');
    const [aiChatBusy, setAiChatBusy] = useState(false);
    const aiEditAbortRef = useRef<AbortController | null>(null);
    const [aiChatMessages, setAiChatMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
    const [isExporting, setIsExporting] = useState(false);
    const [isDuplicating, setIsDuplicating] = useState(false);
    const [showTemplatesDialog, setShowTemplatesDialog] = useState(false);
    const [multiSelectedSlides, setMultiSelectedSlides] = useState<string[]>([]);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewVersion, setPreviewVersion] = useState(0);
    const previewCacheRef = useRef(new Map<string, string>());
    const previewPendingRef = useRef(new Map<string, Promise<string | null>>());
    const previewSlideIdRef = useRef<string | null>(null);
    const [selectedHtmlTextIndex, setSelectedHtmlTextIndex] = useState<number | null>(null);
    const [leftPanelWidth, setLeftPanelWidth] = useState(208);
    const [rightPanelWidth, setRightPanelWidth] = useState(336);

    const selectedSlide = presentation?.slides.find((s) => s.id === selectedSlideId);

    const loadPreview = useCallback((slideIndex: number) => {
        const key = `${previewVersion}:${slideIndex}`;
        const cached = previewCacheRef.current.get(key);
        if (cached) return Promise.resolve(cached);
        const pending = previewPendingRef.current.get(key);
        if (pending) return pending;
        const request = exportApi.preview(presentationId, slideIndex)
            .then((response) => {
                const url = URL.createObjectURL(response.data);
                previewCacheRef.current.set(key, url);
                return url;
            })
            .catch(() => null)
            .finally(() => previewPendingRef.current.delete(key));
        previewPendingRef.current.set(key, request);
        return request;
    }, [presentationId, previewVersion]);

    const startPanelResize = (side: 'left' | 'right') => (event: any) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = side === 'left' ? leftPanelWidth : rightPanelWidth;
        const move = (moveEvent: PointerEvent) => {
            const delta = moveEvent.clientX - startX;
            const width = side === 'left' ? startWidth + delta : startWidth - delta;
            (side === 'left' ? setLeftPanelWidth : setRightPanelWidth)(Math.max(side === 'left' ? 208 : 288, Math.min(side === 'left' ? 420 : 600, width)));
        };
        const stop = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', stop);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop, { once: true });
    };

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                if (canUndo) undo();
            } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                e.preventDefault();
                if (canRedo) redo();
            } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                handleSave();
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
                e.preventDefault();
                if (selectedSlideId) handleDuplicateSlide();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [canUndo, canRedo, undo, redo]);

    useEffect(() => {
        // Wait for hydration before checking auth
        if (!hasHydrated) return;

        if (!isAuthenticated) {
            router.push('/login');
            return;
        }
        fetchPresentation();
    }, [presentationId, isAuthenticated, hasHydrated]);

    useEffect(() => {
        if (!presentation || !selectedSlideId) return;
        const slideIndex = presentation.slides.findIndex((slide) => slide.id === selectedSlideId);
        let active = true;
        const key = `${previewVersion}:${slideIndex}`;
        const cached = previewCacheRef.current.get(key);
        if (cached) {
            previewSlideIdRef.current = selectedSlideId;
            setPreviewUrl(cached);
        } else if (previewSlideIdRef.current !== selectedSlideId) {
            previewSlideIdRef.current = null;
            setPreviewUrl(null);
        }
        void loadPreview(slideIndex).then((url) => {
            if (active && url) {
                previewSlideIdRef.current = selectedSlideId;
                setPreviewUrl(url);
            }
        });
        for (let index = 0; index < presentation.slides.length; index += 1) {
            if (index !== slideIndex) void loadPreview(index);
        }
        return () => { active = false; };
    }, [presentation, selectedSlideId, previewVersion, loadPreview]);

    useEffect(() => () => {
        for (const url of previewCacheRef.current.values()) URL.revokeObjectURL(url);
        previewCacheRef.current.clear();
    }, []);

    const fetchPresentation = async () => {
        try {
            const response = await presentationsApi.get(presentationId);
            // Older presentations can have a template relation omitted from their
            // response. Fetching it by ID keeps ZIP/HTML layouts available in the
            // editor instead of silently falling back to the generic canvas.
            const template = response.data.template || (response.data.templateId
                ? (await templatesApi.get(response.data.templateId)).data
                : null);
            setPresentation({
                id: response.data.id,
                title: response.data.title,
                slides: response.data.slides,
                templateId: response.data.templateId,
                template,
            });
        } catch (error) {
            toast({ title: '오류', description: '프레젠테이션을 불러올 수 없습니다.', variant: 'destructive' });
            router.push('/dashboard');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!presentation || !isDirty) return;
        setSaving(true);
        try {
            // Save individual slide changes
            const savePromises = presentation.slides.map((slide) =>
                slidesApi.update(presentationId, slide.id, {
                    type: slide.type,
                    title: slide.title,
                    content: slide.content,
                    layout: slide.layout,
                    notes: slide.notes,
                    order: slide.order,
                })
            );
            await Promise.all(savePromises);
            setDirty(false);
            toast({ title: '저장 완료', description: '변경사항이 저장되었습니다.' });
        } catch (error) {
            toast({ title: '저장 실패', description: '저장 중 오류가 발생했습니다.', variant: 'destructive' });
        } finally {
            setSaving(false);
        }
    };

    // Save individual slide changes
    const handleSaveSlide = async (slide: any) => {
        if (!slide || !presentationId) return;
        try {
            await slidesApi.update(presentationId, slide.id, {
                type: slide.type,
                title: slide.title,
                content: slide.content,
                layout: slide.layout,
                notes: slide.notes,
                order: slide.order,
            });
            setDirty(false);
            setPreviewVersion((version) => version + 1);
        } catch (error) {
            console.error('Failed to save slide:', error);
        }
    };

    // Debounced save for select/dropdown changes
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const handleSaveSlideDelayed = (slideId: string, updates: Partial<any>) => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }
        saveTimeoutRef.current = setTimeout(async () => {
            const slide = presentation?.slides.find((s) => s.id === slideId);
            if (slide) {
                try {
                    // Only send allowed fields to the API
                    await slidesApi.update(presentationId, slideId, {
                        type: updates.type ?? slide.type,
                        title: updates.title ?? slide.title,
                        content: updates.content ?? slide.content,
                        layout: updates.layout ?? slide.layout,
                        notes: updates.notes ?? slide.notes,
                        order: updates.order ?? slide.order,
                    });
                    setDirty(false);
                    setPreviewVersion((version) => version + 1);
                } catch (error) {
                    console.error('Failed to save slide:', error);
                }
            }
        }, 500);
    };

    const handleDeleteSlide = async () => {
        if (!selectedSlideId || !presentation) return;
        if (presentation.slides.length <= 1) {
            toast({ title: '삭제 불가', description: '최소 1개의 슬라이드가 필요합니다.', variant: 'destructive' });
            return;
        }

        try {
            await slidesApi.delete(presentationId, selectedSlideId);
            removeSlide(selectedSlideId);
            toast({ title: '삭제 완료', description: '슬라이드가 삭제되었습니다.' });
        } catch (error) {
            toast({ title: '삭제 실패', variant: 'destructive' });
        }
    };

    const handleAddSlide = async (type: string) => {
        try {
            const response = await slidesApi.create(presentationId, {
                type,
                order: presentation?.slides.length || 0,
                content: { heading: '새 슬라이드' },
                layout: 'center',
            });
            // Refresh presentation to get new slide
            fetchPresentation();
            setShowSlideTypes(false);
            toast({ title: '슬라이드 추가됨' });
        } catch (error) {
            toast({ title: '슬라이드 추가 실패', variant: 'destructive' });
        }
    };

    // Share handler
    const handleShare = async () => {
        try {
            const response = await presentationsApi.share(presentationId);
            const shareToken = response.data.shareToken;
            const url = `${window.location.origin}/presentations/shared/${shareToken}`;
            setShareUrl(url);
            setShowShareDialog(true);
        } catch (error) {
            toast({ title: '공유 링크 생성 실패', variant: 'destructive' });
        }
    };

    // Copy share URL to clipboard
    const handleCopyShareUrl = async () => {
        try {
            await navigator.clipboard.writeText(shareUrl);
            toast({ title: '링크 복사됨', description: '클립보드에 복사되었습니다.' });
        } catch (error) {
            toast({ title: '복사 실패', variant: 'destructive' });
        }
    };

    // Export handler
    const handleExport = async (format: 'pptx' | 'pdf') => {
        try {
            setIsExporting(true);
            setShowExportMenu(false);

            const response = format === 'pptx'
                ? await exportApi.pptx(presentationId)
                : await exportApi.pdf(presentationId);

            // Create download link
            const blob = new Blob([response.data], {
                type: format === 'pptx'
                    ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
                    : 'application/pdf'
            });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${presentation?.title || 'presentation'}.${format}`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            toast({ title: '내보내기 완료', description: `${format.toUpperCase()} 파일이 다운로드되었습니다.` });
        } catch (error) {
            toast({ title: '내보내기 실패', variant: 'destructive' });
        } finally {
            setIsExporting(false);
        }
    };

    // AI Edit handler — edits the checked slides, or the current one if none checked.
    const handleAiChat = async () => {
        const instruction = aiChatInput.trim();
        const targets = presentation ? resolveAiEditTargets(instruction, presentation.slides) : [];
        if (!targets.length || !instruction) {
            toast({ title: '편집할 슬라이드와 지시를 입력해주세요.', variant: 'destructive' });
            return;
        }

        // Non-blocking: close the dialog right away so the user can keep working or
        // navigate away while the edit runs. A toast reports the result when it lands.
        setAiChatMessages((messages) => [...messages, { role: 'user', text: instruction }]);
        setAiChatInput('');
        setAiChatBusy(true);
        const abortController = new AbortController();
        aiEditAbortRef.current = abortController;
        toast({ title: 'AI 편집 중...', description: `${targets.length}개 슬라이드를 편집하고 있습니다.` });

        try {
            const response = await generationApi.edit({ slideIds: targets, instruction }, abortController.signal);
            const editedSlides = response.data.slides ?? [];
            if (presentation) setPresentation({
                ...presentation,
                slides: presentation.slides.map((slide) => editedSlides.find((edited: any) => edited.id === slide.id) ?? slide),
            });
            setPreviewVersion((version) => version + 1);
            setAiChatMessages((messages) => [...messages, { role: 'assistant', text: `${targets.length}개 슬라이드를 수정했습니다.` }]);
            toast({ title: 'AI 편집 완료', description: `${targets.length}개 슬라이드가 업데이트되었습니다.` });
            void fetchPresentation();
        } catch {
            const cancelled = abortController.signal.aborted;
            setAiChatMessages((messages) => [...messages, { role: 'assistant', text: cancelled ? '수정 요청을 중지했습니다.' : '수정에 실패했습니다. 잠시 후 다시 요청해 주세요.' }]);
            toast({ title: cancelled ? 'AI 편집 중지됨' : 'AI 편집 실패', variant: cancelled ? undefined : 'destructive' });
        } finally {
            if (aiEditAbortRef.current === abortController) aiEditAbortRef.current = null;
            setAiChatBusy(false);
        }
    };

    const handleCancelAiChat = () => aiEditAbortRef.current?.abort();

    // Duplicate slide handler
    const handleDuplicateSlide = async () => {
        if (!selectedSlideId || !presentationId) return;

        try {
            setIsDuplicating(true);
            // Use the correct API path with presentationId
            await slidesApi.duplicateWithPresentation(presentationId, selectedSlideId);
            toast({ title: '슬라이드 복제됨' });
            fetchPresentation();
        } catch (error) {
            toast({ title: '복제 실패', variant: 'destructive' });
        } finally {
            setIsDuplicating(false);
        }
    };

    if (!hasHydrated || loading) {
        return (
            <div className="min-h-screen bg-gray-100 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
            </div>
        );
    }

    if (!presentation) {
        return null;
    }

    return (
        <DndProvider backend={HTML5Backend}>
            <div className="h-screen flex flex-col bg-gray-100">
                {/* Header */}
                <header className="bg-white border-b px-4 py-2 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/dashboard" className="p-2 hover:bg-gray-100 rounded-lg">
                            <ArrowLeft className="h-5 w-5" />
                        </Link>
                        <div>
                            <h1 className="font-medium">{presentation.title}</h1>
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-500">
                                    {presentation.slides.length} 슬라이드
                                </span>
                                <SaveStatusIndicator presentationId={presentationId} isDirty={isDirty} />
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <UndoRedoButtons />
                        <div className="w-px h-6 bg-gray-200" />
                        <Button variant={rightTab === 'edit' ? 'secondary' : 'outline'} size="sm" onClick={() => setRightTab('edit')}>
                            <Type className="h-4 w-4 mr-1" />
                            수동 편집
                        </Button>
                        <Button
                            variant={showVersionHistory ? 'secondary' : 'outline'}
                            size="sm"
                            onClick={() => {
                                setShowVersionHistory(!showVersionHistory);
                                setShowCommentsPanel(false);
                            }}
                        >
                            <History className="h-4 w-4 mr-1" />
                            버전
                        </Button>
                        <Button
                            variant={showCommentsPanel ? 'secondary' : 'outline'}
                            size="sm"
                            onClick={() => {
                                setShowCommentsPanel(!showCommentsPanel);
                                setShowVersionHistory(false);
                            }}
                        >
                            <MessageSquare className="h-4 w-4 mr-1" />
                            댓글
                        </Button>
                        <div className="w-px h-6 bg-gray-200" />
                        <Button variant="outline" size="sm" onClick={handleSave} disabled={!isDirty || saving}>
                            <Save className="h-4 w-4 mr-1" />
                            {saving ? '저장 중...' : '저장'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={handleShare}>
                            <Share2 className="h-4 w-4 mr-1" />
                            공유
                        </Button>
                        <div className="relative">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setShowExportMenu(!showExportMenu)}
                                disabled={isExporting}
                            >
                                {isExporting ? (
                                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                ) : (
                                    <Download className="h-4 w-4 mr-1" />
                                )}
                                내보내기
                            </Button>
                            {showExportMenu && (
                                <div className="absolute right-0 top-10 w-48 bg-white rounded-lg shadow-lg border p-2 z-50">
                                    <button
                                        onClick={() => handleExport('pptx')}
                                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-100 rounded text-sm"
                                    >
                                        <FileSpreadsheet className="h-4 w-4 text-orange-500" />
                                        PowerPoint (.pptx)
                                    </button>
                                    <button
                                        onClick={() => handleExport('pdf')}
                                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-100 rounded text-sm"
                                    >
                                        <FileText className="h-4 w-4 text-red-500" />
                                        PDF (.pdf)
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </header>

                <div className="flex-1 flex overflow-hidden">
                    {/* Slide List Panel */}
                    <aside className="shrink-0 bg-white border-r p-3 overflow-auto" style={{ width: leftPanelWidth }}>
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-sm font-medium text-gray-700">슬라이드</span>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => setShowTemplatesDialog(true)}
                                title="슬라이드 추가 (템플릿 선택)"
                            >
                                <Plus className="h-4 w-4" />
                            </Button>
                        </div>

                        <div className="space-y-2">
                            {presentation.slides.map((slide, index) => (
                                <DraggableSlide
                                    key={slide.id}
                                    slide={slide}
                                    index={index}
                                    isSelected={slide.id === selectedSlideId}
                                    isChecked={multiSelectedSlides.includes(slide.id)}
                                    onSelect={() => {
                                        setSelectedSlide(slide.id);
                                        setSelectedHtmlTextIndex(null);
                                    }}
                                    onToggleCheck={() => setMultiSelectedSlides((prev) =>
                                        prev.includes(slide.id) ? prev.filter((id) => id !== slide.id) : [...prev, slide.id]
                                    )}
                                    onMove={reorderSlides}
                                />
                            ))}
                        </div>
                    </aside>
                    <div role="separator" aria-label="슬라이드 목록 너비 조절" aria-orientation="vertical" onPointerDown={startPanelResize('left')} className="w-1.5 shrink-0 cursor-col-resize bg-gray-200 hover:bg-purple-400 active:bg-purple-500" />

                    {/* Main Editor Area */}
                    <main className="flex-1 p-6 overflow-auto">
                        <div className="max-w-4xl mx-auto">
                            {/* Slide Preview */}
                            <div className="editor-canvas bg-white shadow-lg rounded-lg overflow-hidden">
                                {selectedSlide ? (
                                    <EditableSlidePreview
                                        slide={selectedSlide}
                                        template={presentation.template}
                                        previewUrl={previewUrl}
                                        selectedHtmlTextIndex={selectedHtmlTextIndex}
                                        onSelectHtmlText={setSelectedHtmlTextIndex}
                                        onUpdate={(updates) => {
                                            updateSlide(selectedSlide.id, updates);
                                            if (updates.content?.html) handleSaveSlideDelayed(selectedSlide.id, updates);
                                        }}
                                        onSave={() => handleSaveSlide(selectedSlide)}
                                    />
                                ) : (
                                    <div className="h-full flex items-center justify-center text-gray-400">
                                        슬라이드를 선택하세요
                                    </div>
                                )}
                            </div>

                            {/* Slide Actions */}
                            {selectedSlide && (
                                <div className="mt-4 flex items-center justify-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handleDuplicateSlide}
                                        disabled={isDuplicating}
                                    >
                                        {isDuplicating ? (
                                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                        ) : (
                                            <Copy className="h-4 w-4 mr-1" />
                                        )}
                                        복제
                                    </Button>
                                    <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700" onClick={handleDeleteSlide}>
                                        <Trash2 className="h-4 w-4 mr-1" />
                                        삭제
                                    </Button>
                                </div>
                            )}
                        </div>
                    </main>

                    <div role="separator" aria-label="AI 패널 너비 조절" aria-orientation="vertical" onPointerDown={startPanelResize('right')} className="w-1.5 shrink-0 cursor-col-resize bg-gray-200 hover:bg-purple-400 active:bg-purple-500" />

                    {/* AI Chat / Manual Edit Panel */}
                    <aside className="flex shrink-0 flex-col bg-white border-l p-4 overflow-hidden" style={{ width: rightPanelWidth }}>
                        <div className="mb-4 flex items-center justify-between">
                            <h3 className="font-medium text-gray-900">{rightTab === 'chat' ? 'AI 채팅' : '수동 편집'}</h3>
                            {rightTab === 'edit' && <Button variant="ghost" size="sm" onClick={() => setRightTab('chat')}>AI 채팅으로</Button>}
                        </div>
                        {rightTab === 'chat' && (
                            <div className="flex min-h-0 flex-1 flex-col gap-3">
                                <p className="rounded-lg bg-purple-50 px-3 py-2 text-xs text-purple-900">전체 슬라이드 대상 · “3번 슬라이드”, “2~4번”처럼 번호를 적으면 해당 슬라이드만 수정합니다.</p>
                                <div className="flex-1 space-y-3 overflow-y-auto rounded-2xl bg-gray-50 p-3">
                                    {aiChatMessages.length === 0 && <div className="rounded-2xl bg-white p-3 text-sm text-gray-600 shadow-sm">무엇을 바꿀지 자연어로 요청해 주세요.<br /><span className="text-xs text-gray-400">예: 3번 슬라이드의 표를 더 간결하게 정리해줘</span></div>}
                                    {aiChatMessages.map((message, index) => <div key={index} className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm shadow-sm ${message.role === 'user' ? 'ml-auto bg-purple-600 text-white' : 'bg-white text-gray-700'}`}>{message.text}</div>)}
                                </div>
                                <div className="rounded-2xl border bg-white p-2 shadow-sm focus-within:ring-2 focus-within:ring-purple-500">
                                    <textarea value={aiChatInput} onChange={(event) => setAiChatInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleAiChat(); } }} rows={3} placeholder="수정 요청을 입력하세요" className="w-full resize-none border-0 px-2 py-1 text-sm outline-none" />
                                    <div className="flex items-center justify-between px-1">
                                        <span className="text-xs text-gray-400">Enter 전송 · Shift+Enter 줄바꿈</span>
                                        {aiChatBusy ? <Button size="sm" variant="outline" onClick={handleCancelAiChat}>중지</Button> : <Button size="sm" onClick={handleAiChat} disabled={!aiChatInput.trim()}>보내기</Button>}
                                    </div>
                                </div>
                            </div>
                        )}
                        {rightTab === 'edit' && (<div className="overflow-auto">
                        {selectedSlide ? (selectedSlide.content?.html ? (
                            <div className="space-y-3">
                                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                                    텍스트를 직접 수정해도 템플릿의 레이아웃과 디자인은 유지됩니다.
                            </div>
                                <div className="space-y-3">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="w-full"
                                    onClick={() => {
                                        const content = { ...selectedSlide.content, html: addHtmlText(selectedSlide.content.html) };
                                        updateSlide(selectedSlide.id, { content });
                                        handleSaveSlideDelayed(selectedSlide.id, { content });
                                        setSelectedHtmlTextIndex(getHtmlTextFields(selectedSlide.content.html).length);
                                    }}
                                >
                                    <Plus className="mr-1 h-4 w-4" /> 텍스트 추가
                                </Button>
                                <select
                                    value={selectedHtmlTextIndex ?? ''}
                                    onChange={(event) => setSelectedHtmlTextIndex(event.target.value === '' ? null : Number(event.target.value))}
                                    className="w-full rounded-lg border px-3 py-2 text-sm"
                                >
                                    <option value="">편집할 텍스트 선택</option>
                                    {getHtmlTextFields(selectedSlide.content.html).map((item, index) => (
                                        <option key={index} value={index}>{item.positionable ? '텍스트' : '표 셀'} {index + 1}: {item.text.slice(0, 28)}</option>
                                    ))}
                                </select>
                                {selectedHtmlTextIndex === null ? (
                                    <p className="text-sm text-gray-500">미리보기에서 텍스트를 선택하면 내용과 위치를 수정할 수 있습니다.</p>
                                ) : getHtmlTextFields(selectedSlide.content.html).map((item, index) => index === selectedHtmlTextIndex ? (
                                    <div key={index}>
                                        <label className="mb-1 block text-xs font-medium text-gray-600">텍스트 {index + 1}</label>
                                        <textarea
                                            value={item.text}
                                            rows={Math.min(5, Math.max(2, item.text.split('\n').length))}
                                            onChange={(event) => {
                                                const content = { ...selectedSlide.content, html: updateHtmlText(selectedSlide.content.html, index, { text: event.target.value }) };
                                                updateSlide(selectedSlide.id, { content });
                                                handleSaveSlideDelayed(selectedSlide.id, { content });
                                            }}
                                            className="w-full resize-y rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                                        />
                                        {item.positionable && <div className="mt-2 grid grid-cols-2 gap-2">
                                            {(['left', 'top', 'width', 'height'] as const).map((property) => (
                                                <label key={property} className="text-xs text-gray-600">
                                                    {{ left: 'X', top: 'Y', width: 'W', height: 'H' }[property]}
                                                    <input
                                                        type="number"
                                                        value={parseFloat(item[property]) || 0}
                                                        onChange={(event) => {
                                                            const content = { ...selectedSlide.content, html: updateHtmlText(selectedSlide.content.html, index, { [property]: event.target.value }) };
                                                            updateSlide(selectedSlide.id, { content });
                                                            handleSaveSlideDelayed(selectedSlide.id, { content });
                                                        }}
                                                        className="mt-1 w-full rounded border px-2 py-1 text-sm"
                                                    />
                                                </label>
                                            ))}
                                        </div>}
                                    </div>
                                ) : null)}
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">타입</label>
                                    <div className="text-sm text-gray-600 bg-gray-50 px-3 py-2 rounded">
                                        {selectedSlide.type}
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">제목</label>
                                    <input
                                        type="text"
                                        value={selectedSlide.title || ''}
                                        onChange={(e) => {
                                            updateSlide(selectedSlide.id, { title: e.target.value });
                                        }}
                                        onBlur={() => handleSaveSlide(selectedSlide)}
                                        className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">레이아웃</label>
                                    <select
                                        value={selectedSlide.layout || 'center'}
                                        onChange={(e) => {
                                            updateSlide(selectedSlide.id, { layout: e.target.value });
                                            // Auto-save on layout change
                                            handleSaveSlideDelayed(selectedSlide.id, { layout: e.target.value });
                                        }}
                                        className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    >
                                        <option value="center">중앙</option>
                                        <option value="left">왼쪽</option>
                                        <option value="right">오른쪽</option>
                                        <option value="two-column-equal">2단 (균등)</option>
                                        <option value="image-left">이미지 왼쪽</option>
                                        <option value="image-right">이미지 오른쪽</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">노트</label>
                                    <textarea
                                        value={selectedSlide.notes || ''}
                                        onChange={(e) => {
                                            updateSlide(selectedSlide.id, { notes: e.target.value });
                                        }}
                                        onBlur={() => handleSaveSlide(selectedSlide)}
                                        rows={4}
                                        placeholder="발표자 노트..."
                                        className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                                    />
                                </div>
                                {selectedSlide.type === 'CHART' && (
                                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                                        <label className="block text-sm font-medium text-gray-800">차트 데이터</label>
                                        {selectedSlide.content?.chart?.isExample && (
                                            <p className="text-xs text-amber-800">예시 데이터입니다. 실제 수치로 수정하세요.</p>
                                        )}
                                        <input
                                            type="text"
                                            value={(selectedSlide.content?.chart?.labels || []).join(', ')}
                                            onChange={(e) => {
                                                const chart = selectedSlide.content?.chart || {};
                                                const content = {
                                                    ...selectedSlide.content,
                                                    chart: { ...chart, labels: e.target.value.split(',').map((value: string) => value.trim()).filter(Boolean) },
                                                };
                                                updateSlide(selectedSlide.id, { content });
                                                handleSaveSlideDelayed(selectedSlide.id, { content });
                                            }}
                                            placeholder="항목 (쉼표로 구분)"
                                            className="w-full px-2 py-1.5 border rounded text-sm"
                                        />
                                        <input
                                            type="text"
                                            value={(selectedSlide.content?.chart?.values || []).join(', ')}
                                            onChange={(e) => {
                                                const chart = selectedSlide.content?.chart || {};
                                                const content = {
                                                    ...selectedSlide.content,
                                                    chart: { ...chart, values: e.target.value.split(',').map((value: string) => Number(value.trim())).filter(Number.isFinite), isExample: false },
                                                };
                                                updateSlide(selectedSlide.id, { content });
                                                handleSaveSlideDelayed(selectedSlide.id, { content });
                                            }}
                                            placeholder="수치 (쉼표로 구분)"
                                            inputMode="decimal"
                                            className="w-full px-2 py-1.5 border rounded text-sm"
                                        />
                                    </div>
                                )}
                            </div>
                        )
                        ) : (
                            <p className="text-sm text-gray-500">슬라이드를 선택하면 속성을 편집할 수 있습니다.</p>
                        )}
                        </div>)}
                    </aside>

                    {/* Version History Panel */}
                    {showVersionHistory && (
                        <VersionHistory
                            presentationId={presentationId}
                            onClose={() => setShowVersionHistory(false)}
                        />
                    )}

                    {/* Comments Panel */}
                    {showCommentsPanel && (
                        <CommentsPanel
                            presentationId={presentationId}
                            slideId={selectedSlideId || undefined}
                            onClose={() => setShowCommentsPanel(false)}
                        />
                    )}
                </div>

                {/* Share Dialog */}
                {showShareDialog && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                        <div className="bg-white rounded-lg p-6 w-96 shadow-xl">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-medium">공유 링크</h3>
                                <button
                                    onClick={() => setShowShareDialog(false)}
                                    className="p-1 hover:bg-gray-100 rounded"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                            <p className="text-sm text-gray-600 mb-4">
                                이 링크를 공유하면 누구나 프레젠테이션을 볼 수 있습니다.
                            </p>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={shareUrl}
                                    readOnly
                                    className="flex-1 px-3 py-2 border rounded-lg text-sm bg-gray-50"
                                />
                                <Button onClick={handleCopyShareUrl}>
                                    <LinkIcon className="h-4 w-4 mr-1" />
                                    복사
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Slide Templates Dialog */}
                <SlideTemplatesDialog
                    isOpen={showTemplatesDialog}
                    onClose={() => setShowTemplatesDialog(false)}
                    onSelectTemplate={handleAddSlide}
                />
            </div>
        </DndProvider>
    );
}

// Editable Slide Preview Component
interface EditableSlidePreviewProps {
    slide: any;
    template?: any;
    previewUrl?: string | null;
    selectedHtmlTextIndex: number | null;
    onSelectHtmlText: (index: number | null) => void;
    onUpdate: (updates: Partial<any>) => void;
    onSave: () => void;
}

function EditableSlidePreview({ slide, template, previewUrl, selectedHtmlTextIndex, onSelectHtmlText, onUpdate, onSave }: EditableSlidePreviewProps) {
    const content = slide.content || {};
    const heading = content.heading || slide.title || '';
    const subheading = content.subheading || '';
    const body = content.body || '';
    const bullets = content.bullets || [];
    const previewStyle = getTemplatePreviewStyle(template);
    const htmlTextFields = typeof content.html === 'string' ? getHtmlTextFields(content.html) : [];
    const htmlSelectionAreas = typeof content.html === 'string' ? getHtmlSelectionAreas(content.html) : [];

    const startHtmlTransform = (event: any, index: number, resizing: boolean) => {
        event.preventDefault();
        event.stopPropagation();
        const canvas = (event.currentTarget as HTMLElement).closest('[data-html-canvas]') as HTMLElement | null;
        const field = htmlTextFields[index];
        if (!canvas || !field) return;
        const bounds = canvas.getBoundingClientRect();
        const startX = event.clientX;
        const startY = event.clientY;
        const initial = {
            left: parseFloat(field.left) || 0,
            top: parseFloat(field.top) || 0,
            width: parseFloat(field.width) || 0,
            height: parseFloat(field.height) || 0,
        };
        const move = (moveEvent: PointerEvent) => {
            const dx = (moveEvent.clientX - startX) * 1920 / bounds.width;
            const dy = (moveEvent.clientY - startY) * 1080 / bounds.height;
            const updates = resizing
                ? { width: String(Math.max(40, Math.round(initial.width + dx))), height: String(Math.max(24, Math.round(initial.height + dy))) }
                : { left: String(Math.round(initial.left + dx)), top: String(Math.round(initial.top + dy)) };
            onUpdate({ content: { ...content, html: updateHtmlText(content.html, index, updates) } });
        };
        const stop = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', stop);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop, { once: true });
    };

    if (previewUrl && content.html) {
        return (
            <div className="relative h-full w-full" data-html-canvas>
                <img src={previewUrl} alt={slide.title || '슬라이드 미리보기'} className="h-full w-full object-contain" />
                {htmlSelectionAreas.map((area) => {
                    const field = htmlTextFields[area.index];
                    return field && (
                    <div
                        key={area.index}
                        className={`absolute ${field.positionable ? 'cursor-move' : 'cursor-pointer'} ${selectedHtmlTextIndex === area.index ? 'border border-purple-500/70 bg-purple-500/5 hover:bg-purple-500/15' : ''}`}
                        style={{ left: `${(parseFloat(area.left) || 0) / 19.2}%`, top: `${(parseFloat(area.top) || 0) / 10.8}%`, width: `${Math.max(1, parseFloat(area.width) || 0) / 19.2}%`, height: `${Math.max(1, parseFloat(area.height) || 0) / 10.8}%` }}
                        onPointerDown={(event) => {
                            onSelectHtmlText(area.index);
                            if (field.positionable) startHtmlTransform(event, area.index, false);
                        }}
                    >
                        {selectedHtmlTextIndex === area.index && field.positionable && <button
                            type="button"
                            aria-label="텍스트 크기 조절"
                            className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-se-resize rounded-sm border border-purple-700 bg-white"
                            onPointerDown={(event) => {
                                onSelectHtmlText(area.index);
                                startHtmlTransform(event, area.index, true);
                            }}
                        />
                        }
                    </div>
                    );
                })}
            </div>
        );
    }
    if (previewUrl) {
        return <img src={previewUrl} alt={`${slide.title || '슬라이드'} 미리보기`} className="h-full w-full object-contain" />;
    }

    if (content.html) {
        return <div className="flex h-full items-center justify-center bg-gray-50 text-sm text-gray-400">템플릿 미리보기 불러오는 중…</div>;
    }

    const handleHeadingChange = (newHeading: string) => {
        onUpdate({
            title: newHeading,
            content: { ...content, heading: newHeading }
        });
    };

    const handleSubheadingChange = (newSubheading: string) => {
        onUpdate({
            content: { ...content, subheading: newSubheading }
        });
    };

    const handleBodyChange = (newBody: string) => {
        onUpdate({
            content: { ...content, body: newBody }
        });
    };

    const handleBulletChange = (index: number, newText: string) => {
        const newBullets = [...bullets];
        if (typeof bullets[index] === 'string') {
            newBullets[index] = newText;
        } else {
            newBullets[index] = { ...bullets[index], text: newText };
        }
        onUpdate({
            content: { ...content, bullets: newBullets }
        });
    };

    const handleAddBullet = () => {
        const newBullets = [...bullets, '새 항목'];
        onUpdate({
            content: { ...content, bullets: newBullets }
        });
    };

    const handleRemoveBullet = (index: number) => {
        const newBullets = bullets.filter((_: any, i: number) => i !== index);
        onUpdate({
            content: { ...content, bullets: newBullets }
        });
    };

    // Common editable input styles
    const editableStyle = "bg-transparent border-none outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-50 rounded px-2 py-1 w-full";

    // Render based on slide type
    switch (slide.type) {
        case 'TITLE':
            return (
                <div className="relative h-full overflow-hidden flex flex-col items-center justify-center p-12 text-center" style={previewStyle}>
                    <input
                        type="text"
                        value={heading}
                        onChange={(e) => handleHeadingChange(e.target.value)}
                        onBlur={onSave}
                        placeholder="제목을 입력하세요"
                        className={`${editableStyle} text-4xl font-bold text-gray-900 mb-4 text-center`}
                        style={{ color: previewStyle.color, fontFamily: previewStyle.fontFamily }}
                    />
                    <input
                        type="text"
                        value={subheading}
                        onChange={(e) => handleSubheadingChange(e.target.value)}
                        onBlur={onSave}
                        placeholder="부제목을 입력하세요"
                        className={`${editableStyle} text-xl text-gray-600 text-center`}
                        style={{ color: previewStyle.color, fontFamily: previewStyle.fontFamily }}
                    />
                </div>
            );

        case 'SECTION_HEADER':
            return (
                <div className="relative h-full overflow-hidden flex items-center justify-center bg-gradient-to-br from-purple-600 to-purple-800 p-12" style={previewStyle}>
                    <input
                        type="text"
                        value={heading}
                        onChange={(e) => handleHeadingChange(e.target.value)}
                        onBlur={onSave}
                        placeholder="섹션 제목을 입력하세요"
                        className={`${editableStyle} text-3xl font-bold text-white text-center bg-white/10`}
                        style={{ color: previewStyle.color, fontFamily: previewStyle.fontFamily }}
                    />
                </div>
            );

        case 'QUOTE':
            return (
                <div className="relative h-full overflow-hidden flex flex-col items-center justify-center p-12" style={previewStyle}>
                    <textarea
                        value={body || heading}
                        onChange={(e) => handleBodyChange(e.target.value)}
                        onBlur={onSave}
                        placeholder="인용문을 입력하세요"
                        rows={4}
                        className={`${editableStyle} text-2xl italic text-gray-700 text-center max-w-2xl resize-none`}
                        style={{ color: previewStyle.color, fontFamily: previewStyle.fontFamily }}
                    />
                </div>
            );

        case 'BULLET_LIST':
        case 'CONTENT':
        default:
            return (
                <div className="relative h-full overflow-hidden p-8" style={previewStyle}>
                    <input
                        type="text"
                        value={heading}
                        onChange={(e) => handleHeadingChange(e.target.value)}
                        onBlur={onSave}
                        placeholder="제목을 입력하세요"
                        className={`${editableStyle} text-2xl font-bold text-gray-900 mb-6`}
                        style={{ color: previewStyle.color, fontFamily: previewStyle.fontFamily }}
                    />
                    <textarea
                        value={body}
                        onChange={(e) => handleBodyChange(e.target.value)}
                        onBlur={onSave}
                        placeholder="본문 내용을 입력하세요 (선택사항)"
                        rows={2}
                        className={`${editableStyle} text-gray-600 mb-4 resize-none`}
                        style={{ color: previewStyle.color, fontFamily: previewStyle.fontFamily }}
                    />
                    <ul className="space-y-2">
                        {bullets.map((bullet: any, index: number) => (
                            <li key={index} className="flex items-start gap-2 group">
                                <span className="text-purple-600 font-bold mt-2">•</span>
                                <input
                                    type="text"
                                    value={typeof bullet === 'string' ? bullet : bullet.text}
                                    onChange={(e) => handleBulletChange(index, e.target.value)}
                                    onBlur={onSave}
                                    placeholder="항목 내용"
                                    className={`${editableStyle} text-gray-700 flex-1`}
                                    style={{ color: previewStyle.color, fontFamily: previewStyle.fontFamily }}
                                />
                                <button
                                    onClick={() => handleRemoveBullet(index)}
                                    className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 p-1 transition-opacity"
                                    title="항목 삭제"
                                >
                                    ×
                                </button>
                            </li>
                        ))}
                    </ul>
                    <button
                        onClick={handleAddBullet}
                        className="mt-4 text-purple-600 hover:text-purple-800 text-sm flex items-center gap-1"
                    >
                        <span>+</span>
                        <span>항목 추가</span>
                    </button>
                </div>
            );
    }
}

// Read-only Slide Preview Component (for thumbnails, etc.)
function SlidePreview({ slide }: { slide: any }) {
    const content = slide.content || {};
    const heading = content.heading || slide.title || '';
    const subheading = content.subheading || '';
    const body = content.body || '';
    const bullets = content.bullets || [];

    // Render based on slide type
    switch (slide.type) {
        case 'TITLE':
            return (
                <div className="h-full flex flex-col items-center justify-center p-12 text-center">
                    <h1 className="text-4xl font-bold text-gray-900 mb-4">{heading}</h1>
                    {subheading && <p className="text-xl text-gray-600">{subheading}</p>}
                </div>
            );

        case 'SECTION_HEADER':
            return (
                <div className="h-full flex items-center justify-center bg-gradient-to-br from-purple-600 to-purple-800">
                    <h2 className="text-3xl font-bold text-white">{heading}</h2>
                </div>
            );

        case 'QUOTE':
            return (
                <div className="h-full flex items-center justify-center p-12">
                    <blockquote className="text-2xl italic text-gray-700 text-center max-w-2xl">
                        "{body || heading}"
                    </blockquote>
                </div>
            );

        case 'BULLET_LIST':
        case 'CONTENT':
        default:
            return (
                <div className="h-full p-8">
                    <h2 className="text-2xl font-bold text-gray-900 mb-6">{heading}</h2>
                    {body && <p className="text-gray-600 mb-4">{body}</p>}
                    {bullets.length > 0 && (
                        <ul className="space-y-2">
                            {bullets.map((bullet: any, index: number) => (
                                <li key={index} className="flex items-start gap-2">
                                    <span className="text-purple-600 font-bold">•</span>
                                    <span className="text-gray-700">{typeof bullet === 'string' ? bullet : bullet.text}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            );
    }
}

