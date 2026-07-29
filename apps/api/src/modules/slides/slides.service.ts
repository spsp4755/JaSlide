import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../assets/storage.service';
import { postToRenderer } from '../../renderer-client';
import { CreateSlideDto, UpdateSlideDto, ReorderSlidesDto } from './dto/slides.dto';

@Injectable()
export class SlidesService {
    constructor(
        private prisma: PrismaService,
        private configService: ConfigService,
        private storage: StorageService,
    ) { }

    async create(presentationId: string, userId: string, dto: CreateSlideDto) {
        // Check presentation ownership
        await this.checkPresentationOwnership(presentationId, userId);

        // Get current max order
        const lastSlide = await this.prisma.slide.findFirst({
            where: { presentationId },
            orderBy: { order: 'desc' },
            select: { order: true },
        });

        const order = dto.order ?? (lastSlide ? lastSlide.order + 1 : 0);

        const slide = await this.prisma.slide.create({
            data: {
                presentationId,
                order,
                type: dto.type,
                title: dto.title,
                content: dto.content as any,
                layout: dto.layout || 'center',
                notes: dto.notes,
            },
        });

        return slide;
    }

    async findAll(presentationId: string, userId: string) {
        await this.checkPresentationOwnership(presentationId, userId, true);

        const slides = await this.prisma.slide.findMany({
            where: { presentationId },
            orderBy: { order: 'asc' },
        });

        return slides;
    }

    async findById(id: string, userId: string) {
        const slide = await this.prisma.slide.findUnique({
            where: { id },
            include: {
                presentation: { select: { userId: true, isPublic: true } },
            },
        });

        if (!slide) {
            throw new NotFoundException('Slide not found');
        }

        if (slide.presentation.userId !== userId && !slide.presentation.isPublic) {
            throw new ForbiddenException('Access denied');
        }

        return slide;
    }

    async update(id: string, userId: string, dto: UpdateSlideDto) {
        const slide = await this.prisma.slide.findUnique({
            where: { id },
            include: { presentation: { select: { userId: true } } },
        });

        if (!slide) {
            throw new NotFoundException('Slide not found');
        }

        if (slide.presentation.userId !== userId) {
            throw new ForbiddenException('Access denied');
        }

        const updated = await this.prisma.slide.update({
            where: { id },
            data: {
                type: dto.type,
                title: dto.title,
                content: dto.content as any,
                layout: dto.layout,
                notes: dto.notes,
                order: dto.order,
            },
        });

        return updated;
    }

    async getScene(id: string, userId: string): Promise<{ scene: any }> {
        const slide = await this.prisma.slide.findUnique({
            where: { id },
            include: { presentation: { include: { template: true } } },
        });
        if (!slide) throw new NotFoundException('Slide not found');
        if (slide.presentation.userId !== userId && !slide.presentation.isPublic) {
            throw new ForbiddenException('Access denied');
        }

        const content = (slide.content as any) || {};
        const config = (slide.presentation.template?.config as any) || {};
        const rendererUrl = this.configService.get<string>('RENDERER_URL') || 'http://localhost:8000';

        if (config.source?.kind === 'pptx') {
            const storageKey = config.source?.storageKey || config.pptxTemplate?.storageKey;
            if (!storageKey) throw new BadRequestException('PPTX source file is unavailable');
            const source = await this.storage.getBuffer(storageKey);
            return postToRenderer<{ scene: any }>(rendererUrl, '/api/scene/pptx/load', {
                sourcePptx: source.toString('base64'),
                templateIndex: typeof content.templateIndex === 'number' ? content.templateIndex : 0,
                objectEdits: content.objectEdits || [],
            }, { timeout: 30000, rejectedMessage: '슬라이드를 편집 가능한 형태로 불러오지 못했습니다.' });
        }

        const htmlSlides = config.htmlSlides;
        const index = content.templateIndex;
        const html = typeof content.html === 'string' && content.html.trim()
            ? content.html
            : (Array.isArray(htmlSlides) && Number.isInteger(index) && typeof htmlSlides[index] === 'string' ? htmlSlides[index] : '');
        if (!html) throw new BadRequestException('슬라이드에 편집할 콘텐츠가 없습니다.');
        return postToRenderer<{ scene: any }>(rendererUrl, '/api/scene/html/load', { html }, {
            timeout: 15000,
            rejectedMessage: '슬라이드를 편집 가능한 형태로 불러오지 못했습니다.',
        });
    }

