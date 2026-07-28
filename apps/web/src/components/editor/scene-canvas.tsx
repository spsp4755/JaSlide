'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type {
    ImageObject, LineObject, ShapeObject, SlideObject, SlideScene, TableObject, TextObject, TextParagraph, TextRun,
} from '@jaslide/shared';
import { LINE_RESIZE_HANDLES, RESIZE_HANDLES, type ResizeHandle } from '@/lib/object-transform';
import { boxOf, moveCommand, resizeCommand, resizeFromHandle, snapAgainstNeighbours, type SceneCommand } from '@/lib/scene-commands';
import { shapeSvgMarkup } from '@/lib/shape-glyphs';
import { CANVAS_PX_PER_PT, SLIDE_H, SLIDE_W, canvasScale, textRunStyle, toSlidePx } from '@/lib/slide-canvas';

/** Character-level formatting `formatSelection` can apply — never alignment or
 *  fill, which are paragraph- or object-level and never per-character. */
export interface RunFormatUpdate {
    fontFamily?: string;
    fontSize?: number;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    color?: string;
}

/** Imperative surface the toolbar drives — a live text selection or an
 *  immediate colour repaint, both of which need the rendered DOM directly. */
export interface SceneCanvasHandle {
    /** Format the browser's current text selection, if there is one inside
     *  this canvas. False means "no such selection" — the caller then issues
     *  a whole-object command instead, exactly how a real slide editor
     *  behaves: format the highlighted range if there is one, the object
     *  otherwise. */
    formatSelection: (updates: RunFormatUpdate) => boolean;
    /** Paint a shape or line's colour immediately, while the command that
     *  persists it is still in flight. */
    paintColor: (objectId: string, property: 'fill' | 'stroke', color: string) => boolean;
}

/** What the toolbar shows for whatever is selected on the slide. */
export interface SceneSelectionFormat {
    objectId: string;
    objectType: SlideObject['type'];
    fontFamily: string;
    /** Points, the unit the scene model and its exporters state. */
    fontSize: number;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    color: string;
    align: string;
    fillColor: string;
}

interface SceneCanvasProps {
    scene: SlideScene;
    selectedObjectId: string | null;
    onSelectObject: (id: string | null) => void;
    onSelectionFormat: (format: SceneSelectionFormat | null) => void;
    onCommand: (command: SceneCommand) => void;
}

interface Box { left: number; top: number; width: number; height: number }

