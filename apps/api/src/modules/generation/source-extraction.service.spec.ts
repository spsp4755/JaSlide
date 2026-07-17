import { BadRequestException } from '@nestjs/common';
import { SourceExtractionService } from './source-extraction.service';

describe('SourceExtractionService', () => {
    const parser = {
        parseDocument: jest.fn(),
    };
    const service = new SourceExtractionService(parser as any);

    beforeEach(() => jest.clearAllMocks());

    it('rejects a PPTX source document', async () => {
        await expect(service.extract({
            originalname: 'brand.pptx',
            mimetype: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            size: 1024,
            buffer: Buffer.from('pptx'),
        } as Express.Multer.File)).rejects.toBeInstanceOf(BadRequestException);
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
