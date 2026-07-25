/**
 * Per-slide debounced save.
 *
 * One timer per slide id, so editing slide A and then slide B inside the
 * debounce window no longer cancels A's pending save. Updates for the same
 * slide merge, so a later partial update never drops an earlier field.
 */
type SaveSlide<T> = (slideId: string, updates: T) => Promise<void>;

export function createSlideSaveScheduler<T extends object>(save: SaveSlide<T>, delayMs: number) {
    const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; updates: T }>();

    const run = async (slideId: string) => {
        const entry = pending.get(slideId);
        if (!entry) return;
        clearTimeout(entry.timer);
        pending.delete(slideId);
        await save(slideId, entry.updates);
    };

    return {
        schedule(slideId: string, updates: T) {
            const entry = pending.get(slideId);
            if (entry) clearTimeout(entry.timer);
            pending.set(slideId, {
                updates: { ...(entry?.updates as object), ...updates } as T,
                timer: setTimeout(() => { void run(slideId); }, delayMs),
            });
        },
        cancelAll() {
            for (const entry of pending.values()) clearTimeout(entry.timer);
            pending.clear();
        },
        flushAll() {
            return Promise.all([...pending.keys()].map(run)).then(() => undefined);
        },
    };
}
