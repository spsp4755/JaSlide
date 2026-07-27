'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { RESIZE_HANDLES, resizeBox, snapBox, type ResizeHandle } from '@/lib/object-transform';
import {
    CANVAS_PX_PER_PT, SLIDE_H, SLIDE_W, canvasScale, objectEditAlign, objectEditBoxStyle, objectEditText, objectEditTextStyle, toSlidePx, type ObjectEdit,
} from '@/lib/slide-canvas';

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
    onChangeText: (objectId: string, text: string) => void;
    onChangeCells: (objectId: string, cells: string[][]) => void;
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

/** Fill a table object's cells, left to right, top to bottom. */
function writeCells(element: HTMLElement, cells: string[][]): void {
    const rows = element.querySelectorAll('tr');
    cells.forEach((row, rowIndex) => {
        const cellNodes = rows[rowIndex]?.querySelectorAll<HTMLElement>('td, th');
        row.forEach((value, columnIndex) => {
            const cell = cellNodes?.[columnIndex];
            if (cell) writeText(cell, value);
        });
    });
}

/** Read a table object back out of the DOM after a cell was edited in place. */
function readCells(element: HTMLElement): string[][] {
    return Array.from(element.querySelectorAll('tr')).map((row) =>
        Array.from(row.querySelectorAll<HTMLElement>('td, th')).map((cell) => cell.innerText.replace(/\n+$/, '')));
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
export function SlideCanvas({
    baseHtml, objectEdits, selectedObjectId,
    onSelectObject, onSelectionFormat, onChangeText, onChangeCells, onTransform,
}: SlideCanvasProps) {
    const frameRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(0);
    const [selectedBox, setSelectedBox] = useState<Box | null>(null);
    const [snapGuides, setSnapGuides] = useState<{ vertical: number[]; horizontal: number[] } | null>(null);
    const editingRef = useRef<HTMLElement | null>(null);
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
            if (edit.cells) writeCells(element, edit.cells);
            const text = objectEditText(edit);
            if (text !== null && !edit.cells) writeText(element, text);

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
            const owner = element.closest<HTMLElement>('[data-object-id], [data-object="true"]');
            if (element.tagName === 'TD' || element.tagName === 'TH') {
                if (owner) onChangeCells(objectId, readCells(owner));
            } else {
                onChangeText(objectId, element.innerText.replace(/\n+$/, ''));
            }
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { event.preventDefault(); element.blur(); }
        };
        const onBlur = () => {
            element.removeEventListener('input', onInput);
            element.removeEventListener('keydown', onKeyDown);
            element.removeEventListener('blur', onBlur);
            stopEditing();
        };
        element.addEventListener('input', onInput);
        element.addEventListener('keydown', onKeyDown);
        element.addEventListener('blur', onBlur);
    }, [onChangeCells, onChangeText, stopEditing]);

    const startDrag = useCallback((event: React.PointerEvent, handle: ResizeHandle | null) => {
        const stage = stageRef.current;
        if (!stage || !selectedObjectId) return;
        event.preventDefault();
        event.stopPropagation();
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

        const move = (moveEvent: PointerEvent) => {
            const dx = toSlidePx(moveEvent.clientX - startX, scaleRef.current);
            const dy = toSlidePx(moveEvent.clientY - startY, scaleRef.current);
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
        if (editingRef.current?.contains(target)) return;
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
}
