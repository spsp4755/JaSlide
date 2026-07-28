/**
 * Geometry for dragging an object's edges, shared by the PPTX overlay and the HTML
 * canvas. Both used to offer a single bottom-right handle, so an object could only
 * ever grow down and right — moving its top or left edge meant retyping numbers in
 * the side panel.
 *
 * Boxes are in the editor's 1920x1080 slide space.
 */
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface Box {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** Handle ring in visual order, with the cursor and corner offsets for each. */
export const RESIZE_HANDLES: readonly { handle: ResizeHandle; label: string; cursor: string; position: string; x: number; y: number }[] = [
    { handle: 'nw', label: '왼쪽 위', cursor: 'nwse-resize', position: '-top-1.5 -left-1.5', x: 0, y: 0 },
    { handle: 'n', label: '위', cursor: 'ns-resize', position: '-top-1.5 left-1/2 -translate-x-1/2', x: 50, y: 0 },
    { handle: 'ne', label: '오른쪽 위', cursor: 'nesw-resize', position: '-top-1.5 -right-1.5', x: 100, y: 0 },
    { handle: 'e', label: '오른쪽', cursor: 'ew-resize', position: 'top-1/2 -right-1.5 -translate-y-1/2', x: 100, y: 50 },
    { handle: 'se', label: '오른쪽 아래', cursor: 'nwse-resize', position: '-bottom-1.5 -right-1.5', x: 100, y: 100 },
    { handle: 's', label: '아래', cursor: 'ns-resize', position: '-bottom-1.5 left-1/2 -translate-x-1/2', x: 50, y: 100 },
    { handle: 'sw', label: '왼쪽 아래', cursor: 'nesw-resize', position: '-bottom-1.5 -left-1.5', x: 0, y: 100 },
    { handle: 'w', label: '왼쪽', cursor: 'ew-resize', position: 'top-1/2 -left-1.5 -translate-y-1/2', x: 0, y: 50 },
] as const;

/** Lines resize from their two ends, rather than as a rectangle with eight handles. */
export const LINE_RESIZE_HANDLES = RESIZE_HANDLES.filter(({ handle }) => handle === 'ne' || handle === 'sw');

export const MIN_WIDTH = 40;
export const MIN_HEIGHT = 24;

export interface ResizeOptions {
    /** Google Slides: Shift + resize keeps the object's original proportions. */
    lockAspectRatio?: boolean;
    /** Google Slides: Ctrl/⌘ + resize expands from the centre. */
    fromCenter?: boolean;
}

/**
 * Apply a pointer delta to the box, anchoring the edges the handle does not drag.
 * Dragging an edge past its opposite one stops at the minimum instead of inverting.
 */
export function resizeBox(box: Box, handle: ResizeHandle, dx: number, dy: number, options: ResizeOptions = {}): Box {
    const west = handle.includes('w');
    const east = handle.includes('e');
    const north = handle.startsWith('n');
    const south = handle.startsWith('s');
    const horizontal = west || east;
    const vertical = north || south;

    if (options.fromCenter) {
        dx *= 2;
        dy *= 2;
    }

    let { left, top, width, height } = box;

    if (east) {
        width = Math.max(MIN_WIDTH, box.width + dx);
    } else if (west) {
        // The right edge stays put, so left and width move together.
        width = Math.max(MIN_WIDTH, box.width - dx);
        left = box.left + box.width - width;
    }

    if (south) {
        height = Math.max(MIN_HEIGHT, box.height + dy);
    } else if (north) {
        height = Math.max(MIN_HEIGHT, box.height - dy);
        top = box.top + box.height - height;
    }

    if (options.lockAspectRatio) {
        const ratio = box.width / box.height;
        const byWidth = (value: number) => {
            width = Math.max(MIN_WIDTH, MIN_HEIGHT * ratio, value);
            height = width / ratio;
        };
        const byHeight = (value: number) => {
            height = Math.max(MIN_HEIGHT, MIN_WIDTH / ratio, value);
            width = height * ratio;
        };
        if (horizontal && vertical) {
            Math.abs(width / box.width - 1) >= Math.abs(height / box.height - 1) ? byWidth(width) : byHeight(height);
        } else if (horizontal) {
            byWidth(width);
        } else {
            byHeight(height);
        }
    }

    if (options.fromCenter) {
        left = box.left + (box.width - width) / 2;
        top = box.top + (box.height - height) / 2;
    } else {
        if (west) left = box.left + box.width - width;
        else if (!horizontal && options.lockAspectRatio) left = box.left + (box.width - width) / 2;
        if (north) top = box.top + box.height - height;
        else if (!vertical && options.lockAspectRatio) top = box.top + (box.height - height) / 2;
    }

    return { left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) };
}

export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT = 1080;
export const SNAP_THRESHOLD = 8;

export interface SnapResult {
    box: Box;
    /** Slide-space lines to draw while the snap holds. */
    guides: { vertical: number[]; horizontal: number[] };
}

/**
 * Pull a dragged box onto the nearest alignment of another object or the slide
 * centre. Without this, lining two boxes up means zooming in and nudging one pixel
 * at a time — the guides are what make dragging feel deliberate.
 */
export function snapBox(box: Box, others: Box[], threshold = SNAP_THRESHOLD): SnapResult {
    const lines = (b: Box) => ({
        x: [b.left, b.left + b.width / 2, b.left + b.width],
        y: [b.top, b.top + b.height / 2, b.top + b.height],
    });

    const targets = {
        x: [SLIDE_WIDTH / 2, ...others.flatMap((other) => lines(other).x)],
        y: [SLIDE_HEIGHT / 2, ...others.flatMap((other) => lines(other).y)],
    };

    const nearest = (own: number[], candidates: number[]) => {
        let best: { delta: number; line: number } | null = null;
        for (const [index, value] of own.entries()) {
            for (const candidate of candidates) {
                const delta = candidate - value;
                if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
                    best = { delta, line: candidate };
                }
                // `index` is unused beyond ordering; own edges are checked left-to-right.
                void index;
            }
        }
        return best;
    };

    const own = lines(box);
    const snapX = nearest(own.x, targets.x);
    const snapY = nearest(own.y, targets.y);

    return {
        box: {
            ...box,
            left: Math.round(box.left + (snapX?.delta ?? 0)),
            top: Math.round(box.top + (snapY?.delta ?? 0)),
        },
        guides: {
            vertical: snapX ? [snapX.line] : [],
            horizontal: snapY ? [snapY.line] : [],
        },
    };
}

/** Arrow-key nudge: one slide pixel, or ten with shift held. */
export function nudgeBox(box: Box, key: string, coarse: boolean): Box | null {
    const step = coarse ? 10 : 1;
    const move: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    const delta = move[key];
    if (!delta) return null;
    return { ...box, left: box.left + delta[0], top: box.top + delta[1] };
}
