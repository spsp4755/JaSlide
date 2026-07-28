/**
 * Turn a drag/resize gesture into a `SceneCommand`, and reuse the geometry
 * this editor already validated — `resizeBox`/`snapBox`/`nudgeBox` are pure
 * Box math with no dependency on the legacy HTML+objectEdits model, so they
 * apply to a SlideScene object exactly as they do to the old one.
 */
import { applySceneCommand, type SceneCommand, type SlideObject, type SlideScene } from '@jaslide/shared';
import { type Box, type ResizeHandle, resizeBox, type ResizeOptions, snapBox, type SnapResult } from './object-transform';

/** A command that moves an object to an absolute position. */
export function moveCommand(objectId: string, box: Pick<Box, 'left' | 'top'>): SceneCommand {
    return { objectId, patch: { x: box.left, y: box.top } as Partial<SlideObject> };
}

/** A command that resizes (and possibly repositions) an object. */
export function resizeCommand(objectId: string, box: Box): SceneCommand {
    return { objectId, patch: { x: box.left, y: box.top, width: box.width, height: box.height } as Partial<SlideObject> };
}

/** An object's current geometry, in the shape `resizeBox`/`snapBox` expect. */
export function boxOf(object: Pick<SlideObject, 'x' | 'y' | 'width' | 'height'>): Box {
    return { left: object.x, top: object.y, width: object.width, height: object.height };
}

/** Resize from a handle, honouring the same Shift/Ctrl modifiers as the legacy canvas. */
export function resizeFromHandle(box: Box, handle: ResizeHandle, dx: number, dy: number, options: ResizeOptions): Box {
    return resizeBox(box, handle, dx, dy, options);
}

/** Snap a dragged box against every other object's edges and the slide centre. */
export function snapAgainstNeighbours(box: Box, scene: SlideScene, movingId: string): SnapResult {
    const neighbours = scene.objects.filter((object) => object.id !== movingId).map(boxOf);
    return snapBox(box, neighbours);
}

export { applySceneCommand };
export type { SceneCommand };
