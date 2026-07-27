/**
 * Geometry and style for the live slide canvas.
 *
 * The editor used to show a server-rendered PNG with transparent hit-boxes over
 * it, so every element's position had to be re-derived as a percentage of the
 * image (`/19.2`, `/10.8`) and its type approximated (`/5.4cqh`, `fontSize/4`
 * floored at 12px). That arithmetic is why editing looked nothing like the
 * slide. The canvas now renders the slide's own markup at its own size and
 * scales the whole stage once, so nothing here converts units — it only decides
 * which properties an edit sets.
 */

/** The slide's own coordinate space. Template HTML is authored at this size. */
export const SLIDE_W = 1920;
export const SLIDE_H = 1080;

/**
 * Canvas pixels per point.
 *
 * The 1080px-tall stage covers a 7.5in slide, so it holds 144px per inch and a
 * point is two pixels — which is what the extractor writes into the markup. CSS
 * `pt` is not that: it is an absolute 1/72in, or 1.333px at 96dpi. Emitting the
 * point value as `pt` drew a 22pt title at 29px against the deck's own 44px,
 * and asking for a bigger size made the text smaller.
 */
export const CANVAS_PX_PER_PT = 2;

export interface ObjectEdit {
    objectId: string;
    text?: string;
    cells?: string[][];
    left?: number;
    top?: number;
    width?: number;
    height?: number;
    color?: string;
    fontSize?: number;
    fontFamily?: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    align?: string;
    fillColor?: string;
    lineColor?: string;
    lineWidth?: number;
    rotation?: number;
    delete?: boolean;
}

/** How much the 1920-wide stage is shrunk to fit its container. */
export function canvasScale(containerWidth: number): number {
    return containerWidth / SLIDE_W;
}

/**
 * A pointer delta in slide pixels.
 *
 * The stage is scaled as a whole, so this is the only place the conversion
 * happens. A container measured before layout reports zero width; treat that as
 * unscaled rather than dividing by it.
 */
export function toSlidePx(clientDelta: number, scale: number): number {
    return scale ? clientDelta / scale : clientDelta;
}

/**
 * Inline CSS for the object's box: where it sits and how it is painted.
 *
 * Booleans and zero are real values — a zero line width must emit a 0px border
 * — so every check tests the type rather than truthiness.
 */
export function objectEditBoxStyle(edit: ObjectEdit): Record<string, string> {
    const style: Record<string, string> = {};
    for (const key of ['left', 'top', 'width', 'height'] as const) {
        const value = edit[key];
        if (typeof value === 'number') style[key] = `${value}px`;
    }
    if (edit.fillColor) style.background = edit.fillColor;
    if (edit.lineColor) {
        style.borderColor = edit.lineColor;
        style.borderStyle = 'solid';
    }
    if (typeof edit.lineWidth === 'number') {
        style.borderWidth = `${edit.lineWidth}px`;
        style.borderStyle = 'solid';
    }
    if (typeof edit.rotation === 'number') style.transform = `rotate(${edit.rotation}deg)`;
    return style;
}

/**
 * Inline CSS for the object's text runs.
 *
 * Separate from the box because the deck states its type on the runs, not the
 * container: an extracted slide carries `<span style="font-size:44px">` inside
 * the object, and that beats anything set on the object itself. Styling only
 * the container looked like nothing happened when the size or colour changed.
 * python-pptx writes to `run.font` on export for the same reason.
 *
 * Sizes stay in points: the stage is scaled as a whole, so 13pt lands at 13pt.
 */
export function objectEditTextStyle(edit: ObjectEdit): Record<string, string> {
    const style: Record<string, string> = {};
    if (typeof edit.fontSize === 'number') style.fontSize = `${edit.fontSize * CANVAS_PX_PER_PT}px`;
    if (edit.fontFamily) style.fontFamily = edit.fontFamily;
    if (edit.color) style.color = edit.color;
    if (typeof edit.bold === 'boolean') style.fontWeight = edit.bold ? '700' : '400';
    if (typeof edit.italic === 'boolean') style.fontStyle = edit.italic ? 'italic' : 'normal';
    if (typeof edit.underline === 'boolean') style.textDecoration = edit.underline ? 'underline' : 'none';
    return style;
}

/** Alignment is a paragraph property, so it lands on the blocks, not the runs. */
export function objectEditAlign(edit: ObjectEdit): string | null {
    return edit.align ?? null;
}

/** The text an edit writes, or null when it changes no text. */
export function objectEditText(edit: ObjectEdit): string | null {
    return typeof edit.text === 'string' ? edit.text : null;
}
