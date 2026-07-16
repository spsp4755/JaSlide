import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaginationDto } from '../dto';
import { TemplateCategory } from '@prisma/client';

@Injectable()
export class AdminTemplatesService {
    constructor(
        private prisma: PrismaService,
        private configService: ConfigService,
    ) { }

    async importPptx(
        file: Express.Multer.File,
        data: { name: string; description?: string; category?: string; isPublic?: boolean; organizationId?: string },
    ) {
        if (!file || !file.originalname.toLowerCase().endsWith('.pptx') ||
            file.mimetype !== 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
            file.size > 20 * 1024 * 1024) {
            throw new BadRequestException('PPTX file up to 20MB required');
        }

        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }), file.originalname);
        const rendererUrl = this.configService.get<string>('RENDERER_URL') || 'http://localhost:8000';
        let response: { data?: { config?: unknown } };
        try {
            response = await axios.post(`${rendererUrl}/api/extract/style`, form, { timeout: 15000 });
        } catch {
            throw new BadRequestException('Failed to extract PPTX style');
        }
        if (!this.isTemplateConfig(response.data?.config)) {
            throw new BadRequestException('Invalid renderer template config');
        }
        return this.create({ ...data, category: data.category || 'CUSTOM', config: response.data.config });
    }

    private isTemplateConfig(config: unknown): config is { colors: Record<string, string>; typography: Record<string, string> } {
        if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
        const value = config as Record<string, unknown>;
        return this.isStringRecord(value.colors) && this.isStringRecord(value.typography);
    }

    private isStringRecord(value: unknown): value is Record<string, string> {
        return !!value && typeof value === 'object' && !Array.isArray(value) &&
            Object.values(value).every(item => typeof item === 'string');
    }

    async findAll(filter: PaginationDto & { category?: string; isPublic?: boolean }) {
        const { page = 1, limit = 20, category, isPublic } = filter;
        const skip = (page - 1) * limit;

        const where: any = {};
        if (category) where.category = category;
        if (isPublic !== undefined) where.isPublic = isPublic;

        const [templates, total] = await Promise.all([
            this.prisma.template.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    organization: { select: { id: true, name: true } },
                    _count: { select: { presentations: true } },
                },
            }),
            this.prisma.template.count({ where }),
        ]);

        return { data: templates, total, page, limit, totalPages: Math.ceil(total / limit) };
    }

    async findById(id: string) {
        const template = await this.prisma.template.findUnique({
            where: { id },
            include: {
                organization: { select: { id: true, name: true } },
                _count: { select: { presentations: true } },
            },
        });

        if (!template) throw new NotFoundException('Template not found');
        return template;
    }

    async create(data: { name: string; description?: string; category: string; config: any; isPublic?: boolean; organizationId?: string }) {
        const createData: any = {
            name: data.name,
            description: data.description,
            category: data.category as TemplateCategory,
            config: data.config,
            isPublic: data.isPublic,
        };
        if (data.organizationId) {
            createData.organization = { connect: { id: data.organizationId } };
        }
        return this.prisma.template.create({ data: createData });
    }

    async update(id: string, data: { name?: string; description?: string; category?: string; config?: any; isPublic?: boolean }) {
        const existing = await this.prisma.template.findUnique({ where: { id } });
        if (!existing) throw new NotFoundException('Template not found');

        const updateData: any = { ...data };
        if (data.category) {
            updateData.category = data.category as TemplateCategory;
        }
        return this.prisma.template.update({ where: { id }, data: updateData });
    }

    async delete(id: string) {
        const template = await this.prisma.template.findUnique({
            where: { id },
            include: { _count: { select: { presentations: true } } },
        });

        if (!template) throw new NotFoundException('Template not found');
        if (template._count.presentations > 0) {
            throw new NotFoundException('Cannot delete template in use');
        }

        await this.prisma.template.delete({ where: { id } });
        return { success: true };
    }

    // Color Palettes
    async findColorPalettes(filter: PaginationDto) {
        const { page = 1, limit = 20 } = filter;
        const skip = (page - 1) * limit;

        const [palettes, total] = await Promise.all([
            this.prisma.colorPalette.findMany({ skip, take: limit, orderBy: { createdAt: 'desc' } }),
            this.prisma.colorPalette.count(),
        ]);

        return { data: palettes, total, page, limit, totalPages: Math.ceil(total / limit) };
    }

    async createColorPalette(data: { name: string; colors: string[]; isPublic?: boolean; organizationId?: string }) {
        return this.prisma.colorPalette.create({ data });
    }

    async deleteColorPalette(id: string) {
        await this.prisma.colorPalette.delete({ where: { id } });
        return { success: true };
    }

    // Layout Rules
    async findLayoutRules(filter: PaginationDto) {
        const { page = 1, limit = 20 } = filter;
        const skip = (page - 1) * limit;

        const [rules, total] = await Promise.all([
            this.prisma.layoutRule.findMany({ skip, take: limit, orderBy: { createdAt: 'desc' } }),
            this.prisma.layoutRule.count(),
        ]);

        return { data: rules, total, page, limit, totalPages: Math.ceil(total / limit) };
    }

    async createLayoutRule(data: { name: string; slideType: string; config: any; isDefault?: boolean }) {
        return this.prisma.layoutRule.create({ data });
    }

    async deleteLayoutRule(id: string) {
        await this.prisma.layoutRule.delete({ where: { id } });
        return { success: true };
    }
}
