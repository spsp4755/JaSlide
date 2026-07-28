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

/**
 * Undo/redo history for a scene, sitting above scene-canvas.tsx rather than
 * inside it — the canvas is a controlled component that only ever emits
 * commands and renders whatever scene it is handed (see its own doc comment),
 * so the history that makes those commands reversible belongs one level up.
 */
export interface CommandStack {
    past: SlideScene[];
    present: SlideScene;
    future: SlideScene[];
}

export function initCommandStack(scene: SlideScene): CommandStack {
    return { past: [], present: scene, future: [] };
}

/** Apply a command and push the prior scene onto the undo history. A fresh
 *  action after an undo discards whatever redo branch was abandoned — the
 *  same rule every editor with undo/redo follows. */
export function pushSceneCommand(stack: CommandStack, command: SceneCommand): CommandStack {
    return { past: [...stack.past, stack.present], present: applySceneCommand(stack.present, command), future: [] };
}

export function canUndo(stack: CommandStack): boolean {
    return stack.past.length > 0;
}

export function canRedo(stack: CommandStack): boolean {
    return stack.future.length > 0;
}

/** Step back one scene. A no-op, not an error, when there is nothing to undo —
 *  a keyboard shortcut fires this without checking `canUndo` first. */
export function undo(stack: CommandStack): CommandStack {
    if (!stack.past.length) return stack;
    const present = stack.past[stack.past.length - 1];
    return { past: stack.past.slice(0, -1), present, future: [stack.present, ...stack.future] };
}

/** Step forward one scene. A no-op, not an error, when there is nothing to redo. */
export function redo(stack: CommandStack): CommandStack {
    if (!stack.future.length) return stack;
    const [present, ...future] = stack.future;
    return { past: [...stack.past, stack.present], present, future };
}
