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
 * Inline CSS for one edit, in the deck's own units.
 *
 * Sizes stay in points because the stage is scaled as a whole: a 13pt caption
 * is written as 13pt and lands at 13pt of slide. Booleans and zero are real
 * values — unbolding must emit 400 and a zero line width must emit a 0px
 * border, so every check tests the type rather than truthiness.
 */
export function objectEditStyle(edit: ObjectEdit): Record<string, string> {
    const style: Record<string, string> = {};
    for (const key of ['left', 'top', 'width', 'height'] as const) {
        const value = edit[key];
        if (typeof value === 'number') style[key] = `${value}px`;
    }
    if (typeof edit.fontSize === 'number') style.fontSize = `${edit.fontSize}pt`;
    if (edit.fontFamily) style.fontFamily = edit.fontFamily;
    if (edit.color) style.color = edit.color;
    if (typeof edit.bold === 'boolean') style.fontWeight = edit.bold ? '700' : '400';
    if (typeof edit.italic === 'boolean') style.fontStyle = edit.italic ? 'italic' : 'normal';
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

/** The text an edit writes, or null when it changes no text. */
export function objectEditText(edit: ObjectEdit): string | null {
    return typeof edit.text === 'string' ? edit.text : null;
}
