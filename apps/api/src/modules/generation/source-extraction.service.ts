import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { DocumentParserService } from './document-parser.service';

export interface SourceChunk {
    locator: string;
    content: string;
}

export interface ExtractedSource {
    content: string;
    chunks: SourceChunk[];
}

@Injectable()
export class SourceExtractionService {
    private static readonly MAX_SOURCE_BYTES = 50 * 1024 * 1024;
    private static readonly ALLOWED_TYPES = new Set([
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/csv',
        'text/plain',
        'text/markdown',
    ]);

    constructor(
        private documentParser: DocumentParserService,
        private configService: ConfigService,
    ) {}

    async extract(file: Express.Multer.File): Promise<ExtractedSource> {
        if (!SourceExtractionService.ALLOWED_TYPES.has(file.mimetype)) {
            throw new BadRequestException('Unsupported source file');
        }
        if (!file.size || file.size > SourceExtractionService.MAX_SOURCE_BYTES) {
            throw new BadRequestException('Invalid source file size');
        }

        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
            return this.extractPptx(file);
        }

        const parsed = await this.documentParser.parseDocument(file.buffer, file.mimetype, file.originalname);
        const chunks = parsed.sections
            .map((section, index) => ({
                locator: `${file.originalname}:section:${index + 1}${section.heading ? `:${section.heading}` : ''}`,
                content: section.content.trim(),
            }))
            .filter((chunk) => chunk.content.length > 0);

        if (chunks.length === 0) {
            throw new BadRequestException('Source file has no extractable content');
        }

        return { content: parsed.content, chunks };
    }

    private async extractPptx(file: Express.Multer.File): Promise<ExtractedSource> {
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }), file.originalname);
        const rendererUrl = this.configService.get<string>('RENDERER_URL') || 'http://localhost:8000';
        let data: unknown;
        try {
            const response = await axios.post(`${rendererUrl}/api/extract/content`, form, { timeout: 15000 });
            data = response.data;
        } catch {
            throw new BadRequestException('Failed to extract PPTX content');
        }
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new BadRequestException('Invalid PPTX extraction result');
        }
        const result = data as { content?: unknown; slides?: unknown };
        if (typeof result.content !== 'string' || !Array.isArray(result.slides)) {
            throw new BadRequestException('Invalid PPTX extraction result');
        }
        const chunks = result.slides.flatMap((slide) => {
            if (!slide || typeof slide !== 'object' || Array.isArray(slide)) return [];
            const value = slide as { number?: unknown; title?: unknown; content?: unknown };
            if (!Number.isInteger(value.number) || (value.number as number) < 1 || typeof value.content !== 'string' || !value.content.trim()) return [];
            const title = typeof value.title === 'string' && value.title.trim() ? `:${value.title.trim()}` : '';
            return [{ locator: `${file.originalname}:slide:${value.number}${title}`, content: value.content.trim() }];
        });
        if (chunks.length === 0) throw new BadRequestException('Source file has no extractable content');
        return { content: result.content, chunks };
    }
}
