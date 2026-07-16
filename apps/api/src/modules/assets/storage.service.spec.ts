import { existsSync } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { StorageService } from './storage.service';

describe('StorageService', () => {
    let directory: string;

    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'jaslide-assets-'));
    });

    afterEach(async () => {
        await rm(directory, { recursive: true, force: true });
    });

    it('stores and removes local uploads when S3 is not configured', async () => {
        const service = new StorageService({
            get: jest.fn((key: string) => key === 'LOCAL_STORAGE_PATH' ? directory : undefined),
        } as any);
        const uploaded = await service.upload({
            originalname: '../brand.png',
            mimetype: 'image/png',
            buffer: Buffer.from('image-data'),
        } as Express.Multer.File);

        expect(uploaded.publicUrl).toMatch(/^\/uploads\/uploads\//);
        expect(existsSync(join(directory, uploaded.key))).toBe(true);

        await service.delete(uploaded.key);

        expect(existsSync(join(directory, uploaded.key))).toBe(false);
    });
});
