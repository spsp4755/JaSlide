import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePresentationDto, UpdatePresentationDto } from './dto/presentations.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class PresentationsService {
    constructor(private prisma: PrismaService) { }

    async create(userId: string, dto: CreatePresentationDto) {
        const presentation = await this.prisma.presentation.create({
            data: {
                title: dto.title || 'Untitled Presentation',
                description: dto.description,
                userId,
                templateId: dto.templateId,
                sourceType: dto.sourceType,
                sourceContent: dto.content,
                status: 'DRAFT',
            },
            include: {
                slides: true,
                template: true,
            },
        });

        return presentation;
    }

    async findAll(userId: string, page = 1, limit = 10) {
        const skip = (page - 1) * limit;

        const [presentations, total] = await Promise.all([
            this.prisma.presentation.findMany({
                where: { userId },
                orderBy: { updatedAt: 'desc' },
                skip,
                take: limit,
                include: {
                    _count: { select: { slides: true } },
                    template: { select: { id: true, name: true, thumbnail: true } },
                },
            }),
            this.prisma.presentation.count({ where: { userId } }),
        ]);

        return {
            data: presentations,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }

    async findById(id: string, userId: string) {
        const presentation = await this.prisma.presentation.findUnique({
            where: { id },
            include: {
                slides: { orderBy: { order: 'asc' } },
                template: true,
                user: { select: { id: true, name: true, email: true } },
            },
        });

        if (!presentation) {
            throw new NotFoundException('Presentation not found');
        }

        // Check ownership or public access
        if (presentation.userId !== userId && !presentation.isPublic) {
            throw new ForbiddenException('Access denied');
        }

        return presentation;
    }

    /**
     * The markup the browser renders and edits for one slide.
     *
     * A ZIP deck generates HTML per slide, so that is the slide. A PPTX deck
     * keeps its layouts on the template and records which one the generator
     * chose, so resolve through `templateIndex`. Served per slide rather than
     * with the presentation because a template's slides inline their images —
     * a 17-slide deck runs to megabytes the editor would fetch on every load.
     *
     * Returns an empty string rather than throwing when a slide has no HTML:
     * the editor falls back to the server-rendered PNG, and a slide must never
     * render as an empty stage.
     */
    async slideTemplateHtml(id: string, userId: string, order: number): Promise<{ html: string }> {
        const presentation = await this.findById(id, userId);
        const slide = presentation.slides.find((item) => item.order === order);
        if (!slide) {
            throw new NotFoundException('Slide not found');
        }

        const content = (slide.content as any) || {};
        if (typeof content.html === 'string' && content.html.trim()) {
            return { html: content.html };
        }

        const htmlSlides = (presentation.template?.config as any)?.htmlSlides;
        const index = content.templateIndex;
        if (Array.isArray(htmlSlides) && Number.isInteger(index) && typeof htmlSlides[index] === 'string') {
            return { html: htmlSlides[index] };
        }
        return { html: '' };
    }

    async update(id: string, userId: string, dto: UpdatePresentationDto) {
        // Check ownership
        const existing = await this.prisma.presentation.findUnique({
            where: { id },
            select: { userId: true },
        });

        if (!existing) {
            throw new NotFoundException('Presentation not found');
        }

        if (existing.userId !== userId) {
            throw new ForbiddenException('Access denied');
        }

        const presentation = await this.prisma.presentation.update({
            where: { id },
            data: {
                title: dto.title,
                description: dto.description,
                templateId: dto.templateId,
                isPublic: dto.isPublic,
            },
            include: {
                slides: { orderBy: { order: 'asc' } },
                template: true,
            },
        });

        return presentation;
    }

    async delete(id: string, userId: string) {
        // Check ownership
        const existing = await this.prisma.presentation.findUnique({
            where: { id },
            select: { userId: true },
        });

        if (!existing) {
            throw new NotFoundException('Presentation not found');
        }

        if (existing.userId !== userId) {
            throw new ForbiddenException('Access denied');
        }

        await this.prisma.presentation.delete({ where: { id } });

        return { success: true };
    }

    async generateShareToken(id: string, userId: string) {
        // Check ownership
        const existing = await this.prisma.presentation.findUnique({
            where: { id },
            select: { userId: true },
        });

        if (!existing) {
            throw new NotFoundException('Presentation not found');
        }

        if (existing.userId !== userId) {
            throw new ForbiddenException('Access denied');
        }

        const shareToken = uuidv4();

        await this.prisma.presentation.update({
            where: { id },
            data: { shareToken, isPublic: true },
        });

        return { shareToken };
    }

    async findByShareToken(token: string) {
        const presentation = await this.prisma.presentation.findUnique({
            where: { shareToken: token },
            include: {
                slides: { orderBy: { order: 'asc' } },
                template: true,
                user: { select: { name: true } },
            },
        });

        if (!presentation || !presentation.isPublic) {
            throw new NotFoundException('Presentation not found');
        }

        return presentation;
    }

    async duplicate(id: string, userId: string) {
        const original = await this.prisma.presentation.findUnique({
            where: { id },
            include: { slides: true },
        });

        if (!original) {
            throw new NotFoundException('Presentation not found');
        }

        if (original.userId !== userId && !original.isPublic) {
            throw new ForbiddenException('Access denied');
        }

        // Create duplicate
        const duplicate = await this.prisma.presentation.create({
            data: {
                title: `${original.title} (Copy)`,
                description: original.description,
                userId,
                templateId: original.templateId,
                sourceType: original.sourceType,
                sourceContent: original.sourceContent,
                status: 'DRAFT',
                slides: {
                    create: original.slides.map((slide) => ({
                        order: slide.order,
                        type: slide.type,
                        title: slide.title,
                        content: slide.content as any,
                        layout: slide.layout,
                        notes: slide.notes,
                    })),
                },
            },
            include: {
                slides: true,
            },
        });

        return duplicate;
    }
}
