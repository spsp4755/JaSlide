import { BadRequestException, Injectable } from '@nestjs/common';
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
        'text/csv',
        'text/plain',
        'text/markdown',
    ]);

    constructor(private documentParser: DocumentParserService) {}

    async extract(file: Express.Multer.File): Promise<ExtractedSource> {
        if (!SourceExtractionService.ALLOWED_TYPES.has(file.mimetype)) {
            throw new BadRequestException('Unsupported source file');
        }
        if (!file.size || file.size > SourceExtractionService.MAX_SOURCE_BYTES) {
            throw new BadRequestException('Invalid source file size');
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
}
