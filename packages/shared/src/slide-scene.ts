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
    stroke: string;
    strokeWidth: number;
    startArrow?: boolean;
    endArrow?: boolean;
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