/** A computed colour as `#RRGGBB`, so it can seed a colour input. */
function toHex(value: string): string {
    const parts = value.match(/\d+/g);
    if (!parts || parts.length < 3) return '#000000';
    return '#' + parts.slice(0, 3).map((part) => Number(part).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function findObjectElement(stage: HTMLElement, objectId: string): HTMLElement | null {
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(objectId) : objectId;
    return stage.querySelector<HTMLElement>(`[data-object-id="${escaped}"]`);
}

/** The container that actually holds a run of text, skipping its wrapper. */
function textHost(element: HTMLElement): HTMLElement {
    return element;
}

/**
 * Every text node inside a block, in document order.
 *
 * `range.surroundContents` wraps a sub-selection in a span *nested inside* the
 * run it was part of, not as a sibling — formatting half of an existing run
 * produces `<span run><span bold>AI</span> 엔지니어링…</span>`, not two spans
 * side by side. Reading only direct span children of the block would see the
 * outer run and miss the nested one, silently losing the very edit just made.
 * Walking actual text nodes finds a run at any nesting depth.
 */
function textNodesIn(block: HTMLElement): Text[] {
    const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
    return nodes;
}

/**
 * One run's live formatting, read off the browser rather than stored state —
 * a run the user has not touched carries the scene's own style on its
 * computed style, not in a pending command anywhere. `getComputedStyle`
 * resolves the full cascade, so a property set on an ancestor several levels
 * up (a nested surroundContents span) still reads correctly here.
 */
function readRun(textNode: Text): TextRun {
    const text = textNode.textContent ?? '';
    const style = getComputedStyle(textNode.parentElement ?? (textNode.getRootNode() as HTMLElement));
    return {
        text,
        bold: Number(style.fontWeight) >= 600,
        italic: style.fontStyle === 'italic',
        underline: style.textDecorationLine.includes('underline'),
        color: toHex(style.color),
        fontSize: Math.max(1, Math.round(parseFloat(style.fontSize) / CANVAS_PX_PER_PT)),
        fontFamily: style.fontFamily.split(',')[0].replace(/['"]/g, '').trim(),
    };
}

/** A text object's paragraph blocks — its `<div>` children, or itself when it
 *  has none (a freshly inserted, still-empty text box). */
function paragraphBlocks(host: HTMLElement): HTMLElement[] {
    const blocks = Array.from(host.children).filter((child): child is HTMLElement => child.tagName === 'DIV');
    return blocks.length ? blocks : [host];
}

/**
 * Serialize a text host's current DOM into paragraphs and runs. The same
 * function reads a whole text object or a single table cell — both are just
 * "a container of paragraph blocks of run spans" once rendered.
 */
function readParagraphs(host: HTMLElement): TextParagraph[] {
    return paragraphBlocks(host).map((block) => ({
        runs: (() => {
            const runs = textNodesIn(block).map(readRun).filter((run) => run.text.length > 0);
            return runs.length ? runs : [{ text: '' }];
        })(),
        align: (block.style.textAlign || undefined) as TextParagraph['align'],
    }));
}

/** Rebuild a text host's blocks and runs from stored paragraphs. */
function writeParagraphs(host: HTMLElement, paragraphs: TextParagraph[]): void {
    host.replaceChildren(...paragraphs.map((paragraph) => {
        const block = host.ownerDocument.createElement('div');
        if (paragraph.align) block.style.textAlign = paragraph.align;
        if (paragraph.level) block.style.marginLeft = `${paragraph.level * 24}px`;
        paragraph.runs.forEach((run) => {
            const span = host.ownerDocument.createElement('span');
            Object.assign(span.style, textRunStyle(run));
            span.textContent = run.text;
            block.appendChild(span);
        });
        return block;
    }));
}

function caretRangeAt(element: HTMLElement, clientX: number, clientY: number): Range | null {
    const document = element.ownerDocument as Document & {
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const range = document.caretRangeFromPoint?.(clientX, clientY);
    return range && element.contains(range.startContainer) ? range : null;
}

/** Put the native selection on the word the user double-clicked. */
function selectWordAt(element: HTMLElement, clientX: number, clientY: number): void {
    const document = element.ownerDocument;
    const range = caretRangeAt(element, clientX, clientY);
    const selection = document.getSelection();
    if (!range || !selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
    const movable = selection as Selection & {
        modify?: (alter: 'move' | 'extend', direction: 'backward' | 'forward', granularity: 'word') => void;
    };
    movable.modify?.('move', 'backward', 'word');
    movable.modify?.('extend', 'forward', 'word');
}

/** Native text selection is unreliable inside the scaled slide, so own the range. */
function beginTextSelection(element: HTMLElement, event: React.PointerEvent): void {
    const anchor = caretRangeAt(element, event.clientX, event.clientY);
    const selection = element.ownerDocument.getSelection();
    const view = element.ownerDocument.defaultView;
    if (!anchor || !selection || !view) return;
    event.preventDefault();

    const selectTo = (focus: Range) => {
        const range = element.ownerDocument.createRange();
        if (anchor.compareBoundaryPoints(Range.START_TO_START, focus) <= 0) {
            range.setStart(anchor.startContainer, anchor.startOffset);
            range.setEnd(focus.startContainer, focus.startOffset);
        } else {
            range.setStart(focus.startContainer, focus.startOffset);
            range.setEnd(anchor.startContainer, anchor.startOffset);
        }
        selection.removeAllRanges();
        selection.addRange(range);
    };
    selectTo(anchor);

    const move = (moveEvent: PointerEvent) => {
        const focus = caretRangeAt(element, moveEvent.clientX, moveEvent.clientY);
        if (focus) selectTo(focus);
    };
    const stop = () => {
        view.removeEventListener('pointermove', move);
        view.removeEventListener('pointerup', stop);
    };
    view.addEventListener('pointermove', move);
    view.addEventListener('pointerup', stop, { once: true });
}

/** The run under the current native selection, when it belongs to this object. */
function selectionRun(element: HTMLElement): HTMLElement | undefined {
    const selection = element.ownerDocument.getSelection();
    const node = selection?.anchorNode;
    if (!node || !element.contains(node)) return;
    return (node instanceof HTMLElement ? node : node.parentElement)?.closest<HTMLElement>('span') ?? undefined;
}

/** How an object is currently formatted, read off the rendered element so an
 *  object nobody has edited yet still shows the scene's own font and size. */
function readFormat(object: SlideObject, element: HTMLElement, preferredRun?: HTMLElement): SceneSelectionFormat {
    const run = preferredRun ?? element.querySelector('span') ?? element;
    const runStyle = getComputedStyle(run);
    const boxStyle = getComputedStyle(element);
    return {
        objectId: object.id,
        objectType: object.type,
        fontFamily: runStyle.fontFamily.split(',')[0].replace(/['"]/g, '').trim(),
        fontSize: Math.max(1, Math.round(parseFloat(runStyle.fontSize) / CANVAS_PX_PER_PT)),
        bold: Number(runStyle.fontWeight) >= 600,
        italic: runStyle.fontStyle === 'italic',
        underline: runStyle.textDecorationLine.includes('underline'),
        color: toHex(runStyle.color),
        align: boxStyle.textAlign === 'start' ? 'left' : boxStyle.textAlign,
        fillColor: toHex(boxStyle.backgroundColor),
    };
}

function objectBoxStyle(object: SlideObject): Record<string, string> {
    const style: Record<string, string> = {
        position: 'absolute', left: `${object.x}px`, top: `${object.y}px`,
        width: `${object.width}px`, height: `${object.height}px`, boxSizing: 'border-box',
    };
    if (object.rotation) style.transform = `rotate(${object.rotation}deg)`;
    return style;
}

function TextRuns({ paragraphs }: { paragraphs: TextParagraph[] }) {
    return <>{paragraphs.map((paragraph, index) => (
        <div key={index} style={{ textAlign: paragraph.align, marginLeft: paragraph.level ? paragraph.level * 24 : undefined }}>
            {paragraph.runs.map((run, runIndex) => <span key={runIndex} style={textRunStyle(run)}>{run.text}</span>)}
        </div>
    ))}</>;
}

function TextObjectView({ object }: { object: TextObject }) {
    return <div data-object="true" data-object-id={object.id} data-object-type="text" style={objectBoxStyle(object)}>
        <TextRuns paragraphs={object.paragraphs} />
    </div>;
}

function TableObjectView({ object }: { object: TableObject }) {
    const rowTotal = object.rowHeights.reduce((sum, value) => sum + value, 0) || 1;
    const colTotal = object.columnWidths.reduce((sum, value) => sum + value, 0) || 1;
    return <div data-object="true" data-object-id={object.id} data-object-type="table" style={objectBoxStyle(object)}>
        <table style={{ width: '100%', height: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>{object.columnWidths.map((width, index) => <col key={index} style={{ width: `${(width / colTotal) * 100}%` }} />)}</colgroup>
            <tbody>
                {object.cells.map((row, rowIndex) => (
                    <tr key={rowIndex} style={{ height: `${(object.rowHeights[rowIndex] / rowTotal) * 100}%` }}>
                        {row.map((cell, colIndex) => (
                            <td key={colIndex} style={{ verticalAlign: 'top', border: '1px solid #D1D5DB', padding: 8, background: cell.fill }}>
                                <TextRuns paragraphs={cell.paragraphs} />
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    </div>;
}

function ShapeObjectView({ object }: { object: ShapeObject }) {
    return <div
        data-object="true" data-object-id={object.id} data-object-type="shape"
        style={objectBoxStyle(object)}
        dangerouslySetInnerHTML={{ __html: shapeSvgMarkup(object.shape, object.width, object.height, object.fill, object.stroke) }}
    />;
}

function LineObjectView({ object }: { object: LineObject }) {
    return <div
        data-object="true" data-object-id={object.id} data-object-type="line"
        style={objectBoxStyle(object)}
        dangerouslySetInnerHTML={{ __html: shapeSvgMarkup(object.lineStyle, object.width, object.height, 'none', object.stroke) }}
    />;
}

function ImageObjectView({ object }: { object: ImageObject }) {
    return object.src
        ? <img data-object="true" data-object-id={object.id} data-object-type="image" style={objectBoxStyle(object)} src={object.src} alt="" />
        : <div data-object="true" data-object-id={object.id} data-object-type="image" style={{ ...objectBoxStyle(object), background: '#E5E7EB' }} />;
}

/**
 * The slide, rendered by the browser from the canonical SlideScene and edited
 * in place. Every object type gets its own renderer so a shape's colour lands
 * on its SVG path and never on the wrapper — painting a wrapper's background
 * once turned an arrow into a colored rectangle (fixed in 6ca5d80).
 */
export const SceneCanvas = forwardRef<SceneCanvasHandle, SceneCanvasProps>(function SceneCanvas({
    scene, selectedObjectId, onSelectObject, onSelectionFormat, onCommand,
}, ref) {
    const frameRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(0);
    const [selectedBox, setSelectedBox] = useState<Box | null>(null);
    const [snapGuides, setSnapGuides] = useState<{ vertical: number[]; horizontal: number[] } | null>(null);
    const editingRef = useRef<HTMLElement | null>(null);
    const savedRangeRef = useRef<Range | null>(null);
    const scaleRef = useRef(0);
    scaleRef.current = scale;

    useLayoutEffect(() => {
        const frame = frameRef.current;
        if (!frame) return;
        const measure = () => setScale(canvasScale(frame.clientWidth));
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(frame);
        return () => observer.disconnect();
    }, []);

    // Track the selected object's rendered box so the outline and handles sit
    // on the element itself rather than a parallel copy of its geometry.
    useEffect(() => {
        const stage = stageRef.current;
        const object = scene.objects.find((item) => item.id === selectedObjectId);
        if (!stage || !object) { setSelectedBox(null); onSelectionFormat(null); return; }
        const element = findObjectElement(stage, object.id);
        setSelectedBox(element
            ? { left: element.offsetLeft, top: element.offsetTop, width: element.offsetWidth, height: element.offsetHeight }
            : null);
        onSelectionFormat(element ? readFormat(object, element, selectionRun(element)) : null);
    }, [selectedObjectId, scene, scale, onSelectionFormat]);

    const stopEditing = useCallback(() => {
        const element = editingRef.current;
        if (!element) return;
        editingRef.current = null;
        element.removeAttribute('contentEditable');
        element.blur();
        savedRangeRef.current = null;
        // Dropping contentEditable does not drop the highlight. Leaving it lit
        // a drag-selection across the slide until the next keystroke replaced it.
        window.getSelection()?.removeAllRanges();
    }, []);

    /** Read either a whole text object or one table cell back into a command. */
    const commitParagraphs = useCallback((element: HTMLElement, objectId: string) => {
        const object = scene.objects.find((item) => item.id === objectId);
        if (!object) return;
        if (object.type === 'table' && (element.tagName === 'TD' || element.tagName === 'TH')) {
            const table = findObjectElement(stageRef.current!, objectId);
            const cellNodes = table ? Array.from(table.querySelectorAll<HTMLElement>('td')) : [];
            const columns = object.columnWidths.length || 1;
            const cells = object.cells.map((row, rowIndex) => row.map((cell, colIndex) => {
                const node = cellNodes[rowIndex * columns + colIndex];
                return node ? { ...cell, paragraphs: readParagraphs(node) } : cell;
            }));
            onCommand({ objectId, patch: { cells } as Partial<SlideObject> });
        } else if (object.type === 'text') {
            onCommand({ objectId, patch: { paragraphs: readParagraphs(element) } as Partial<SlideObject> });
        }
    }, [scene, onCommand]);

    const beginEditing = useCallback((element: HTMLElement, objectId: string) => {
        stopEditing();
        editingRef.current = element;
        element.contentEditable = 'true';
        element.focus();

        const onInput = () => commitParagraphs(element, objectId);
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { event.preventDefault(); element.blur(); }
        };
        const onSelectionChange = () => {
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0) return;
            const range = selection.getRangeAt(0);
            if (!element.contains(range.commonAncestorContainer)) return;
            savedRangeRef.current = selection.isCollapsed ? null : range.cloneRange();
            const object = scene.objects.find((item) => item.id === objectId);
            if (object) onSelectionFormat(readFormat(object, textHost(element), selectionRun(element)));
        };
        const onBlur = () => {
            // A toolbar control temporarily takes focus without ending text edit
            // mode; Escape or selecting another object calls stopEditing explicitly.
            if (editingRef.current === element) return;
            element.removeEventListener('input', onInput);
            element.removeEventListener('keydown', onKeyDown);
            element.removeEventListener('blur', onBlur);
            document.removeEventListener('selectionchange', onSelectionChange);
            element.removeAttribute('contentEditable');
        };
        element.addEventListener('input', onInput);
        element.addEventListener('keydown', onKeyDown);
        element.addEventListener('blur', onBlur);
        document.addEventListener('selectionchange', onSelectionChange);
    }, [commitParagraphs, onSelectionFormat, scene, stopEditing]);

    // Character-level formatting: wraps the live browser selection in a styled
    // span, the same technique the legacy canvas and the ZIP HTML editor both
    // use (range.surroundContents), so "select a word, hit bold" bolds that
    // word instead of the whole object.
    const formatSelection = useCallback((updates: RunFormatUpdate): boolean => {
        const element = editingRef.current;
        if (!element) return false;
        const selection = window.getSelection();
        const liveRange = selection && !selection.isCollapsed && selection.rangeCount > 0
            && element.contains(selection.getRangeAt(0).commonAncestorContainer)
            ? selection.getRangeAt(0) : null;
        const range = liveRange ?? savedRangeRef.current;
        if (!selection || !range || !element.contains(range.commonAncestorContainer)) return false;
        selection.removeAllRanges();
        selection.addRange(range);

        const span = element.ownerDocument.createElement('span');
        Object.assign(span.style, textRunStyle(updates as TextRun));
        try {
            range.surroundContents(span);
        } catch {
            // The range crosses more than one element (spans two runs, say);
            // surroundContents refuses that. Move the content by hand instead
            // of giving up on the format.
            const fragment = range.extractContents();
            span.appendChild(fragment);
            range.insertNode(span);
        }
        const restored = element.ownerDocument.createRange();
        restored.selectNodeContents(span);
        selection.removeAllRanges();
        selection.addRange(restored);
        savedRangeRef.current = restored.cloneRange();

        const owner = element.closest<HTMLElement>('[data-object-id]');
        if (owner?.dataset.objectId) commitParagraphs(element, owner.dataset.objectId);
        return true;
    }, [commitParagraphs]);

    const paintColor = useCallback((objectId: string, property: 'fill' | 'stroke', color: string): boolean => {
        const stage = stageRef.current;
        const element = stage && findObjectElement(stage, objectId);
        if (!element) return false;
        const paths = element.querySelectorAll<SVGPathElement>('svg path');
        paths.forEach((path) => {
            if (property === 'fill' && path.getAttribute('fill') === 'none') return;
            path.setAttribute(property, color);
        });
        return paths.length > 0;
    }, []);

    useImperativeHandle(ref, () => ({ formatSelection, paintColor }), [formatSelection, paintColor]);

    const startDrag = useCallback((event: React.PointerEvent, objectId: string, handle: ResizeHandle | null) => {
        const object = scene.objects.find((item) => item.id === objectId);
        const element = stageRef.current && findObjectElement(stageRef.current, objectId);
        if (!object || !element) return;
        event.stopPropagation();
        if (handle) event.preventDefault();

        const initial = boxOf(object);
        const startX = event.clientX;
        const startY = event.clientY;
        let dragging = Boolean(handle);

        const move = (moveEvent: PointerEvent) => {
            const dx = toSlidePx(moveEvent.clientX - startX, scaleRef.current);
            const dy = toSlidePx(moveEvent.clientY - startY, scaleRef.current);
            if (!dragging && Math.hypot(dx, dy) < 4) return;
            if (!dragging) { dragging = true; window.getSelection()?.removeAllRanges(); }
            if (handle) {
                setSnapGuides(null);
                const box = resizeFromHandle(initial, handle, dx, dy, {
                    lockAspectRatio: moveEvent.shiftKey, fromCenter: moveEvent.ctrlKey || moveEvent.metaKey,
                });
                Object.assign(element.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
                setSelectedBox(box);
                onCommand(resizeCommand(objectId, box));
                return;
            }
            const snapped = snapAgainstNeighbours({ ...initial, left: initial.left + dx, top: initial.top + dy }, scene, objectId);
            setSnapGuides(snapped.guides.vertical.length || snapped.guides.horizontal.length ? snapped.guides : null);
            Object.assign(element.style, { left: `${snapped.box.left}px`, top: `${snapped.box.top}px` });
            setSelectedBox({ ...initial, left: snapped.box.left, top: snapped.box.top });
            onCommand(moveCommand(objectId, snapped.box));
        };
        const stop = () => {
            setSnapGuides(null);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', stop);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop, { once: true });
    }, [scene, onCommand]);

    const onStagePointerDown = (event: React.PointerEvent) => {
        const target = event.target as HTMLElement;
        if (editingRef.current?.getAttribute('contenteditable') === 'true' && editingRef.current.contains(target)) {
            beginTextSelection(editingRef.current, event);
            return;
        }
        stopEditing();
        const object = target.closest<HTMLElement>('[data-object-id]');
        if (!object) { onSelectObject(null); return; }
        const id = object.dataset.objectId;
        onSelectObject(id ?? null);
        if (id && id === selectedObjectId) startDrag(event, id, null);
    };

    // Escape steps back out: first out of the text, then out of the selection.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (editingRef.current) { stopEditing(); return; }
            if (selectedObjectId) onSelectObject(null);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onSelectObject, selectedObjectId, stopEditing]);

    const onStageDoubleClick = (event: React.MouseEvent) => {
        const target = event.target as HTMLElement;
        const object = target.closest<HTMLElement>('[data-object-id]');
        if (!object || object.dataset.objectType === 'image' || object.dataset.objectType === 'shape' || object.dataset.objectType === 'line') return;
        event.stopPropagation();
        const id = object.dataset.objectId;
        if (!id) return;
        onSelectObject(id);
        // A table is edited cell by cell, the way it is in a deck.
        const editTarget = target.closest<HTMLElement>('td, th') ?? object;
        beginEditing(editTarget, id);
        selectWordAt(editTarget, event.clientX, event.clientY);
    };

    const selectedObject = scene.objects.find((item) => item.id === selectedObjectId);

    return (
        <div ref={frameRef} className="relative h-full w-full overflow-hidden" style={{ aspectRatio: `${SLIDE_W} / ${SLIDE_H}` }}>
            <div
                ref={stageRef}
                data-slide-stage
                className="absolute left-0 top-0 origin-top-left"
                style={{
                    width: SLIDE_W, height: SLIDE_H,
                    transform: `scale(${scale})`, transformOrigin: 'top left',
                    visibility: scale ? 'visible' : 'hidden',
                }}
                onPointerDown={onStagePointerDown}
                onDoubleClick={onStageDoubleClick}
            >
                {scene.objects.map((object) => {
                    switch (object.type) {
                        case 'text': return <TextObjectView key={object.id} object={object} />;
                        case 'table': return <TableObjectView key={object.id} object={object} />;
                        case 'shape': return <ShapeObjectView key={object.id} object={object} />;
                        case 'line': return <LineObjectView key={object.id} object={object} />;
                        case 'image': return <ImageObjectView key={object.id} object={object} />;
                        default: return null;
                    }
                })}
            </div>
            {/* Overlay lives outside the stage but shares its scale, so handles stay
                a constant size on screen instead of growing with the slide. */}
            {selectedBox && scale > 0 && (
                <div
                    className="pointer-events-none absolute border-2 border-purple-500"
                    style={{
                        left: selectedBox.left * scale, top: selectedBox.top * scale,
                        width: selectedBox.width * scale, height: selectedBox.height * scale,
                    }}
                >
                    {(selectedObject?.type === 'line' ? LINE_RESIZE_HANDLES : RESIZE_HANDLES).map(({ handle, label, cursor, x, y }) => (
                        <button
                            key={handle}
                            type="button"
                            aria-label={`크기 조절 ${label}`}
                            className="pointer-events-auto absolute h-3 w-3 rounded-sm border border-purple-700 bg-background"
                            style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)', cursor }}
                            onPointerDown={(event) => selectedObjectId && startDrag(event, selectedObjectId, handle)}
                        />
                    ))}
                </div>
            )}
            {snapGuides?.vertical.map((x) => (
                <div key={`v${x}`} aria-hidden="true" className="pointer-events-none absolute top-0 h-full border-l border-dashed border-fuchsia-500" style={{ left: x * scale }} />
            ))}
            {snapGuides?.horizontal.map((y) => (
                <div key={`h${y}`} aria-hidden="true" className="pointer-events-none absolute left-0 w-full border-t border-dashed border-fuchsia-500" style={{ top: y * scale }} />
            ))}
        </div>
    );
});
