import { Logger, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { ExportService } from './export.service';

describe('ExportService', () => {
    const presentation = {
        id: 'presentation-1',
        title: 'Quarterly review',
        slides: [],
        template: null,
    };
    let service: ExportService;
    let prisma: { presentation: { findFirst: jest.Mock } };

    beforeEach(() => {
        prisma = { presentation: { findFirst: jest.fn().mockResolvedValue(presentation) } };
        service = new ExportService(
            prisma as any,
            { get: jest.fn().mockReturnValue('http://renderer.internal') } as any,
        );
    });

    it.each([
        ['PPTX', 'exportToPptx'],
        ['PDF', 'exportToPdf'],
    ] as const)('fails %s export when the renderer is unavailable', async (_format, method) => {
        jest.spyOn(axios, 'post').mockRejectedValueOnce(new Error('connection refused'));

        await expect(service[method]('presentation-1', 'user-1')).rejects.toThrow(
            ServiceUnavailableException,
        );
    });

    it('logs a serializable renderer detail before returning a PDF export error', async () => {
        const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation();
        jest.spyOn(axios, 'post').mockRejectedValueOnce({ response: { status: 500, data: { detail: 'conversion failed' } } });

        await expect(service.exportToPdf('presentation-1', 'user-1')).rejects.toThrow(ServiceUnavailableException);

        expect(logger).toHaveBeenCalledWith('PDF export failed: 500 conversion failed');
    });
});
