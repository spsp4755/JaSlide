import { create } from 'zustand';

// Types
interface Slide {
    id: string;
    order: number;
    type: string;
    title?: string;
    content: any;
    layout: string;
    notes?: string;
}

interface Block {
    id: string;
    slideId: string;
    type: 'TEXT' | 'IMAGE' | 'CHART' | 'TABLE' | 'ICON' | 'SHAPE';
    order: number;
    content: any;
    style: any;
}

interface Presentation {
    id: string;
    title: string;
    slides: Slide[];
    templateId?: string;
    template?: { config?: any } | null;
}

interface Version {
    id: string;
    versionNumber: number;
    name?: string;
    createdAt: string;
}

interface Snapshot {
    presentation: Presentation;
    selectedSlideId: string | null;
    timestamp: number;
}

interface EditorState {
    presentation: Presentation | null;
    selectedSlideId: string | null;
    selectedBlockId: string | null;
    isEditing: boolean;
    isDirty: boolean;

    // Undo/Redo
    undoStack: Snapshot[];
    redoStack: Snapshot[];
    canUndo: boolean;
    canRedo: boolean;

    // Version management
    versions: Version[];
    currentVersionId: string | null;
    isLoadingVersions: boolean;

    // Actions - Presentation
    setPresentation: (presentation: Presentation) => void;
    setSelectedSlide: (slideId: string | null) => void;
    setSelectedBlock: (blockId: string | null) => void;
    updateSlide: (slideId: string, updates: Partial<Slide>) => void;
    addSlide: (slide: Slide) => void;
    removeSlide: (slideId: string) => void;
    reorderSlides: (fromIndex: number, toIndex: number) => void;
    setDirty: (dirty: boolean) => void;
    reset: () => void;

    // Actions - Undo/Redo
    undo: () => void;
    redo: () => void;
    saveSnapshot: () => void;
    clearHistory: () => void;

    // Actions - Versions
    setVersions: (versions: Version[]) => void;
    setCurrentVersionId: (versionId: string | null) => void;
    setLoadingVersions: (loading: boolean) => void;
}

const MAX_UNDO_STACK = 50;

