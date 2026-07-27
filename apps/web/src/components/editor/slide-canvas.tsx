'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { RESIZE_HANDLES, resizeBox, snapBox, type ResizeHandle } from '@/lib/object-transform';
import {
    CANVAS_PX_PER_PT, SLIDE_H, SLIDE_W, canvasScale, objectEditAlign, objectEditBoxStyle, objectEditText, objectEditTextStyle,
    textRunStyle, toSlidePx, type ObjectEdit, type TableCellContent, type TextParagraph, type TextRun,
} from '@/lib/slide-canvas';

/** Character-level formatting `formatSelection` can apply — never `align` or
 *  `fillColor`, which are paragraph- or object-level and never per-character. */
export interface RunFormatUpdate {
    fontFamily?: string;
    fontSize?: number;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    color?: string;
}

/** Imperative surface the toolbar drives for formatting a live text selection. */
export interface SlideCanvasHandle {
    /**
     * Format the browser's current text selection, if there is one inside this
     * canvas. Returns false when there is no such selection, so the caller
     * falls back to whole-object formatting — exactly how a real slide editor
     * behaves: format the highlighted range if there is one, the whole object
     * otherwise.
     */
    formatSelection: (updates: RunFormatUpdate) => boolean;
}

/** What the toolbar shows for whatever is selected on the slide. */
export interface SlideSelectionFormat {
    objectId: string;
    objectType: string;
    fontFamily: string;
    /** Points, the unit a deck states and the object map stores. */
    fontSize: number;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    color: string;
    align: string;
    fillColor: string;
}

interface SlideCanvasProps {
    /** The slide's own markup, at 1920x1080. */
    baseHtml: string;
    objectEdits: ObjectEdit[];
    selectedObjectId: string | null;
    onSelectObject: (id: string | null) => void;
    onSelectionFormat: (format: SlideSelectionFormat | null) => void;
    onChangeParagraphs: (objectId: string, paragraphs: TextParagraph[]) => void;
    onChangeCells: (objectId: string, cells: (string | TableCellContent)[][]) => void;
    onTransform: (objectId: string, box: Partial<Record<'left' | 'top' | 'width' | 'height', number>>) => void;
}

