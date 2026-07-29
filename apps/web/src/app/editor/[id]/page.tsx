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
import { SceneCanvas, type SceneCanvasHandle, type SceneSelectionFormat } from '@/components/editor/scene-canvas';
import { applySceneCommand, type SlideScene, type SlideObject, type SceneCommand } from '@jaslide/shared';
import { DECK_FONTS } from '@/lib/deck-fonts';
import { createSlideSaveScheduler } from '@/lib/slide-save-scheduler';
import { SHAPE_GROUPS, LINE_OPTIONS, glyphPath, isStrokeOnly, shapeSvgMarkup } from '@/lib/shape-glyphs';
import { nudgeBox } from '@/lib/object-transform';
import {
    ArrowLeft,
    Save,
    Download,
    Share2,
    Plus,
    Trash2,
    BringToFront,
    SendToBack,
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
    Bold,
    Italic,
    Underline,
    Strikethrough,
    AlignLeft,
    AlignCenter,
    AlignRight,
    ListOrdered,
    IndentIncrease,
    IndentDecrease,
    Table2,
    PanelLeftClose,
    PanelLeftOpen,
    PanelRightClose,
    PanelRightOpen,
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

const EDITOR_COLORS = ['#111827', '#374151', '#6B7280', '#FFFFFF', '#DC2626', '#EA580C', '#D97706', '#16A34A', '#2563EB', '#4F46E5', '#9333EA', '#DB2777'];
// Families the browser can actually draw: everything installed from fonts/ by
// scripts/install-fonts.mjs, plus the web-safe ones. Editing this list by hand
// is what let the picker drift from what was really installed.
const FONT_CHOICES = [...DECK_FONTS, 'Arial', 'Times New Roman'];

/** The picker, plus whatever family the object already uses. A deck can name a
 *  font nobody installed, and dropping it from the list would silently retype
 *  the object the moment the panel opened. */
function fontChoicesWith(current?: string): string[] {
    return current && !FONT_CHOICES.includes(current) ? [current, ...FONT_CHOICES] : FONT_CHOICES;
}

function ShapePickerGlyph({ kind }: { kind: string }) {
    // The icon has to read against the panel, not against a slide: a fixed
    // #202124 outline disappeared into the dark theme and a #FFFFFF body turned
    // every filled shape into a white blob. currentColor follows the theme, and a
    // faint tint of it still separates a filled shape from a line. The shape that
    // actually lands on the slide keeps its own colors — see shapeSvgMarkup.
    const stroked = isStrokeOnly(kind);
    return <svg aria-hidden="true" viewBox="0 0 100 100" className="h-5 w-5 overflow-visible text-foreground"><path d={glyphPath(kind)} fill={stroked ? 'none' : 'currentColor'} fillOpacity={stroked ? undefined : 0.18} stroke="currentColor" strokeWidth={6} vectorEffect="non-scaling-stroke" /></svg>;
}

function ColorSwatches({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
    const [open, setOpen] = useState(false);
    return <div className="relative text-xs"><button type="button" aria-label={`${label} 메뉴`} onClick={() => setOpen((visible) => !visible)} className="flex h-8 items-center gap-1 rounded px-2 hover:bg-secondary"><span>{label}</span><span className="h-3 w-4 border-b-4" style={{ borderColor: value }} /></button>{open && <div className="absolute left-0 top-9 z-50 w-52 rounded-lg border bg-card p-2 shadow-xl"><div className="grid grid-cols-6 gap-1">{EDITOR_COLORS.map((color) => <button key={color} type="button" aria-label={`${label} ${color}`} title={color} onClick={() => { onChange(color); setOpen(false); }} className={`h-6 w-6 rounded border ${value.toLowerCase() === color.toLowerCase() ? 'ring-2 ring-purple-500 ring-offset-1' : ''}`} style={{ backgroundColor: color }} />)}</div><label className="mt-2 flex items-center justify-between text-xs text-muted-foreground">사용자 색상 <input aria-label={`${label} 사용자 색상`} type="color" value={value} onChange={(event) => onChange(event.target.value)} /></label></div>}</div>;
}

interface DraggableSlideProps {
    slide: any;
    index: number;
    isSelected: boolean;
    isChecked: boolean;
    onSelect: () => void;
    onToggleCheck: () => void;
    onMove: (from: number, to: number) => void;
    previewUrl?: string;
}

function DraggableSlide({ slide, index, isSelected, isChecked, onSelect, onToggleCheck, onMove, previewUrl }: DraggableSlideProps) {
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
            {/* Every slide used to show the same grey type icon, so a ten-slide deck
                was ten identical boxes. Show the rendered slide once we have it. */}
            <div className="aspect-video overflow-hidden rounded bg-gradient-to-br from-gray-100 to-gray-50 flex items-center justify-center mb-2">
                {previewUrl
                    ? <img src={previewUrl} alt="" className="h-full w-full object-contain" />
                    : <Icon className="h-6 w-6 text-muted-foreground" />}
            </div>
            <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground truncate">
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
    const [ribbonTab, setRibbonTab] = useState<'home' | 'insert'>('home');
    const [showShapePicker, setShowShapePicker] = useState(false);
    const [shapePickerGroup, setShapePickerGroup] = useState(0);
    const [showLinePicker, setShowLinePicker] = useState(false);
    const [tableGrid, setTableGrid] = useState<{ rows: number; columns: number } | null>(null);
    const [showTablePicker, setShowTablePicker] = useState(false);
    const [isFocusMode, setIsFocusMode] = useState(false);
    const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(true);
    const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
    const [aiChatInput, setAiChatInput] = useState('');
    const [aiChatBusy, setAiChatBusy] = useState(false);
    const aiEditAbortRef = useRef<AbortController | null>(null);
    const imageInputRef = useRef<HTMLInputElement | null>(null);
    const [aiChatMessages, setAiChatMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
    const [isExporting, setIsExporting] = useState(false);
    const [isDuplicating, setIsDuplicating] = useState(false);
    const [showTemplatesDialog, setShowTemplatesDialog] = useState(false);
    const [multiSelectedSlides, setMultiSelectedSlides] = useState<string[]>([]);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    // Per-slide preview revisions. A single global counter meant one keystroke's
    // debounced save invalidated every slide's cached preview, and the prefetch
    // loop below then re-rendered the whole deck through LibreOffice (~0.9s each).
    const [previewRevisions, setPreviewRevisions] = useState<Record<string, number>>({});
    // Which slide+revision the displayed image actually is. While it lags behind the
    // current revision the canvas shows the edited text itself, so a change appears
    // immediately instead of after the ~1s LibreOffice round trip.
    const [previewKey, setPreviewKey] = useState<string | null>(null);
    const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
    const previewCacheRef = useRef(new Map<string, string>());
    const previewPendingRef = useRef(new Map<string, Promise<string | null>>());
    const previewSlideIdRef = useRef<string | null>(null);
    const [selectedNativeObjectId, setSelectedNativeObjectId] = useState<string | null>(null);
    // The current slide's editable scene — fetched on demand per slide, null
    // while loading or when the slide has nothing scene-derivable to show yet.
    const [scene, setScene] = useState<SlideScene | null>(null);
    const [sceneError, setSceneError] = useState(false);
    // What the canvas has selected, and how it is formatted. Drives the toolbar.
    const [canvasFormat, setCanvasFormat] = useState<SceneSelectionFormat | null>(null);
    const [fontSizeDraft, setFontSizeDraft] = useState('');
    const [fontSizeTyping, setFontSizeTyping] = useState(false);
    const sceneCanvasRef = useRef<SceneCanvasHandle>(null);
    const [leftPanelWidth, setLeftPanelWidth] = useState(208);
    const [rightPanelWidth, setRightPanelWidth] = useState(336);

    useEffect(() => {
        if (window.innerWidth < 1180) setIsFocusMode(true);
    }, []);

    const selectedSlide = presentation?.slides.find((s) => s.id === selectedSlideId);
    const selectedObject = scene?.objects.find((item) => item.id === selectedNativeObjectId);
    const navigateSlide = (direction: -1 | 1) => {
        const index = presentation?.slides.findIndex((slide) => slide.id === selectedSlideId) ?? -1;
        const target = presentation?.slides[index + direction];
        if (!target) return;
        setSelectedSlide(target.id);
        setSelectedNativeObjectId(null);
    };

    // One formatting bar for both deck kinds — the canvas reports what it has
    // selected (`canvasFormat`, from `SceneCanvas`'s `onSelectionFormat`), so
    // there is no separate HTML-path derivation to keep in sync with it.
    const activeFormat = canvasFormat;

    useEffect(() => {
        setFontSizeDraft(activeFormat ? String(activeFormat.fontSize) : '');
        setFontSizeTyping(false);
    }, [activeFormat?.fontSize]);

    /** Apply a formatting change to whichever object is selected. */
    const applyFormat = (updates: {
        fontFamily?: string; fontSize?: number; bold?: boolean; italic?: boolean;
        underline?: boolean; color?: string; align?: string; fillColor?: string;
    }) => {
        if (canvasFormat) {
            // Alignment and fill are paragraph/box properties, never per-character
            // — always whole-object, the same as a real slide editor. Everything
            // else formats the live text selection when there is one, falling back
            // to the whole object when there is only a caret (or none).
            const perCharacter = updates.align === undefined && updates.fillColor === undefined;
            if (perCharacter && sceneCanvasRef.current?.formatSelection(updates)) {
                setCanvasFormat((format) => format ? { ...format, ...updates } : format);
                return;
            }
            if (updates.fillColor !== undefined) {
                sceneCanvasRef.current?.paintColor(canvasFormat.objectId, 'fill', updates.fillColor);
                onSceneCommand({ objectId: canvasFormat.objectId, patch: { fill: updates.fillColor } as Partial<SlideObject> });
            }
            if (updates.align !== undefined) {
                const target = scene?.objects.find((item) => item.id === canvasFormat.objectId);
                if (target && target.type === 'text') {
                    onSceneCommand({
                        objectId: canvasFormat.objectId,
                        patch: { paragraphs: target.paragraphs.map((paragraph) => ({ ...paragraph, align: updates.align as any })) } as Partial<SlideObject>,
                    });
                }
            }
            setCanvasFormat((format) => format ? { ...format, ...updates } : format);
        }
    };

    const commitFontSize = () => {
        if (!activeFormat) return;
        const fontSize = Math.max(1, Number(fontSizeDraft) || activeFormat.fontSize);
        setFontSizeDraft(String(fontSize));
        applyFormat({ fontSize });
    };
    const changeFontSize = (amount: number) => {
        if (!activeFormat) return;
        const fontSize = Math.max(1, (Number(fontSizeDraft) || activeFormat.fontSize) + amount);
        setFontSizeDraft(String(fontSize));
        applyFormat({ fontSize });
    };

    useEffect(() => {
        if (!presentation || !selectedSlide) { setScene(null); setSceneError(false); return; }
        let cancelled = false;
        setScene(null);
        setSceneError(false);
        slidesApi.getScene(presentation.id, selectedSlide.id)
            .then(({ data }) => { if (!cancelled) setScene(data.scene); })
            .catch(() => { if (!cancelled) setSceneError(true); });
        return () => { cancelled = true; };
    }, [presentation, selectedSlide]);
    // Dropdowns only closed by clicking their own button again, which left the shape
    // sheet covering the canvas. Close on an outside click or Escape, as menus do.
    useEffect(() => {
        if (!showShapePicker && !showLinePicker && !showTablePicker) return;
        const close = () => { setShowShapePicker(false); setShowLinePicker(false); setShowTablePicker(false); };
        const onPointerDown = (event: PointerEvent) => {
            if (!(event.target as HTMLElement)?.closest?.('[data-insert-picker]')) close();
        };
        const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
        window.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('pointerdown', onPointerDown);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [showShapePicker, showLinePicker, showTablePicker]);

    // Bump only the slides that actually changed, so untouched previews stay cached.
    const invalidatePreviews = useCallback((slideIds: string[]) => {
        setPreviewRevisions((revisions) => {
            const next = { ...revisions };
            for (const id of slideIds) next[id] = (next[id] || 0) + 1;
            return next;
        });
    }, []);

    const loadPreview = useCallback((slideIndex: number, slideId: string) => {
        const key = `${slideId}:${previewRevisions[slideId] || 0}`;
        const cached = previewCacheRef.current.get(key);
        if (cached) {
            setThumbnails((current) => (current[slideId] === cached ? current : { ...current, [slideId]: cached }));
            return Promise.resolve(cached);
        }
        const pending = previewPendingRef.current.get(key);
        if (pending) return pending;
        const request = exportApi.preview(presentationId, slideIndex)
            .then(async (response) => {
                const url = URL.createObjectURL(response.data);
                // Publish the URL only once the bitmap can be painted. Handing a fresh
                // blob straight to <img src> blanks the element for a frame or two while
                // it decodes, and after every edit that reads as a flicker on the slide
                // you are working on.
                const image = new Image();
                image.src = url;
                await (image.decode ? image.decode().catch(() => undefined) : Promise.resolve());
                previewCacheRef.current.set(key, url);
                setThumbnails((current) => ({ ...current, [slideId]: url }));
                return url;
            })
            .catch(() => null)
            .finally(() => previewPendingRef.current.delete(key));
        previewPendingRef.current.set(key, request);
        return request;
    }, [presentationId, previewRevisions]);

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

    // Debounced scene save — same 500ms shape as `handleSaveSlideDelayed`, but
    // posts the whole scene so the server can convert it to whichever legacy
    // format (objectEdits or html) this slide's source actually needs.
    const sceneSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const saveSceneDelayed = useCallback((nextScene: SlideScene) => {
        if (!presentation || !selectedSlide) return;
        if (sceneSaveTimerRef.current) clearTimeout(sceneSaveTimerRef.current);
        sceneSaveTimerRef.current = setTimeout(() => {
            slidesApi.saveScene(presentation.id, selectedSlide.id, nextScene).catch(() => {
                toast({ title: '저장 실패', description: '편집 내용을 저장하지 못했습니다.', variant: 'destructive' });
            });
        }, 500);
    }, [presentation, selectedSlide]);

    const onSceneCommand = useCallback((command: SceneCommand) => {
        setScene((current) => {
            if (!current) return current;
            const next = applySceneCommand(current, command);
            saveSceneDelayed(next);
            return next;
        });
    }, [saveSceneDelayed]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')) return;
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
                // With an object selected, Ctrl+D means duplicate that object. It used
                // to fall through and duplicate the entire slide, which is not undoable
                // in one step and is never what the shortcut means elsewhere.
                if (selectedNativeObjectId) duplicateSelectedObject();
                else if (selectedSlideId) handleDuplicateSlide();
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                if (selectedNativeObjectId) deleteSelectedObject();
            } else if (selectedObject && e.key.startsWith('Arrow')) {
                // Nudging is how you line objects up without retyping coordinates.
                const box = nudgeBox({
                    left: selectedObject.x, top: selectedObject.y, width: selectedObject.width, height: selectedObject.height,
                }, e.key, e.shiftKey);
                if (box) {
                    e.preventDefault();
                    onSceneCommand({ objectId: selectedObject.id, patch: { x: box.left, y: box.top } });
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [canUndo, canRedo, undo, redo, selectedSlideId, selectedNativeObjectId, selectedObject, onSceneCommand]);

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
        const key = `${selectedSlideId}:${previewRevisions[selectedSlideId] || 0}`;
        const cached = previewCacheRef.current.get(key);
        if (cached) {
            previewSlideIdRef.current = selectedSlideId;
            setPreviewUrl(cached);
            setPreviewKey(key);
        } else if (previewSlideIdRef.current !== selectedSlideId) {
            previewSlideIdRef.current = null;
            setPreviewUrl(null);
            setPreviewKey(null);
        }
        void loadPreview(slideIndex, selectedSlideId).then((url) => {
            if (active && url) {
                previewSlideIdRef.current = selectedSlideId;
                setPreviewUrl(url);
                setPreviewKey(key);
            }
        });
        // Warm the neighbours first, then fill the rest of the panel's thumbnails one
        // at a time. The renderer serves a single request at a time, so firing the whole
        // deck at once (what this used to do) queued ahead of the slide being edited.
        void (async () => {
            for (const offset of [1, -1]) {
                const neighbour = presentation.slides[slideIndex + offset];
                if (active && neighbour) await loadPreview(slideIndex + offset, neighbour.id);
            }
            for (let index = 0; index < presentation.slides.length && active; index += 1) {
                await loadPreview(index, presentation.slides[index].id);
            }
        })();
        return () => { active = false; };
    }, [presentation, selectedSlideId, previewRevisions, loadPreview]);

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
            invalidatePreviews([slide.id]);
        } catch (error) {
            console.error('Failed to save slide:', error);
        }
    };

    // Debounced save for select/dropdown changes. Scheduled per-slide so
    // editing slide A and then slide B within the debounce window no longer
    // cancels A's pending save (each slide id gets its own timer).
    const saveSchedulerRef = useRef<ReturnType<typeof createSlideSaveScheduler> | null>(null);
    if (!saveSchedulerRef.current) {
        saveSchedulerRef.current = createSlideSaveScheduler(async (slideId: string, updates: Partial<any>) => {
            // Read the slide from the store, not from this closure: the scheduler is
            // built once on the first render, when `presentation` is still null, so a
            // captured copy would never find the slide and the save would silently
            // no-op — leaving the editor stuck on "저장 대기 중" forever.
            const slide = useEditorStore.getState().presentation?.slides.find((s) => s.id === slideId);
            if (!slide) return;
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
                invalidatePreviews([slideId]);
            } catch (error) {
                console.error('Failed to save slide:', error);
            }
        }, 500);
    }
    const handleSaveSlideDelayed = (slideId: string, updates: Partial<any>) => {
        saveSchedulerRef.current!.schedule(slideId, updates);
    };

    const commitScene = useCallback((mutate: (objects: SlideObject[]) => SlideObject[]) => {
        setScene((current) => {
            if (!current) return current;
            const next = { ...current, objects: mutate(current.objects) };
            saveSceneDelayed(next);
            return next;
        });
    }, [saveSceneDelayed]);

    const insertSceneObject = useCallback((object: SlideObject) => {
        commitScene((objects) => [...objects, object]);
    }, [commitScene]);

    const deleteSceneObject = useCallback((objectId: string) => {
        commitScene((objects) => objects.filter((item) => item.id !== objectId));
    }, [commitScene]);

    const duplicateSceneObject = useCallback((objectId: string): string | null => {
        const source = scene?.objects.find((item) => item.id === objectId);
        if (!source) return null;
        const { sourceRef, ...rest } = source as SlideObject & { sourceRef?: unknown };
        const copy = { ...rest, id: `copy-${crypto.randomUUID()}`, x: source.x + 32, y: source.y + 32 } as SlideObject;
        insertSceneObject(copy);
        return copy.id;
    }, [scene, insertSceneObject]);

    const insertSceneText = () => {
        const id = `new-text-${crypto.randomUUID()}`;
        insertSceneObject({
            id, x: 180, y: 180, width: 640, height: 100, rotation: 0,
            type: 'text', paragraphs: [{ runs: [{ text: '새 텍스트', fontSize: 24, color: '#1A1A1A' }], level: 0, align: 'left' }],
        });
        setSelectedNativeObjectId(id);
        setRibbonTab('home');
    };

    const insertSceneList = () => {
        const id = `new-text-${crypto.randomUUID()}`;
        insertSceneObject({
            id, x: 180, y: 180, width: 720, height: 160, rotation: 0,
            type: 'text',
            paragraphs: ['첫 번째 항목', '두 번째 항목', '세 번째 항목'].map((text) => ({
                runs: [{ text, fontSize: 24, color: '#1A1A1A' }], level: 0, align: 'left' as const, bulleted: true,
            })),
        });
        setSelectedNativeObjectId(id);
    };

    const insertSceneTable = (rows: number, columns: number) => {
        const width = 1440;
        const height = Math.min(700, 90 * rows);
        const emptyCell = { paragraphs: [{ runs: [{ text: '' }], level: 0, align: 'left' as const }] };
        const id = `new-table-${crypto.randomUUID()}`;
        insertSceneObject({
            id, x: 240, y: 300, width, height, rotation: 0,
            type: 'table',
            rowHeights: Array.from({ length: rows }, () => height / rows),
            columnWidths: Array.from({ length: columns }, () => width / columns),
            cells: Array.from({ length: rows }, () => Array.from({ length: columns }, () => ({ ...emptyCell }))),
        });
        setSelectedNativeObjectId(id);
    };

    const insertSceneShape = (kind: string, line = false) => {
        const width = 420;
        const height = line ? 80 : 220;
        const id = `new-${line ? 'line' : 'shape'}-${crypto.randomUUID()}`;
        insertSceneObject(line
            ? { id, x: 180, y: 180, width, height, rotation: 0, type: 'line', lineStyle: kind, stroke: '#202124', strokeWidth: 2 }
            : { id, x: 180, y: 180, width, height, rotation: 0, type: 'shape', shape: kind, fill: '#FFFFFF', stroke: '#202124', strokeWidth: 2 });
        setSelectedNativeObjectId(id);
    };

    const insertSceneImage = (imageData: string) => {
        const id = `new-image-${crypto.randomUUID()}`;
        insertSceneObject({ id, x: 180, y: 180, width: 640, height: 360, rotation: 0, type: 'image', src: imageData });
        setSelectedNativeObjectId(id);
    };

    const handleImageInsert = (file: File | undefined) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => insertSceneImage(reader.result as string);
        reader.readAsDataURL(file);
    };

    const deleteSelectedObject = () => selectedNativeObjectId && deleteSceneObject(selectedNativeObjectId);
    const duplicateSelectedObject = () => {
        if (!selectedNativeObjectId) return;
        const copyId = duplicateSceneObject(selectedNativeObjectId);
        if (copyId) setSelectedNativeObjectId(copyId);
    };

    const persistHistoryState = async () => {
        saveSchedulerRef.current?.cancelAll();
        const restored = useEditorStore.getState().presentation;
        if (!restored) return;
        setSaving(true);
        try {
            const listed = await slidesApi.list(presentationId);
            const serverSlides = listed.data as Array<{ id: string }>;
            const restoredIds = new Set(restored.slides.map((slide) => slide.id));
            const missingSlides = restored.slides.filter((slide) => !serverSlides.some((serverSlide) => serverSlide.id === slide.id));
            const removedSlides = serverSlides.filter((serverSlide) => !restoredIds.has(serverSlide.id));

            await Promise.all(removedSlides.map((slide) => slidesApi.delete(presentationId, slide.id)));
            const recreated = await Promise.all(missingSlides.map(async (slide) => {
                const response = await slidesApi.create(presentationId, {
                    type: slide.type, title: slide.title, content: slide.content,
                    layout: slide.layout, notes: slide.notes, order: slide.order,
                });
                return [slide.id, response.data.id] as const;
            }));

            if (recreated.length > 0) {
                const ids = new Map(recreated);
                const slides = restored.slides.map((slide) => ids.has(slide.id) ? { ...slide, id: ids.get(slide.id)! } : slide);
                const currentSelectedSlideId = useEditorStore.getState().selectedSlideId;
                const selectedSlideId = currentSelectedSlideId ? ids.get(currentSelectedSlideId) || currentSelectedSlideId : null;
                setPresentation({ ...restored, slides });
                setSelectedSlide(selectedSlideId);
            }

            const synchronized = useEditorStore.getState().presentation;
            if (!synchronized) return;
            await Promise.all(synchronized.slides.map((slide) => slidesApi.update(presentationId, slide.id, {
                type: slide.type, title: slide.title, content: slide.content,
                layout: slide.layout, notes: slide.notes, order: slide.order,
            })));
            setDirty(false);
            invalidatePreviews(synchronized.slides.map((slide) => slide.id));
        } catch (error) {
            toast({ title: '저장 실패', description: '실행 취소 내용을 저장하지 못했습니다.', variant: 'destructive' });
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteSlide = async () => {
        if (!selectedSlideId || !presentation) return;
        if (presentation.slides.length <= 1) {
            toast({ title: '삭제 불가', description: '최소 1개의 슬라이드가 필요합니다.', variant: 'destructive' });
            return;
        }

        try {
            removeSlide(selectedSlideId);
            await persistHistoryState();
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
    const handleExport = async (format: 'pptx' | 'pdf', editable = false) => {
        try {
            setIsExporting(true);
            setShowExportMenu(false);

            // The renderer builds the file from what is stored, so a debounced edit
            // still waiting its 500ms was silently missing from the download.
            await saveSchedulerRef.current?.flushAll();

            const response = format === 'pptx'
                ? await exportApi.pptx(presentationId, editable)
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
        } catch (error: any) {
            // Export responses are arraybuffers, so an error body arrives as bytes and
            // the reason was thrown away — "내보내기 실패" alone is not actionable when
            // the cause is a renderer that is down.
            let reason = error?.message;
            const data = error?.response?.data;
            if (data instanceof ArrayBuffer || data instanceof Blob) {
                const text = data instanceof Blob ? await data.text() : new TextDecoder().decode(data);
                reason = (() => { try { return JSON.parse(text)?.message ?? text; } catch { return text; } })() || reason;
            } else if (typeof data?.message === 'string') {
                reason = data.message;
            }
            toast({ title: '내보내기 실패', description: reason || '알 수 없는 오류입니다.', variant: 'destructive' });
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
            invalidatePreviews(targets);
            setAiChatMessages((messages) => [...messages, { role: 'assistant', text: `${targets.length}개 슬라이드를 수정했습니다.` }]);
            toast({ title: 'AI 편집 완료', description: `${targets.length}개 슬라이드가 업데이트되었습니다.` });
            // Persist any manual edits still pending on other slides before
            // pulling server state back down, so this fetch can't clobber
            // in-flight local changes with stale data.
            await saveSchedulerRef.current?.flushAll();
            await fetchPresentation();
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
            <div className="min-h-screen bg-secondary flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
            </div>
        );
    }

    if (!presentation) {
        return null;
    }

    return (
        <DndProvider backend={HTML5Backend}>
            <div className="h-screen flex flex-col bg-secondary">
                {/* Header */}
                <header className="bg-card border-b px-4 py-2 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/dashboard" className="p-2 hover:bg-secondary rounded-lg">
                            <ArrowLeft className="h-5 w-5" />
                        </Link>
                        <div>
                            <h1 className="font-medium">{presentation.title}</h1>
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">
                                    {presentation.slides.length} 슬라이드
                                </span>
                                <SaveStatusIndicator presentationId={presentationId} isDirty={isDirty} />
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <UndoRedoButtons onUndo={() => { void persistHistoryState(); }} onRedo={() => { void persistHistoryState(); }} />
                        <div className="w-px h-6 bg-muted" />
                        <Button variant={rightTab === 'edit' ? 'secondary' : 'outline'} size="sm" onClick={() => setRightTab('edit')}>
                            <Type className="h-4 w-4 mr-1" />
                            수동 편집
                        </Button>
                        <Button variant={isFocusMode ? 'secondary' : 'outline'} size="sm" onClick={() => setIsFocusMode((value) => !value)}>
                            {isFocusMode ? '일반 보기' : '집중 보기'}
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
                        <div className="w-px h-6 bg-muted" />
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
                                <div className="absolute right-0 top-10 w-72 bg-card rounded-lg shadow-lg border p-2 z-50">
                                    <button
                                        onClick={() => handleExport('pptx')}
                                        className="w-full flex items-start gap-2 px-3 py-2 hover:bg-secondary rounded text-left text-sm"
                                    >
                                        <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
                                        <span>
                                            PowerPoint (.pptx)
                                            <span className="block text-xs text-muted-foreground">디자인을 그대로 유지합니다.</span>
                                        </span>
                                    </button>
                                    {/* An HTML-template deck otherwise exports one flat picture per
                                        slide, so the recipient cannot revise a single word of it. */}
                                    <button
                                        onClick={() => handleExport('pptx', true)}
                                        className="w-full flex items-start gap-2 px-3 py-2 hover:bg-secondary rounded text-left text-sm"
                                    >
                                        <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-purple-600" />
                                        <span>
                                            PowerPoint · 편집 가능 (.pptx)
                                            <span className="block text-xs text-muted-foreground">파워포인트에서 글자와 도형을 고칠 수 있습니다.</span>
                                        </span>
                                    </button>
                                    <button
                                        onClick={() => handleExport('pdf')}
                                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-secondary rounded text-sm"
                                    >
                                        <FileText className="h-4 w-4 text-red-500" />
                                        PDF (.pdf)
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </header>

                <div className="flex min-h-14 shrink-0 items-center gap-3 overflow-visible border-b bg-card px-4 text-sm">
                    <div className="flex self-stretch items-center gap-1 border-r pr-3">
                        <button type="button" onClick={() => setRibbonTab('home')} className={`h-full px-2 font-medium ${ribbonTab === 'home' ? 'border-b-2 border-purple-600 text-purple-700' : 'text-muted-foreground'}`}>홈</button>
                        <button type="button" onClick={() => setRibbonTab('insert')} className={`h-full px-2 font-medium ${ribbonTab === 'insert' ? 'border-b-2 border-purple-600 text-purple-700' : 'text-muted-foreground'}`}>삽입</button>
                    </div>
                    {ribbonTab === 'home' ? (activeFormat ? <>
                        {activeFormat.objectType !== 'shape' && activeFormat.objectType !== 'image' && <>
                            <select aria-label="글꼴" value={activeFormat.fontFamily} onChange={(event) => applyFormat({ fontFamily: event.target.value })} className="h-8 rounded border px-2">{fontChoicesWith(activeFormat.fontFamily).map((name) => <option key={name} value={name}>{name}</option>)}</select>
                            <div className="flex items-center">
                                <Button aria-label="글자 작게" type="button" size="icon" variant="ghost" onClick={() => changeFontSize(-1)}>−</Button>
                                <input
                                    aria-label="글자 크기" inputMode="numeric" value={fontSizeDraft}
                                    onFocus={(event) => { event.currentTarget.select(); setFontSizeTyping(false); }}
                                    onClick={(event) => { event.currentTarget.select(); setFontSizeTyping(false); }}
                                    onChange={(event) => { setFontSizeTyping(true); setFontSizeDraft(event.target.value.replace(/\D/g, '')); }}
                                    onBlur={commitFontSize}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                                        else if (!fontSizeTyping && /^\d$/.test(event.key)) { event.preventDefault(); setFontSizeTyping(true); setFontSizeDraft(event.key); }
                                    }}
                                    className="h-8 w-14 rounded border px-2 text-center"
                                />
                                <Button aria-label="글자 크게" type="button" size="icon" variant="ghost" onClick={() => changeFontSize(1)}>+</Button>
                            </div>
                            <Button aria-label="굵게" type="button" size="icon" variant={activeFormat.bold ? 'secondary' : 'ghost'} onClick={() => applyFormat({ bold: !activeFormat.bold })}><Bold className="h-4 w-4" /></Button>
                            <Button aria-label="기울임" type="button" size="icon" variant={activeFormat.italic ? 'secondary' : 'ghost'} onClick={() => applyFormat({ italic: !activeFormat.italic })}><Italic className="h-4 w-4" /></Button>
                            <Button aria-label="밑줄" type="button" size="icon" variant={activeFormat.underline ? 'secondary' : 'ghost'} onClick={() => applyFormat({ underline: !activeFormat.underline })}><Underline className="h-4 w-4" /></Button>
                            <Button aria-label="왼쪽 정렬" type="button" size="icon" variant={activeFormat.align === 'left' ? 'secondary' : 'ghost'} onClick={() => applyFormat({ align: 'left' })}><AlignLeft className="h-4 w-4" /></Button>
                            <Button aria-label="가운데 정렬" type="button" size="icon" variant={activeFormat.align === 'center' ? 'secondary' : 'ghost'} onClick={() => applyFormat({ align: 'center' })}><AlignCenter className="h-4 w-4" /></Button>
                            <Button aria-label="오른쪽 정렬" type="button" size="icon" variant={activeFormat.align === 'right' ? 'secondary' : 'ghost'} onClick={() => applyFormat({ align: 'right' })}><AlignRight className="h-4 w-4" /></Button>
                            <ColorSwatches label="글자색" value={activeFormat.color} onChange={(color) => applyFormat({ color })} />
                        </>}
                        <ColorSwatches label="채우기" value={activeFormat.fillColor} onChange={(fillColor) => applyFormat({ fillColor })} />
                        <Button aria-label="선택한 객체 복제" type="button" size="sm" variant="ghost" onClick={duplicateSelectedObject}><Copy className="mr-1 h-4 w-4" />복제</Button>
                        <Button aria-label="선택한 객체 삭제" type="button" size="sm" variant="ghost" className="text-red-600 hover:text-red-700" onClick={deleteSelectedObject}><Trash2 className="mr-1 h-4 w-4" />삭제</Button>
                    </> : <span className="text-xs text-muted-foreground">객체를 선택하면 글꼴, 목록, 정렬, 색상 서식을 적용할 수 있습니다.</span>) : <>
                        <Button type="button" size="sm" variant="outline" onClick={insertSceneText}><Type className="mr-1 h-4 w-4" />텍스트</Button>
                        <div className="relative" data-insert-picker><Button type="button" size="sm" variant="outline" aria-haspopup="true" aria-expanded={showShapePicker} onClick={() => { setShowShapePicker((open) => !open); setShowLinePicker(false); }}><Layout className="mr-1 h-4 w-4" />도형</Button>{showShapePicker && <div className="absolute left-0 top-10 z-50 flex w-[330px] overflow-hidden rounded border bg-card shadow-lg"><nav className="w-28 border-r p-1">{SHAPE_GROUPS.map(([group], index) => <button key={group} type="button" onMouseEnter={() => setShapePickerGroup(index)} onFocus={() => setShapePickerGroup(index)} onClick={() => setShapePickerGroup(index)} aria-current={shapePickerGroup === index} className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs ${shapePickerGroup === index ? 'bg-secondary text-foreground' : 'text-foreground hover:bg-secondary'}`}><span>{group}</span><span>›</span></button>)}</nav><div className="w-[202px] p-2"><div className="grid grid-cols-5 gap-1">{SHAPE_GROUPS[shapePickerGroup][1].map(([kind, label]) => <button key={kind} type="button" aria-label={label} title={label} onClick={() => { insertSceneShape(kind); setShowShapePicker(false); }} className="flex h-8 items-center justify-center rounded hover:bg-secondary"><ShapePickerGlyph kind={kind} /></button>)}</div></div></div>}</div>
                        <div className="relative" data-insert-picker><Button type="button" size="sm" variant="outline" aria-haspopup="true" aria-expanded={showLinePicker} onClick={() => { setShowLinePicker((open) => !open); setShowShapePicker(false); }}>선</Button>{showLinePicker && <div className="absolute left-0 top-10 z-50 w-36 rounded border bg-card p-2 shadow-lg"><div className="grid grid-cols-3 gap-1">{LINE_OPTIONS.map(({ kind, label }) => <button key={kind} type="button" aria-label={label} title={label} onClick={() => { insertSceneShape(kind, true); setShowLinePicker(false); }} className="flex h-8 items-center justify-center rounded hover:bg-secondary"><ShapePickerGlyph kind={kind} /></button>)}</div></div>}</div>
                        <Button type="button" size="sm" variant="outline" onClick={insertSceneList}><List className="mr-1 h-4 w-4" />글머리</Button>
                        <Button type="button" size="sm" variant="outline" onClick={insertSceneList}><ListOrdered className="mr-1 h-4 w-4" />번호 목록</Button>
                        <div className="relative" data-insert-picker>
                            <Button type="button" size="sm" variant="outline" aria-haspopup="true" aria-expanded={showTablePicker} onClick={() => { setShowTablePicker((open) => !open); setShowShapePicker(false); setShowLinePicker(false); }}><Table2 className="mr-1 h-4 w-4" />표</Button>
                            {showTablePicker && <div className="absolute left-0 top-10 z-50 rounded border bg-card p-2 shadow-lg">
                                {/* Pick the size before inserting, the way Google Slides does — a
                                    fixed 3x3 cannot grow afterwards. */}
                                <div className="grid grid-cols-8 gap-0.5" onPointerLeave={() => setTableGrid(null)}>
                                    {Array.from({ length: 6 * 8 }, (_, index) => {
                                        const rows = Math.floor(index / 8) + 1;
                                        const columns = (index % 8) + 1;
                                        const active = !!tableGrid && rows <= tableGrid.rows && columns <= tableGrid.columns;
                                        return <button
                                            key={index}
                                            type="button"
                                            aria-label={`${rows}행 ${columns}열 표`}
                                            className={`h-4 w-4 rounded-sm border ${active ? 'border-purple-600 bg-purple-200' : 'border-border bg-card'}`}
                                            onPointerEnter={() => setTableGrid({ rows, columns })}
                                            onFocus={() => setTableGrid({ rows, columns })}
                                            onClick={() => {
                                                insertSceneTable(rows, columns);
                                                setShowTablePicker(false);
                                                setTableGrid(null);
                                            }}
                                        />;
                                    })}
                                </div>
                                <p className="mt-1.5 text-center text-xs text-muted-foreground">{tableGrid ? `${tableGrid.rows} × ${tableGrid.columns}` : '크기를 고르세요'}</p>
                            </div>}
                        </div>
                        <Button type="button" size="sm" variant="outline" onClick={() => imageInputRef.current?.click()}><ImageIcon className="mr-1 h-4 w-4" />그림</Button>
                        <input ref={imageInputRef} aria-label="그림 파일 선택" type="file" accept="image/*" className="hidden" onChange={(event) => { handleImageInsert(event.target.files?.[0]); event.currentTarget.value = ''; }} />
                    </>}
                </div>

                <div className="flex-1 flex overflow-hidden">
                    {!isFocusMode && isLeftPanelOpen ? <>
                    {/* Slide List Panel */}
                    <aside className="shrink-0 bg-card border-r p-3 overflow-auto" style={{ width: leftPanelWidth }}>
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-sm font-medium text-foreground">슬라이드</span>
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
                                    previewUrl={thumbnails[slide.id]}
                                    onSelect={() => {
                                        setSelectedSlide(slide.id);
                                        setSelectedNativeObjectId(null);
                                    }}
                                    onToggleCheck={() => setMultiSelectedSlides((prev) =>
                                        prev.includes(slide.id) ? prev.filter((id) => id !== slide.id) : [...prev, slide.id]
                                    )}
                                    onMove={reorderSlides}
                                />
                            ))}
                        </div>
                    </aside>
                    <div role="separator" aria-label="슬라이드 목록 너비 조절" aria-orientation="vertical" onPointerDown={startPanelResize('left')} className="relative w-1.5 shrink-0 cursor-col-resize bg-muted hover:bg-purple-400 active:bg-purple-500">
                        <button type="button" aria-label="슬라이드 패널 접기" title="슬라이드 패널 접기" onPointerDown={(event) => event.stopPropagation()} onClick={() => setIsLeftPanelOpen(false)} className="absolute left-1/2 top-1/2 z-10 flex h-7 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded border bg-card text-muted-foreground shadow-sm hover:bg-secondary"><PanelLeftClose className="h-3.5 w-3.5" /></button>
                    </div>
                    </> : !isFocusMode ? <div className="flex w-8 shrink-0 items-start justify-center border-r bg-card pt-3"><button type="button" aria-label="슬라이드 패널 펼치기" title="슬라이드 패널 펼치기" onClick={() => setIsLeftPanelOpen(true)} className="flex h-8 w-7 items-center justify-center rounded text-muted-foreground hover:bg-secondary"><PanelLeftOpen className="h-4 w-4" /></button></div> : null}

                    {/* Main Editor Area */}
                    <main className="flex-1 min-w-0 overflow-auto p-4">
                        <div className={isFocusMode ? 'mx-auto w-full max-w-[1280px]' : 'mx-auto w-[1100px] min-w-[960px]'}>
                            {/* Slide Preview */}
                            <div className="editor-canvas bg-white shadow-lg rounded-lg overflow-hidden">
                                {selectedSlide ? (
                                    <EditableSlidePreview
                                        slide={selectedSlide}
                                        scene={scene}
                                        sceneError={sceneError}
                                        previewUrl={previewUrl}
                                        selectedObjectId={selectedNativeObjectId}
                                        onSelectObject={setSelectedNativeObjectId}
                                        onSelectionFormat={setCanvasFormat}
                                        onCommand={onSceneCommand}
                                        sceneCanvasRef={sceneCanvasRef}
                                        onNavigate={navigateSlide}
                                    />
                                ) : (
                                    <div className="h-full flex items-center justify-center text-muted-foreground">
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

                    {!isFocusMode && isRightPanelOpen ? <>
                    <div role="separator" aria-label="AI 패널 너비 조절" aria-orientation="vertical" onPointerDown={startPanelResize('right')} className="relative w-1.5 shrink-0 cursor-col-resize bg-muted hover:bg-purple-400 active:bg-purple-500">
                        <button type="button" aria-label="AI 패널 접기" title="AI 패널 접기" onPointerDown={(event) => event.stopPropagation()} onClick={() => setIsRightPanelOpen(false)} className="absolute left-1/2 top-1/2 z-10 flex h-7 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded border bg-card text-muted-foreground shadow-sm hover:bg-secondary"><PanelRightClose className="h-3.5 w-3.5" /></button>
                    </div>

                    {/* AI Chat / Manual Edit Panel */}
                    <aside className="flex shrink-0 flex-col bg-card border-l p-4 overflow-hidden" style={{ width: rightPanelWidth }}>
                        <div className="mb-4 flex items-center justify-between">
                            <h3 className="font-medium text-foreground">{rightTab === 'chat' ? 'AI 채팅' : '수동 편집'}</h3>
                            {rightTab === 'edit' && <Button variant="ghost" size="sm" onClick={() => setRightTab('chat')}>AI 채팅으로</Button>}
                        </div>
                        {rightTab === 'chat' && (
                            <div className="flex min-h-0 flex-1 flex-col gap-3">
                                <p className="rounded-lg bg-purple-50 px-3 py-2 text-xs text-purple-900">전체 슬라이드 대상 · “3번 슬라이드”, “2~4번”처럼 번호를 적으면 해당 슬라이드만 수정합니다.</p>
                                <div className="flex-1 space-y-3 overflow-y-auto rounded-2xl bg-secondary p-3">
                                    {aiChatMessages.length === 0 && <div className="rounded-2xl bg-card p-3 text-sm text-muted-foreground shadow-sm">무엇을 바꿀지 자연어로 요청해 주세요.<br /><span className="text-xs text-muted-foreground">예: 3번 슬라이드의 표를 더 간결하게 정리해줘</span></div>}
                                    {aiChatMessages.map((message, index) => <div key={index} className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm shadow-sm ${message.role === 'user' ? 'ml-auto bg-purple-600 text-white' : 'bg-card text-foreground'}`}>{message.text}</div>)}
                                </div>
                                <div className="rounded-2xl border bg-card p-2 shadow-sm focus-within:ring-2 focus-within:ring-purple-500">
                                    <textarea value={aiChatInput} onChange={(event) => setAiChatInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleAiChat(); } }} rows={3} placeholder="수정 요청을 입력하세요" className="w-full resize-none border-0 px-2 py-1 text-sm outline-none" />
                                    <div className="flex items-center justify-between px-1">
                                        <span className="text-xs text-muted-foreground">Enter 전송 · Shift+Enter 줄바꿈</span>
                                        {aiChatBusy ? <Button size="sm" variant="outline" onClick={handleCancelAiChat}>중지</Button> : <Button size="sm" onClick={handleAiChat} disabled={!aiChatInput.trim()}>보내기</Button>}
                                    </div>
                                </div>
                            </div>
                        )}
                        {rightTab === 'edit' && (<div className="overflow-auto">
                        {selectedSlide ? (
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-foreground mb-1">타입</label>
                                    <div className="text-sm text-muted-foreground bg-secondary px-3 py-2 rounded">
                                        {selectedSlide.type}
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-foreground mb-1">제목</label>
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
                                    <label className="block text-sm font-medium text-foreground mb-1">레이아웃</label>
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
                                    <label className="block text-sm font-medium text-foreground mb-1">노트</label>
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
                                        <label className="block text-sm font-medium text-foreground">차트 데이터</label>
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
                        ) : (
                            <p className="text-sm text-muted-foreground">슬라이드를 선택하면 속성을 편집할 수 있습니다.</p>
                        )}
                        </div>)}
                    </aside>
                    </> : !isFocusMode ? <div className="flex w-8 shrink-0 items-start justify-center border-l bg-card pt-3"><button type="button" aria-label="AI 패널 펼치기" title="AI 패널 펼치기" onClick={() => setIsRightPanelOpen(true)} className="flex h-8 w-7 items-center justify-center rounded text-muted-foreground hover:bg-secondary"><PanelRightOpen className="h-4 w-4" /></button></div> : null}

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
                        <div className="bg-card rounded-lg p-6 w-96 shadow-xl">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-medium">공유 링크</h3>
                                <button
                                    onClick={() => setShowShareDialog(false)}
                                    className="p-1 hover:bg-secondary rounded"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                            <p className="text-sm text-muted-foreground mb-4">
                                이 링크를 공유하면 누구나 프레젠테이션을 볼 수 있습니다.
                            </p>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={shareUrl}
                                    readOnly
                                    className="flex-1 px-3 py-2 border rounded-lg text-sm bg-secondary"
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
    scene: SlideScene | null;
    sceneError: boolean;
    previewUrl?: string | null;
    selectedObjectId: string | null;
    onSelectObject: (id: string | null) => void;
    onSelectionFormat: (format: SceneSelectionFormat | null) => void;
    onCommand: (command: SceneCommand) => void;
    /** Lets the toolbar (rendered outside this component) drive character-level
     *  formatting on whatever the canvas currently has selected. */
    sceneCanvasRef: React.RefObject<SceneCanvasHandle | null>;
    onNavigate: (direction: -1 | 1) => void;
}