export const useEditorStore = create<EditorState>((set, get) => ({
    presentation: null,
    selectedSlideId: null,
    selectedBlockId: null,
    isEditing: false,
    isDirty: false,

    // Undo/Redo state
    undoStack: [],
    redoStack: [],
    canUndo: false,
    canRedo: false,

    // Version state
    versions: [],
    currentVersionId: null,
    isLoadingVersions: false,

    setPresentation: (presentation) => {
        set((state) => ({
            presentation,
            selectedSlideId: presentation.slides.some((slide) => slide.id === state.selectedSlideId)
                ? state.selectedSlideId
                : presentation.slides[0]?.id || null,
            selectedBlockId: null,
            isDirty: false,
            undoStack: [],
            redoStack: [],
            canUndo: false,
            canRedo: false,
        }));
    },

    setSelectedSlide: (slideId) => {
        set({ selectedSlideId: slideId, selectedBlockId: null });
    },

    setSelectedBlock: (blockId) => {
        set({ selectedBlockId: blockId });
    },

    updateSlide: (slideId, updates) => {
        const state = get();
        if (!state.presentation) return;

        // Save snapshot for undo before making changes
        state.saveSnapshot();

        const updatedSlides = state.presentation.slides.map((slide) =>
            slide.id === slideId ? { ...slide, ...updates } : slide
        );

        set({
            presentation: { ...state.presentation, slides: updatedSlides },
            isDirty: true,
        });
    },

    addSlide: (slide) => {
        const state = get();
        if (!state.presentation) return;

        state.saveSnapshot();

        set({
            presentation: {
                ...state.presentation,
                slides: [...state.presentation.slides, slide],
            },
            selectedSlideId: slide.id,
            isDirty: true,
        });
    },

    removeSlide: (slideId) => {
        const state = get();
        if (!state.presentation) return;

        state.saveSnapshot();

        const filteredSlides = state.presentation.slides.filter((s) => s.id !== slideId);
        const newSelectedId =
            state.selectedSlideId === slideId
                ? filteredSlides[0]?.id || null
                : state.selectedSlideId;

        set({
            presentation: { ...state.presentation, slides: filteredSlides },
            selectedSlideId: newSelectedId,
            isDirty: true,
        });
    },

    reorderSlides: (fromIndex, toIndex) => {
        const state = get();
        if (!state.presentation) return;

        state.saveSnapshot();

        const slides = [...state.presentation.slides];
        const [moved] = slides.splice(fromIndex, 1);
        slides.splice(toIndex, 0, moved);

        const reorderedSlides = slides.map((slide, index) => ({
            ...slide,
            order: index,
        }));

        set({
            presentation: { ...state.presentation, slides: reorderedSlides },
            isDirty: true,
        });
    },

    setDirty: (dirty) => {
        set({ isDirty: dirty });
    },

    reset: () => {
        set({
            presentation: null,
            selectedSlideId: null,
            selectedBlockId: null,
            isEditing: false,
            isDirty: false,
            undoStack: [],
            redoStack: [],
            canUndo: false,
            canRedo: false,
            versions: [],
            currentVersionId: null,
        });
    },

    // Undo/Redo Actions
    saveSnapshot: () => {
        const state = get();
        if (!state.presentation) return;

        const snapshot: Snapshot = {
            presentation: JSON.parse(JSON.stringify(state.presentation)),
            selectedSlideId: state.selectedSlideId,
            timestamp: Date.now(),
        };

        const newUndoStack = [...state.undoStack, snapshot].slice(-MAX_UNDO_STACK);

        set({
            undoStack: newUndoStack,
            redoStack: [], // Clear redo stack on new action
            canUndo: newUndoStack.length > 0,
            canRedo: false,
        });
    },

    undo: () => {
        const state = get();
        if (state.undoStack.length === 0 || !state.presentation) return;

        // Save current state to redo stack
        const currentSnapshot: Snapshot = {
            presentation: JSON.parse(JSON.stringify(state.presentation)),
            selectedSlideId: state.selectedSlideId,
            timestamp: Date.now(),
        };

        const newUndoStack = [...state.undoStack];
        const previousSnapshot = newUndoStack.pop()!;

        set({
            presentation: previousSnapshot.presentation,
            selectedSlideId: previousSnapshot.selectedSlideId,
            undoStack: newUndoStack,
            redoStack: [...state.redoStack, currentSnapshot],
            canUndo: newUndoStack.length > 0,
            canRedo: true,
            isDirty: true,
        });
    },

    redo: () => {
        const state = get();
        if (state.redoStack.length === 0 || !state.presentation) return;

        // Save current state to undo stack
        const currentSnapshot: Snapshot = {
            presentation: JSON.parse(JSON.stringify(state.presentation)),
            selectedSlideId: state.selectedSlideId,
            timestamp: Date.now(),
        };

        const newRedoStack = [...state.redoStack];
        const nextSnapshot = newRedoStack.pop()!;

        set({
            presentation: nextSnapshot.presentation,
            selectedSlideId: nextSnapshot.selectedSlideId,
            undoStack: [...state.undoStack, currentSnapshot],
            redoStack: newRedoStack,
            canUndo: true,
            canRedo: newRedoStack.length > 0,
            isDirty: true,
        });
    },

    clearHistory: () => {
        set({
            undoStack: [],
            redoStack: [],
            canUndo: false,
            canRedo: false,
        });
    },

    // Version Actions
    setVersions: (versions) => {
        set({ versions });
    },

    setCurrentVersionId: (versionId) => {
        set({ currentVersionId: versionId });
    },

    setLoadingVersions: (loading) => {
        set({ isLoadingVersions: loading });
    },
}));