/** A computed colour as `#RRGGBB`, so it can seed a colour input. */
function toHex(value: string): string {
    const parts = value.match(/\d+/g);
    if (!parts || parts.length < 3) return '#000000';
    return '#' + parts.slice(0, 3).map((part) => Number(part).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * How the selected object is currently formatted.
 *
 * Read off the rendered element rather than the edit list: an object the user
 * has not touched yet has no edit, and the toolbar still has to show the
 * deck's own font and size rather than a made-up default.
 */
function readFormat(element: HTMLElement): SlideSelectionFormat {
    const run = element.querySelector('span') ?? element;
    const runStyle = getComputedStyle(run);
    const boxStyle = getComputedStyle(element);
    return {
        objectId: element.dataset.objectId ?? '',
        objectType: element.dataset.objectType ?? 'textbox',
        fontFamily: runStyle.fontFamily.split(',')[0].replace(/['"]/g, '').trim(),
        // The extractor writes points at CANVAS_PX_PER_PT each; the object map and
        // python-pptx both want the point value back.
        fontSize: Math.max(1, Math.round(parseFloat(runStyle.fontSize) / CANVAS_PX_PER_PT)),
        bold: Number(runStyle.fontWeight) >= 600,
        italic: runStyle.fontStyle === 'italic',
        underline: runStyle.textDecorationLine.includes('underline'),
        color: toHex(runStyle.color),
        align: boxStyle.textAlign === 'start' ? 'left' : boxStyle.textAlign,
        fillColor: toHex(boxStyle.backgroundColor),
    };
}

interface Box { left: number; top: number; width: number; height: number }

/**
 * Locate the element an edit belongs to.
 *
 * A PPTX-derived slide carries `data-object-id` on every object. A ZIP deck
 * authored outside JaSlide may not, and position in the object list is the only
 * key those slides ever had — the same key the HTML editing path already uses.
 */
function findObject(stage: HTMLElement, objectId: string, index: number): HTMLElement | null {
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(objectId) : objectId;
    return stage.querySelector<HTMLElement>(`[data-object-id="${escaped}"]`)
        ?? stage.querySelectorAll<HTMLElement>('[data-object="true"]')[index]
        ?? null;
}

/** The container that actually holds an object's text, skipping its wrapper. */
function textHost(element: HTMLElement): HTMLElement {
    return element.tagName === 'TD' || element.tagName === 'TH' ? element : element;
}

/**
 * Write plain text into an object, keeping the deck's own type.
 *
 * The first run's style is cloned onto a single span, deliberately mirroring
 * what `shape.text = ...` does on export: python-pptx collapses a text frame to
 * one run, so showing the original mixed runs here would promise formatting the
 * exported file will not have. Newlines become sibling blocks, which is how the
 * extractor writes paragraphs.
 */
function writeText(element: HTMLElement, text: string): void {
    const host = textHost(element);
    const runStyle = host.querySelector('span')?.getAttribute('style') ?? '';
    const blockStyle = host.querySelector('div')?.getAttribute('style') ?? '';
    host.replaceChildren(...text.split('\n').map((line) => {
        const block = element.ownerDocument.createElement('div');
        if (blockStyle) block.setAttribute('style', blockStyle);
        const run = element.ownerDocument.createElement('span');
        if (runStyle) run.setAttribute('style', runStyle);
        run.textContent = line;
        block.appendChild(run);
        return block;
    }));
}

/** A text object's paragraph blocks — its `<div>`/`<p>` children, or itself
 *  when it has none (a freshly inserted, still-empty text box). */
function paragraphBlocks(host: HTMLElement): HTMLElement[] {
    const blocks = Array.from(host.children).filter(
        (child): child is HTMLElement => child.tagName === 'DIV' || child.tagName === 'P');
    return blocks.length ? blocks : [host];
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
 * a run the user has not touched carries the deck's own style on its computed
 * style, not in an edit anywhere. `getComputedStyle` resolves the full
 * cascade, so a property set on an ancestor several levels up (nested
 * surroundContents spans, say) still reads correctly here.
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

/**
 * Serialize a text object's current DOM into paragraphs and runs.
 *
 * Called after every keystroke and every formatting change, so `edit.paragraphs`
 * always mirrors what is on screen — there is no separate "commit" step.
 */
function readParagraphs(host: HTMLElement): TextParagraph[] {
    return paragraphBlocks(host).map((block) => {
        const runs = textNodesIn(block).map(readRun).filter((run) => run.text.length > 0);
        return {
            text: runs.map((run) => run.text).join(''),
            runs: runs.length ? runs : [{ text: '' }],
            align: block.style.textAlign || undefined,
        };
    });
}

/** Rebuild a text object's blocks and runs from stored paragraphs. */
function writeParagraphs(host: HTMLElement, paragraphs: TextParagraph[]): void {
    const blockStyle = host.querySelector('div')?.getAttribute('style') ?? '';
    host.replaceChildren(...paragraphs.map((paragraph) => {
        const block = host.ownerDocument.createElement('div');
        if (blockStyle) block.setAttribute('style', blockStyle);
        if (paragraph.align) block.style.textAlign = paragraph.align;
        paragraph.runs.forEach((run) => {
            const span = host.ownerDocument.createElement('span');
            Object.assign(span.style, textRunStyle(run));
            span.textContent = run.text;
            block.appendChild(span);
        });
        return block;
    }));
}

/** Fill a table object's cells, left to right, top to bottom. */
function writeCells(element: HTMLElement, cells: (string | TableCellContent)[][]): void {
    const rows = element.querySelectorAll('tr');
    cells.forEach((row, rowIndex) => {
        const cellNodes = rows[rowIndex]?.querySelectorAll<HTMLElement>('td, th');
        row.forEach((value, columnIndex) => {
            const cell = cellNodes?.[columnIndex];
            if (!cell) return;
            if (typeof value === 'string') writeText(cell, value);
            else if (value?.paragraphs) writeParagraphs(cell, value.paragraphs);
        });
    });
}

/** Read a table object back out of the DOM after a cell was edited in place. */
function readCells(element: HTMLElement): TableCellContent[][] {
    return Array.from(element.querySelectorAll('tr')).map((row) =>
        Array.from(row.querySelectorAll<HTMLElement>('td, th')).map((cell) => ({ paragraphs: readParagraphs(cell) })));
}

/**
 * The slide, rendered by the browser and edited in place.
 *
 * The editor used to show a server-rendered PNG with transparent hit-boxes over
 * it and open an opaque textarea to edit text — so the slide's background, cell
 * fills and borders vanished the moment you typed, and the text was drawn in an
 * approximated font at an approximated size. Rendering the slide's own markup
 * removes the whole problem: there is nothing underneath to cover up, and the
 * type is the deck's own.
 */
export const SlideCanvas = forwardRef<SlideCanvasHandle, SlideCanvasProps>(function SlideCanvas({
    baseHtml, objectEdits, selectedObjectId,
    onSelectObject, onSelectionFormat, onChangeParagraphs, onChangeCells, onTransform,
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

    // Write the slide and reapply every edit over a clean copy of it, so removing
    // an edit reverts it. Skipped while a caret is in the slide: that element
    // already holds the user's text, and resetting the markup would drop the
    // selection mid-word.
    //
    // This effect is the only writer of the stage's markup. Handing React the
    // same job through dangerouslySetInnerHTML gave the node two owners, and
    // React's copy — the template with none of the edits applied — is the one
    // that survived. Layout effect, so the slide is populated before paint.
    useLayoutEffect(() => {
        const stage = stageRef.current;
        if (!stage) return;
        if (editingRef.current) return;
        stage.innerHTML = baseHtml;
        objectEdits.forEach((edit, index) => {
            const element = findObject(stage, edit.objectId, index);
            if (!element) return;
            if (edit.delete) { element.style.display = 'none'; return; }
            Object.assign(element.style, objectEditBoxStyle(edit));
            if (edit.cells) {
                writeCells(element, edit.cells);
            } else if (edit.paragraphs) {
                // Character-level formatting takes priority over flat text — see
                // ObjectEdit.paragraphs. A later whole-object fontSize/bold/align
                // below still overrides every run uniformly: selecting the whole
                // object and clicking bold is meant to win over per-run history,
                // the same as in a real slide editor.
                writeParagraphs(element, edit.paragraphs);
            } else {
                const text = objectEditText(edit);
                if (text !== null) writeText(element, text);
            }

            // After the text is written, so a rewritten run keeps the edit's
            // formatting rather than the template run's it was cloned from.
            const textStyle = objectEditTextStyle(edit);
            if (Object.keys(textStyle).length) {
                const runs = element.querySelectorAll<HTMLElement>('span');
                (runs.length ? Array.from(runs) : [element]).forEach((run) => Object.assign(run.style, textStyle));
            }
            const align = objectEditAlign(edit);
            if (align) {
                element.style.textAlign = align;
                element.querySelectorAll<HTMLElement>('div, p, td, th').forEach((block) => { block.style.textAlign = align; });
            }
        });
    }, [baseHtml, objectEdits]);

    // Track the selected object's real rendered box so the outline and handles
    // sit on the element itself rather than on a parallel copy of its geometry.
    useEffect(() => {
        const stage = stageRef.current;
        if (!stage || !selectedObjectId) { setSelectedBox(null); onSelectionFormat(null); return; }
        const index = objectEdits.findIndex((edit) => edit.objectId === selectedObjectId);
        const element = findObject(stage, selectedObjectId, index);
        setSelectedBox(element
            ? { left: element.offsetLeft, top: element.offsetTop, width: element.offsetWidth, height: element.offsetHeight }
            : null);
        onSelectionFormat(element ? readFormat(element) : null);
    }, [selectedObjectId, objectEdits, baseHtml, scale, onSelectionFormat]);

    const stopEditing = useCallback(() => {
        const element = editingRef.current;
        if (!element) return;
        element.removeAttribute('contentEditable');
        element.blur();
        editingRef.current = null;
        savedRangeRef.current = null;
        // Dropping contentEditable does not drop the highlight. Leaving it meant a
        // drag-selection stayed lit across the slide until the next keystroke
        // happened to replace it.
        window.getSelection()?.removeAllRanges();
    }, []);

    const beginEditing = useCallback((element: HTMLElement, objectId: string) => {
        stopEditing();
        editingRef.current = element;
        element.contentEditable = 'true';
        element.focus();

        const onInput = () => {
            const owner = element.closest<HTMLElement>('[data-object-id], [data-object="true"]') ?? element;
            if (element.tagName === 'TD' || element.tagName === 'TH') {
                onChangeCells(objectId, readCells(owner));
            } else {
                // Every keystroke re-serializes the whole object, not just this
                // line, so a bolded run made earlier survives continued typing
                // instead of being flattened back to one run per line.
                onChangeParagraphs(objectId, readParagraphs(owner));
            }
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { event.preventDefault(); element.blur(); }
        };
        const onSelectionChange = () => {
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0) return;
            const range = selection.getRangeAt(0);
            if (!element.contains(range.commonAncestorContainer)) return;
            savedRangeRef.current = selection.isCollapsed ? null : range.cloneRange();
        };
        const onBlur = () => {
            element.removeEventListener('input', onInput);
            element.removeEventListener('keydown', onKeyDown);
            element.removeEventListener('blur', onBlur);
            document.removeEventListener('selectionchange', onSelectionChange);
            // Toolbar controls take focus too. Keep this live element and its
            // saved range until the user clicks back onto the canvas, otherwise
            // a size/font click falls through to whole-object formatting.
            element.removeAttribute('contentEditable');
        };
        element.addEventListener('input', onInput);
        element.addEventListener('keydown', onKeyDown);
        element.addEventListener('blur', onBlur);
        document.addEventListener('selectionchange', onSelectionChange);
    }, [onChangeCells, onChangeParagraphs, stopEditing]);

    // Character-level formatting: wraps the live browser selection in a styled
    // span, the same technique the ZIP HTML editor already uses
    // (range.surroundContents), so "select a word, hit bold" bolds that word
    // instead of the whole object. Table cells opt out — a cell's stored shape
    // is flat text, not paragraphs, so formatting stays whole-cell there.
    const formatSelection = useCallback((updates: RunFormatUpdate): boolean => {
        const element = editingRef.current;
        if (!element) return false;
        const selection = window.getSelection();
        const liveRange = selection && !selection.isCollapsed && selection.rangeCount > 0 && element.contains(selection.getRangeAt(0).commonAncestorContainer)
            ? selection.getRangeAt(0)
            : null;
        const range = liveRange ?? savedRangeRef.current;
        if (!selection || !range || !element.contains(range.commonAncestorContainer)) return false;
        selection.removeAllRanges();
        selection.addRange(range);

        const style = textRunStyle(updates as TextRun);
        const span = element.ownerDocument.createElement('span');
        Object.assign(span.style, style);
        try {
            range.surroundContents(span);
        } catch {
            // The range crosses more than one element (spans two runs, say);
            // surroundContents refuses that. Move the content into the span by
            // hand instead of giving up on the format.
            const fragment = range.extractContents();
            span.appendChild(fragment);
            range.insertNode(span);
        }
        const restored = element.ownerDocument.createRange();
        restored.selectNodeContents(span);
        selection.removeAllRanges();
        selection.addRange(restored);
        savedRangeRef.current = restored.cloneRange();

        const owner = element.closest<HTMLElement>('[data-object-id], [data-object="true"]') ?? element;
        const objectId = owner.dataset.objectId;
        if (objectId) {
            if (element.tagName === 'TD' || element.tagName === 'TH') onChangeCells(objectId, readCells(owner));
            else onChangeParagraphs(objectId, readParagraphs(owner));
        }
        return true;
    }, [onChangeCells, onChangeParagraphs]);

    useImperativeHandle(ref, () => ({ formatSelection }), [formatSelection]);

    const startDrag = useCallback((event: React.PointerEvent, handle: ResizeHandle | null) => {
        const stage = stageRef.current;
        if (!stage || !selectedObjectId) return;
        event.stopPropagation();
        // Let a second click become a native dblclick before a real drag starts.
        if (handle) event.preventDefault();
        const index = objectEdits.findIndex((edit) => edit.objectId === selectedObjectId);
        const element = findObject(stage, selectedObjectId, index);
        if (!element) return;

        const initial: Box = {
            left: element.offsetLeft, top: element.offsetTop,
            width: element.offsetWidth, height: element.offsetHeight,
        };
        const neighbours = Array.from(stage.querySelectorAll<HTMLElement>('[data-object="true"]'))
            .filter((item) => item !== element)
            .map((item) => ({ left: item.offsetLeft, top: item.offsetTop, width: item.offsetWidth, height: item.offsetHeight }));
        const startX = event.clientX;
        const startY = event.clientY;
        let dragging = Boolean(handle);

        const move = (moveEvent: PointerEvent) => {
            const dx = toSlidePx(moveEvent.clientX - startX, scaleRef.current);
            const dy = toSlidePx(moveEvent.clientY - startY, scaleRef.current);
            if (!dragging && Math.hypot(dx, dy) < 4) return;
            if (!dragging) {
                dragging = true;
                window.getSelection()?.removeAllRanges();
            }
            if (handle) {
                setSnapGuides(null);
                const box = resizeBox(initial, handle, dx, dy);
                Object.assign(element.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
                setSelectedBox(box);
                onTransform(selectedObjectId, box);
                return;
            }
            const snapped = snapBox({ ...initial, left: initial.left + dx, top: initial.top + dy }, neighbours);
            setSnapGuides(snapped.guides.vertical.length || snapped.guides.horizontal.length ? snapped.guides : null);
            Object.assign(element.style, { left: `${snapped.box.left}px`, top: `${snapped.box.top}px` });
            setSelectedBox({ ...initial, left: snapped.box.left, top: snapped.box.top });
            onTransform(selectedObjectId, { left: snapped.box.left, top: snapped.box.top });
        };
        const stop = () => {
            setSnapGuides(null);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', stop);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop, { once: true });
    }, [objectEdits, onTransform, selectedObjectId]);

    const onStagePointerDown = (event: React.PointerEvent) => {
        const target = event.target as HTMLElement;
        // A caret is in this element: let the pointer select text rather than
        // dragging the object out from under it.
        if (editingRef.current?.isContentEditable && editingRef.current.contains(target)) return;
        // Anywhere else ends editing, without waiting for a blur that a
        // pointerdown on another element does not always deliver.
        stopEditing();
        const object = target.closest<HTMLElement>('[data-object-id], [data-object="true"]');
        if (!object) { onSelectObject(null); return; }
        const id = object.dataset.objectId;
        onSelectObject(id ?? null);
        if (id === selectedObjectId) startDrag(event, null);
    };

    // Escape steps back out: first out of the text, then out of the selection —
    // the way it does in a slide editor.
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
        const object = target.closest<HTMLElement>('[data-object-id], [data-object="true"]');
        if (!object || object.dataset.objectType === 'image') return;
        event.preventDefault();
        event.stopPropagation();
        const id = object.dataset.objectId;
        if (!id) return;
        onSelectObject(id);
        // A table is edited cell by cell, the way it is in a deck.
        beginEditing(target.closest<HTMLElement>('td, th') ?? object, id);
    };

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
            />
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
                    {RESIZE_HANDLES.map(({ handle, label, cursor, position }) => (
                        <button
                            key={handle}
                            type="button"
                            aria-label={`크기 조절 ${label}`}
                            className={`pointer-events-auto absolute ${position} ${cursor} h-3 w-3 rounded-sm border border-purple-700 bg-background`}
                            onPointerDown={(event) => startDrag(event, handle)}
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
