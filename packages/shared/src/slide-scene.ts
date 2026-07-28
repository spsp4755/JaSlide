/**
 * The canonical, template-agnostic slide object model.
 *
 * A PPTX deck and an uploaded HTML/ZIP template used to be edited by two
 * unrelated engines — a live DOM canvas keyed by objectId for PPTX, a
 * contentEditable iframe mutating a stored HTML string for ZIP — sharing no
 * types and no code. `SlideScene` is the one shape both importers produce and
 * both the editor and the exporters consume, so an object's geometry, text
 * runs and table cells mean the same thing regardless of where the template
 * came from.
 */

/** One run of uniformly-formatted text within a paragraph. */
export interface TextRun {
    text: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    color?: string;
    /** Points, as the source format and its exporters state it — not device px. */
    fontSize?: number;
    fontFamily?: string;
}

/** One paragraph: a line the deck's own bullet/indent rules apply to. */
export interface TextParagraph {
    runs: TextRun[];
    level?: number;
    align?: 'left' | 'center' | 'right' | 'justify';
    bulleted?: boolean;
}

export interface BorderSide {
    width: number;
    color: string;
}

export interface TableCell {
    paragraphs: TextParagraph[];
    fill?: string;
    border?: {
        top?: BorderSide;
        right?: BorderSide;
        bottom?: BorderSide;
        left?: BorderSide;
    };
}

/**
 * Where an object came from in its source file.
 *
 * Round-tripping an edit means finding this same shape again: a PPTX shape by
 * its numeric id, an HTML node by the selector and original CSS the importer
 * recorded when it read the template.
 */
export type SourceRef =
    | { kind: 'pptx-shape'; shapeId: string }
    | { kind: 'html-node'; selector: string; originalCss?: string };

interface BaseObject {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
    sourceRef?: SourceRef;
}

export interface TextObject extends BaseObject {
    type: 'text';
    paragraphs: TextParagraph[];
}

export interface TableObject extends BaseObject {
    type: 'table';
    rowHeights: number[];
    columnWidths: number[];
    cells: TableCell[][];
}

export interface ShapeObject extends BaseObject {
    type: 'shape';
    /** e.g. 'rect', 'ellipse', 'triangle' — the same vocabulary the shape picker uses. */
    shape: string;
    fill: string;
    stroke: string;
    strokeWidth: number;
}

export interface LineObject extends BaseObject {
    type: 'line';
    /**
     * One of the insert picker's line kinds (`straightLine`, `arrowLine`, …).
     * Reusing that vocabulary — rather than separate stroke-style booleans —
     * means the scene canvas and the insert picker draw the exact same glyph
     * for the exact same string instead of two rendering paths that could drift.
     */
    lineStyle: string;
    stroke: string;
    strokeWidth: number;
}

export interface ImageObject extends BaseObject {
    type: 'image';
    /** A data: URI for a freshly inserted image, or a storage key for one already saved. */
    src: string;
}

export type SlideObject = TextObject | TableObject | ShapeObject | LineObject | ImageObject;

export interface SlideScene {
    width: number;
    height: number;
    objects: SlideObject[];
}

export interface SceneCommand {
    objectId: string;
    patch: Partial<SlideObject>;
}

/**
 * Apply one command to a scene, returning a new scene. Never mutates the one
 * it was given — every caller (undo/redo, the debounced save, a test) can keep
 * a reference to the scene before the command without it changing under them.
 */
export function applySceneCommand(scene: SlideScene, command: SceneCommand): SlideScene {
    const index = scene.objects.findIndex((object) => object.id === command.objectId);
    if (index < 0) {
        throw new Error(`Scene command targets object "${command.objectId}", which is not in this scene`);
    }

    const nextId = command.patch.id;
    if (typeof nextId === 'string' && nextId !== command.objectId
        && scene.objects.some((object) => object.id === nextId)) {
        throw new Error(`Scene command would give object "${command.objectId}" the already-used id "${nextId}"`);
    }

    const next = { ...scene.objects[index], ...command.patch } as SlideObject;
    if (typeof next.width === 'number' && next.width < 1) {
        throw new Error(`Scene command would shrink object "${command.objectId}" to a width below 1`);
    }
    if (typeof next.height === 'number' && next.height < 1) {
        throw new Error(`Scene command would shrink object "${command.objectId}" to a height below 1`);
    }

    const objects = [...scene.objects];
    objects[index] = next;
    return { ...scene, objects };
}

/** A half-open character range: `[start, end)` within a paragraph's plain text. */
export interface RunRange {
    start: number;
    end: number;
}

/**
 * Apply a formatting patch to exactly the runs within a character range,
 * splitting a run at the range's boundaries when the range starts or ends
 * partway through it. The pure core behind "select a word, hit bold" — no DOM,
 * no browser Selection/Range, no `surroundContents` quirks: given the same
 * three inputs, the same array comes out every time, which is what makes the
 * browser-driven editing path in scene-canvas.tsx checkable in isolation.
 *
 * Runs outside `[start, end)` are returned as-is (same reference, even) so a
 * caller can tell what changed with a shallow comparison.
 */
export function formatRuns(runs: TextRun[], range: RunRange, patch: Partial<TextRun>): TextRun[] {
    if (range.end <= range.start) return runs;
    const result: TextRun[] = [];
    let cursor = 0;
    for (const run of runs) {
        const runStart = cursor;
        const runEnd = cursor + run.text.length;
        cursor = runEnd;

        const overlapStart = Math.max(runStart, range.start);
        const overlapEnd = Math.min(runEnd, range.end);
        if (overlapStart >= overlapEnd) {
            result.push(run);
            continue;
        }

        const before = run.text.slice(0, overlapStart - runStart);
        const middle = run.text.slice(overlapStart - runStart, overlapEnd - runStart);
        const after = run.text.slice(overlapEnd - runStart);
        if (before) result.push({ ...run, text: before });
        result.push({ ...run, ...patch, text: middle });
        if (after) result.push({ ...run, text: after });
    }
    return result;
}

/** Toggle a paragraph's bullet marker on or off. */
export function toggleBullet(paragraph: TextParagraph): TextParagraph {
    return { ...paragraph, bulleted: !paragraph.bulleted };
}

/** Move a paragraph's indent level by `delta`, never below 0. */
export function setParagraphLevel(paragraph: TextParagraph, delta: number): TextParagraph {
    return { ...paragraph, level: Math.max(0, (paragraph.level ?? 0) + delta) };
}