function EditableSlidePreview({
    slide, scene, sceneError, previewUrl, selectedObjectId, onSelectObject, onSelectionFormat, onCommand, sceneCanvasRef, onNavigate,
}: EditableSlidePreviewProps) {
    const [startX, setStartX] = useState<number | null>(null);
    const startSlideSwipe = (event: React.PointerEvent) => setStartX(event.clientX);
    const endSlideSwipe = (event: React.PointerEvent) => {
        if (startX === null) return;
        const delta = event.clientX - startX;
        setStartX(null);
        if (Math.abs(delta) > 80) onNavigate(delta > 0 ? -1 : 1);
    };

    if (scene) {
        return (
            <div className="relative h-full w-full touch-pan-y" onPointerDown={startSlideSwipe} onPointerUp={endSlideSwipe}>
                <SceneCanvas
                    ref={sceneCanvasRef}
                    scene={scene}
                    selectedObjectId={selectedObjectId}
                    onSelectObject={onSelectObject}
                    onSelectionFormat={onSelectionFormat}
                    onCommand={onCommand}
                />
            </div>
        );
    }
    if (sceneError && previewUrl) {
        return <img src={previewUrl} alt={`${slide.title || '슬라이드'} 미리보기`} className="h-full w-full object-contain" />;
    }
    if (sceneError) {
        return <div className="flex h-full items-center justify-center bg-secondary text-sm text-muted-foreground">이 슬라이드는 편집할 수 없습니다. 미리보기만 표시됩니다.</div>;
    }
    return <div className="flex h-full items-center justify-center bg-secondary text-sm text-muted-foreground">불러오는 중…</div>;
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
                    <h1 className="text-4xl font-bold text-foreground mb-4">{heading}</h1>
                    {subheading && <p className="text-xl text-muted-foreground">{subheading}</p>}
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
                    <blockquote className="text-2xl italic text-foreground text-center max-w-2xl">
                        "{body || heading}"
                    </blockquote>
                </div>
            );

        case 'BULLET_LIST':
        case 'CONTENT':
        default:
            return (
                <div className="h-full p-8">
                    <h2 className="text-2xl font-bold text-foreground mb-6">{heading}</h2>
                    {body && <p className="text-muted-foreground mb-4">{body}</p>}
                    {bullets.length > 0 && (
                        <ul className="space-y-2">
                            {bullets.map((bullet: any, index: number) => (
                                <li key={index} className="flex items-start gap-2">
                                    <span className="text-purple-600 font-bold">•</span>
                                    <span className="text-foreground">{typeof bullet === 'string' ? bullet : bullet.text}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            );
    }
}
