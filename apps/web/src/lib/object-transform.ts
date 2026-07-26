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
export const RESIZE_HANDLES: readonly { handle: ResizeHandle; label: string; cursor: string; position: string }[] = [
    { handle: 'nw', label: '왼쪽 위', cursor: 'cursor-nwse-resize', position: '-top-1.5 -left-1.5' },
    { handle: 'n', label: '위', cursor: 'cursor-ns-resize', position: '-top-1.5 left-1/2 -translate-x-1/2' },
    { handle: 'ne', label: '오른쪽 위', cursor: 'cursor-nesw-resize', position: '-top-1.5 -right-1.5' },
    { handle: 'e', label: '오른쪽', cursor: 'cursor-ew-resize', position: 'top-1/2 -right-1.5 -translate-y-1/2' },
    { handle: 'se', label: '오른쪽 아래', cursor: 'cursor-nwse-resize', position: '-bottom-1.5 -right-1.5' },
    { handle: 's', label: '아래', cursor: 'cursor-ns-resize', position: '-bottom-1.5 left-1/2 -translate-x-1/2' },
    { handle: 'sw', label: '왼쪽 아래', cursor: 'cursor-nesw-resize', position: '-bottom-1.5 -left-1.5' },
    { handle: 'w', label: '왼쪽', cursor: 'cursor-ew-resize', position: 'top-1/2 -left-1.5 -translate-y-1/2' },
] as const;

export const MIN_WIDTH = 40;
export const MIN_HEIGHT = 24;

/**
 * Apply a pointer delta to the box, anchoring the edges the handle does not drag.
 * Dragging an edge past its opposite one stops at the minimum instead of inverting.
 */
export function resizeBox(box: Box, handle: ResizeHandle, dx: number, dy: number): Box {
    const west = handle.includes('w');
    const east = handle.includes('e');
    const north = handle.startsWith('n');
    const south = handle.startsWith('s');

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

    return { left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) };
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
