import { BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { AdminTemplatesService } from './admin-templates.service';

jest.mock('axios', () => ({
    __esModule: true,
    default: { post: jest.fn() },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const pptxType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

describe('AdminTemplatesService PPTX import', () => {
    const prisma = { template: { create: jest.fn() } };
    const config = { get: jest.fn().mockReturnValue('http://renderer.internal') };
    const storage = { upload: jest.fn() };
    let service: AdminTemplatesService;

    const file = (overrides: Partial<Express.Multer.File> = {}) => ({
        originalname: 'brand.pptx',
        mimetype: pptxType,
        size: 128,
        buffer: Buffer.from('pptx'),
        ...overrides,
    }) as Express.Multer.File;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new AdminTemplatesService(prisma as any, config as any, storage as any);
    });

    it('forwards a PPTX to the renderer and saves its validated config', async () => {
        const extracted = {
            colors: { background: '#112233', primary: '#445566' },
            typography: { titleFont: 'Noto Sans KR', bodyFont: 'Noto Sans KR' },
        };
        mockedAxios.post.mockResolvedValue({ data: { config: extracted } } as any);
        prisma.template.create.mockResolvedValue({ id: 'template-1', name: 'Brand' });

        await expect(service.importPptx(file(), { name: 'Brand', category: 'CUSTOM' }))
            .resolves.toEqual({ id: 'template-1', name: 'Brand' });

        expect(mockedAxios.post).toHaveBeenCalledWith(
            'http://renderer.internal/api/extract/style',
            expect.any(FormData),
            expect.objectContaining({ timeout: 15000 }),
        );
        expect(prisma.template.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ name: 'Brand', category: 'CUSTOM', config: extracted }),
        });
    });

    it.each([
        file({ originalname: 'brand.pdf' }),
        file({ mimetype: 'application/pdf' }),
        file({ size: 20 * 1024 * 1024 + 1 }),
    ])('rejects an invalid PPTX upload before forwarding it', async (upload) => {
        await expect(service.importPptx(upload, { name: 'Brand', category: 'CUSTOM' }))
            .rejects.toThrow(BadRequestException);
        expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('rejects a renderer response that is not template tokens', async () => {
        mockedAxios.post.mockResolvedValue({ data: { config: { colors: { primary: 123 } } } } as any);

        await expect(service.importPptx(file(), { name: 'Brand', category: 'CUSTOM' }))
            .rejects.toThrow('Invalid renderer template config');
        expect(prisma.template.create).not.toHaveBeenCalled();
    });

    it('stores a renderer-validated HTML ZIP and its archive metadata', async () => {
        const archive = {
            originalname: 'research.zip',
            mimetype: 'application/zip',
            size: 128,
            buffer: Buffer.from('zip'),
        } as Express.Multer.File;
        const extracted = {
            htmlTemplate: '<h1>Research</h1>',
            archive: { manifestPath: 'deck/research/manifest.json', slides: ['deck/research/slides/01.html'] },
        };
        mockedAxios.post.mockResolvedValue({ data: { config: extracted } } as any);
        storage.upload.mockResolvedValue({ key: 'templates/research.zip' });
        prisma.template.create.mockResolvedValue({ id: 'template-zip', name: 'Research' });
        service = new (AdminTemplatesService as any)(prisma, config, storage);

        await expect((service as any).importHtmlZip(archive, { name: 'Research', category: 'CUSTOM' }))
            .resolves.toEqual({ id: 'template-zip', name: 'Research' });

        expect(storage.upload).toHaveBeenCalledWith(archive, 'templates');
        expect(prisma.template.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                name: 'Research',
                config: expect.objectContaining({
                    htmlTemplate: '<h1>Research</h1>',
                    zipTemplate: expect.objectContaining({ storageKey: 'templates/research.zip' }),
                }),
            }),
        });
    });
});
