import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from './storage.service';

@Injectable()
export class AssetsService {
    constructor(
        private prisma: PrismaService,
        private storageService: StorageService,
    ) { }

    async upload(
        userId: string,
        file: {
            filename: string;
            mimeType: string;
            size: number;
            buffer: Buffer;
        },
        type: 'IMAGE' | 'ICON' | 'LOGO' | 'BACKGROUND' = 'IMAGE',
    ) {
        const uploaded = await this.storageService.upload({
            originalname: file.filename,
            mimetype: file.mimeType,
            size: file.size,
            buffer: file.buffer,
        } as Express.Multer.File);

        const asset = await this.prisma.asset.create({
            data: {
                type,
                name: file.filename,
                url: uploaded.publicUrl,
                thumbnailUrl: uploaded.publicUrl,
                size: file.size,
                mimeType: file.mimeType,
                userId,
            },
        });

        return asset;
    }

    async findAll(userId: string, type?: string) {
        const where: any = { userId };
        if (type) where.type = type;

        return this.prisma.asset.findMany({
            where,
            orderBy: { createdAt: 'desc' },
        });
    }

    async findById(id: string) {
        const asset = await this.prisma.asset.findUnique({
            where: { id },
        });

        if (!asset) {
            throw new NotFoundException('Asset not found');
        }

        return asset;
    }

    async delete(id: string, userId: string) {
        const asset = await this.prisma.asset.findFirst({
            where: { id, userId },
        });

        if (!asset) {
            throw new NotFoundException('Asset not found');
        }

        if (asset.url.startsWith('/uploads/')) {
            await this.storageService.delete(asset.url.slice('/uploads/'.length));
        }
        await this.prisma.asset.delete({ where: { id } });

        return { success: true };
    }

    async getStockImages(query: string) {
        // Placeholder for stock image integration (Unsplash, Pexels, etc.)
        return {
            images: [
                {
                    id: 'stock-1',
                    url: 'https://images.unsplash.com/photo-1499750310107-5fef28a66643',
                    thumbnailUrl: 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=200',
                    author: 'Unsplash',
                    license: 'Unsplash License',
                },
            ],
            query,
            source: 'unsplash',
        };
    }

    async getIcons(query: string) {
        // Placeholder for icon library integration
        return {
            icons: [
                {
                    id: 'icon-1',
                    name: 'check',
                    url: '/icons/check.svg',
                    category: 'actions',
                },
            ],
            query,
        };
    }
}
