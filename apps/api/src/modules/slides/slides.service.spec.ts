import { BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { SlidesService } from './slides.service';

jest.mock('axios', () => ({ __esModule: true, default: { post: jest.fn() } }));
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('SlidesService scene', () => {
    const prisma = { slide: { findUnique: jest.fn(), update: jest.fn() } };
    const config = { get: jest.fn().mockReturnValue('http://renderer.internal') };
    const storage = { getBuffer: jest.fn() };
    let service: SlidesService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new SlidesService(prisma as any, config as any, storage as any);
    });

    it('loads a PPTX-sourced slide as a scene via the renderer', async () => {
        prisma.slide.findUnique.mockResolvedValue({
            id: 'slide-1',
            content: { objectEdits: [{ objectId: 'shape-1', left: 10 }], templateIndex: 2 },
            presentation: { userId: 'user-1', isPublic: false, template: { config: { source: { kind: 'pptx', storageKey: 'templates/brand.pptx' } } } },
        });
        storage.getBuffer.mockResolvedValue(Buffer.from('pptx-bytes'));
        mockedAxios.post.mockResolvedValue({ data: { scene: { width: 1920, height: 1080, objects: [] } } } as any);

        await expect(service.getScene('slide-1', 'user-1')).resolves.toEqual({ scene: { width: 1920, height: 1080, objects: [] } });

        expect(storage.getBuffer).toHaveBeenCalledWith('templates/brand.pptx');
        expect(mockedAxios.post).toHaveBeenCalledWith(
            'http://renderer.internal/api/scene/pptx/load',
            { sourcePptx: Buffer.from('pptx-bytes').toString('base64'), templateIndex: 2, objectEdits: [{ objectId: 'shape-1', left: 10 }] },
            expect.objectContaining({ timeout: expect.any(Number) }),
        );
    });

    it('loads an HTML-ZIP-sourced slide as a scene via the renderer', async () => {
        prisma.slide.findUnique.mockResolvedValue({
            id: 'slide-2',
            content: { html: '<div class="slide-container"></div>' },
            presentation: { userId: 'user-1', isPublic: false, template: { config: { htmlSlides: ['<div/>'] } } },
        });
        mockedAxios.post.mockResolvedValue({ data: { scene: { width: 1920, height: 1080, objects: [] } } } as any);

        await expect(service.getScene('slide-2', 'user-1')).resolves.toEqual({ scene: { width: 1920, height: 1080, objects: [] } });

        expect(mockedAxios.post).toHaveBeenCalledWith(
            'http://renderer.internal/api/scene/html/load',
            { html: '<div class="slide-container"></div>' },
            expect.objectContaining({ timeout: expect.any(Number) }),
        );
    });

    it("rejects loading a scene for someone else's private slide", async () => {
        prisma.slide.findUnique.mockResolvedValue({ id: 'slide-1', content: {}, presentation: { userId: 'owner', isPublic: false, template: null } });

        await expect(service.getScene('slide-1', 'someone-else')).rejects.toThrow('Access denied');
        expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('saves an edited scene back onto a PPTX-sourced slide as objectEdits', async () => {
        prisma.slide.findUnique.mockResolvedValue({
            id: 'slide-1', content: { objectEdits: [] },
            presentation: { userId: 'user-1', template: { config: { source: { kind: 'pptx' } } } },
        });
        mockedAxios.post.mockResolvedValue({ data: { objectEdits: [{ objectId: 'shape-1', left: 20 }] } } as any);
        prisma.slide.update.mockResolvedValue({ id: 'slide-1' });

        await service.saveScene('slide-1', 'user-1', { width: 1920, height: 1080, objects: [] });

        expect(mockedAxios.post).toHaveBeenCalledWith(
            'http://renderer.internal/api/scene/pptx/save',
            { scene: { width: 1920, height: 1080, objects: [] } },
            expect.objectContaining({ timeout: expect.any(Number) }),
        );
        expect(prisma.slide.update).toHaveBeenCalledWith({
            where: { id: 'slide-1' },
            data: { content: { objectEdits: [{ objectId: 'shape-1', left: 20 }] } },
        });
    });

    it('saves an edited scene back onto an HTML-ZIP-sourced slide as html', async () => {
        prisma.slide.findUnique.mockResolvedValue({
            id: 'slide-2', content: { html: '<div/>' },
            presentation: { userId: 'user-1', template: { config: {} } },
        });
        mockedAxios.post.mockResolvedValue({ data: { html: '<div class="slide-container">edited</div>' } } as any);
        prisma.slide.update.mockResolvedValue({ id: 'slide-2' });

        await service.saveScene('slide-2', 'user-1', { width: 1920, height: 1080, objects: [] });

        expect(prisma.slide.update).toHaveBeenCalledWith({
            where: { id: 'slide-2' },
            data: { content: { html: '<div class="slide-container">edited</div>' } },
        });
    });
});
