// Generation types

export interface GenerationJob {
    id: string;
    userId: string;
    presentationId?: string;
    status: GenerationStatus;
    input: GenerationInput;
    output?: GenerationOutput;
    progress: number;
    error?: GenerationError;
    startedAt?: Date;
    completedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

export enum GenerationStatus {
    QUEUED = 'QUEUED',
    PROCESSING = 'PROCESSING',
    GENERATING_OUTLINE = 'GENERATING_OUTLINE',
    GENERATING_CONTENT = 'GENERATING_CONTENT',
    APPLYING_DESIGN = 'APPLYING_DESIGN',
    RENDERING = 'RENDERING',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
    CANCELLED = 'CANCELLED',
}

export interface GenerationInput {
    sourceType: string;
    content: string;
    templateId?: string;
    slideCount: number;
    language: string;
    options?: GenerationOptions;
}

export interface GenerationOptions {
    includeImages: boolean;
    includeCharts: boolean;
    style: 'professional' | 'casual' | 'academic' | 'creative';
    tone: 'formal' | 'friendly' | 'persuasive' | 'informative';
}

export interface GenerationOutput {
    presentationId: string;
    slideCount: number;
    outline: OutlineItem[];
    generatedAt: Date;
}

export interface GenerationError {
    code: string;
    message: string;
    details?: Record<string, unknown>;
}

export interface OutlineItem {
    order: number;
    title: string;
    type: string;
    keyPoints: string[];
}

// AI Edit types
export interface AIEditRequest {
    presentationId: string;
    slideId?: string;
    instruction: string;
    context?: AIEditContext;
}

export interface AIEditContext {
    selectedText?: string;
    surroundingContent?: string;
}

export interface AIEditResponse {
    success: boolean;
    changes: AIEditChange[];
    message?: string;
}

export interface AIEditChange {
    slideId: string;
    field: string;
    oldValue: unknown;
    newValue: unknown;
}

// Export types
export interface ExportOptions {
    format: 'pptx' | 'pdf' | 'google-slides';
    quality?: 'standard' | 'high';
    includeNotes?: boolean;
    includeAnimations?: boolean;
}

export interface ExportResult {
    url: string;
    format: string;
    size: number;
    expiresAt: Date;
}