    async saveScene(id: string, userId: string, scene: Record<string, any>) {
        const slide = await this.prisma.slide.findUnique({
            where: { id },
            include: { presentation: { include: { template: true } } },
        });
        if (!slide) throw new NotFoundException('Slide not found');
        if (slide.presentation.userId !== userId) throw new ForbiddenException('Access denied');

        const config = (slide.presentation.template?.config as any) || {};
        const rendererUrl = this.configService.get<string>('RENDERER_URL') || 'http://localhost:8000';
        const content = (slide.content as any) || {};

        if (config.source?.kind === 'pptx') {
            const { objectEdits } = await postToRenderer<{ objectEdits: any[] }>(rendererUrl, '/api/scene/pptx/save', { scene }, {
                timeout: 15000,
                rejectedMessage: '편집 내용을 저장하지 못했습니다.',
            });
            return this.prisma.slide.update({ where: { id }, data: { content: { ...content, objectEdits } } });
        }

        const { html } = await postToRenderer<{ html: string }>(rendererUrl, '/api/scene/html/save', { scene }, {
            timeout: 15000,
            rejectedMessage: '편집 내용을 저장하지 못했습니다.',
        });
        return this.prisma.slide.update({ where: { id }, data: { content: { ...content, html } } });
    }

    async delete(id: string, userId: string) {
        const slide = await this.prisma.slide.findUnique({
            where: { id },
            include: { presentation: { select: { userId: true } } },
        });

        if (!slide) {
            throw new NotFoundException('Slide not found');
        }

        if (slide.presentation.userId !== userId) {
            throw new ForbiddenException('Access denied');
        }

        await this.prisma.slide.delete({ where: { id } });

        // Reorder remaining slides
        await this.prisma.slide.updateMany({
            where: {
                presentationId: slide.presentationId,
                order: { gt: slide.order },
            },
            data: { order: { decrement: 1 } },
        });

        return { success: true };
    }

    async reorder(presentationId: string, userId: string, dto: ReorderSlidesDto) {
        await this.checkPresentationOwnership(presentationId, userId);

        // Update all slide orders in a transaction
        await this.prisma.$transaction(
            dto.slideOrders.map(({ slideId, order }) =>
                this.prisma.slide.update({
                    where: { id: slideId },
                    data: { order },
                }),
            ),
        );

        // Return updated slides
        return this.findAll(presentationId, userId);
    }

    async duplicate(id: string, userId: string) {
        const slide = await this.prisma.slide.findUnique({
            where: { id },
            include: { presentation: { select: { userId: true } } },
        });

        if (!slide) {
            throw new NotFoundException('Slide not found');
        }

        if (slide.presentation.userId !== userId) {
            throw new ForbiddenException('Access denied');
        }

        // Get max order
        const lastSlide = await this.prisma.slide.findFirst({
            where: { presentationId: slide.presentationId },
            orderBy: { order: 'desc' },
            select: { order: true },
        });

        const newSlide = await this.prisma.slide.create({
            data: {
                presentationId: slide.presentationId,
                order: (lastSlide?.order ?? 0) + 1,
                type: slide.type,
                title: slide.title ? `${slide.title} (Copy)` : null,
                content: slide.content as any,
                layout: slide.layout,
                notes: slide.notes,
            },
        });

        return newSlide;
    }

    private async checkPresentationOwnership(
        presentationId: string,
        userId: string,
        allowPublic = false,
    ) {
        const presentation = await this.prisma.presentation.findUnique({
            where: { id: presentationId },
            select: { userId: true, isPublic: true },
        });

        if (!presentation) {
            throw new NotFoundException('Presentation not found');
        }

        if (presentation.userId !== userId && !(allowPublic && presentation.isPublic)) {
            throw new ForbiddenException('Access denied');
        }
    }
}
