import { BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { SourceExtractionService } from './source-extraction.service';

jest.mock('axios');

describe('SourceExtractionService', () => {
    const parser = {
        parseDocument: jest.fn(),
    };
    const service = new SourceExtractionService(parser as any, { get: jest.fn().mockReturnValue('http://renderer.internal') } as any);

    beforeEach(() => {
        jest.clearAllMocks();
        (global as any).Blob = class Blob {};
        (global as any).FormData = class FormData {
            append = jest.fn();
        };
    });

    it('extracts PPTX slides through the isolated renderer', async () => {
        (axios.post as jest.Mock).mockResolvedValue({
            data: {
                content: '표지\n분기 실적',
                slides: [
                    { number: 1, title: '표지', content: '분기 실적' },
                    { number: 2, title: '성과', content: '매출 20% 증가' },
                ],
            },
        });

        await expect(service.extract({
            originalname: 'brand.pptx',
            mimetype: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            size: 1024,
            buffer: Buffer.from('pptx'),
        } as Express.Multer.File)).resolves.toEqual({
            content: '표지\n분기 실적',
            chunks: [
                { locator: 'brand.pptx:slide:1:표지', content: '분기 실적' },
                { locator: 'brand.pptx:slide:2:성과', content: '매출 20% 증가' },
            ],
        });
        expect(axios.post).toHaveBeenCalledWith(
            'http://renderer.internal/api/extract/content',
            expect.any(FormData),
            expect.objectContaining({ timeout: 15000 }),
        );
    });

    it('returns stable locators for parsed sections', async () => {
        parser.parseDocument.mockResolvedValue({
            content: '분기 매출은 20% 증가했습니다.',
            metadata: { wordCount: 3 },
            sections: [
                { heading: '요약', content: '분기 매출은 20% 증가했습니다.' },
                { heading: '전망', content: '다음 분기 목표를 검토합니다.' },
            ],
        });

        await expect(service.extract({
            originalname: 'report.pdf',
            mimetype: 'application/pdf',
            size: 1024,
            buffer: Buffer.from('pdf'),
        } as Express.Multer.File)).resolves.toEqual({
            content: '분기 매출은 20% 증가했습니다.',
            chunks: [
                { locator: 'report.pdf:section:1:요약', content: '분기 매출은 20% 증가했습니다.' },
                { locator: 'report.pdf:section:2:전망', content: '다음 분기 목표를 검토합니다.' },
            ],
        });
    });
});
