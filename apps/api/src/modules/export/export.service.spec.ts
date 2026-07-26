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
        jest.clearAllMocks();
        presentation.template = null;
        prisma = { presentation: { findFirst: jest.fn().mockResolvedValue(presentation) } };
        service = new ExportService(
            prisma as any,
            { get: jest.fn().mockReturnValue('http://renderer.internal') } as any,
            { getBuffer: jest.fn() } as any,
        );
    });

    it('passes a retained PPTX template to the renderer for native export', async () => {
        const source = Buffer.from('native-pptx');
        presentation.template = { id: 'template-1', config: { source: { kind: 'pptx', storageKey: 'templates/source.pptx' } } } as any;
        (service as any).storage.getBuffer.mockResolvedValue(source);
        jest.spyOn(axios, 'post').mockResolvedValueOnce({ data: Buffer.from('export') } as any);

        await service.exportToPptx('presentation-1', 'user-1');

        expect((service as any).storage.getBuffer).toHaveBeenCalledWith('templates/source.pptx');
        expect(axios.post).toHaveBeenCalledWith('http://renderer.internal/api/render/pptx', expect.objectContaining({
            presentation: expect.objectContaining({ template: expect.objectContaining({ config: expect.objectContaining({ sourcePptx: source.toString('base64') }) }) }),
        }), expect.any(Object));
    });

    // Chromium renders each HTML-template slide at 1920x1080 (~1.5s each), so a
    // whole deck needs far more than a handful of seconds. A 5s cap made the API
    // abandon renders the renderer completed, reported as "renderer unavailable".
    it.each([
        ['PPTX', 'exportToPptx', '/api/render/pptx'],
        ['PDF', 'exportToPdf', '/api/render/pdf'],
    ] as const)('allows a whole-deck %s render far longer than a single slide', async (_format, method, path) => {
        jest.spyOn(axios, 'post').mockResolvedValueOnce({ data: Buffer.from('export') } as any);

        await service[method]('presentation-1', 'user-1');

        const [url, , options] = (axios.post as jest.Mock).mock.calls[0];
        expect(url).toBe(`http://renderer.internal${path}`);
        expect(options.timeout).toBeGreaterThanOrEqual(120_000);
    });

    it('allows a single-slide preview render more than a few seconds', async () => {
        jest.spyOn(axios, 'post').mockResolvedValueOnce({ data: Buffer.from('png') } as any);

        await service.getExportPreview('presentation-1', 'user-1', 0);

        expect((axios.post as jest.Mock).mock.calls[0][2].timeout).toBeGreaterThanOrEqual(15_000);
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
