import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TemplatesService {
    constructor(private prisma: PrismaService) { }

    async findAll(category?: string, isPublic = true) {
        const where: any = {};
        if (category) where.category = category;
        if (isPublic) where.isPublic = true;

        return this.prisma.template.findMany({
            where,
            orderBy: { name: 'asc' },
            select: {
                id: true,
                name: true,
                description: true,
                thumbnail: true,
                category: true,
                isPublic: true,
            },
        });
    }

    async findById(id: string) {
        const template = await this.prisma.template.findUnique({
            where: { id },
        });

        if (!template) {
            throw new NotFoundException('Template not found');
        }

        return template;
    }

    async create(data: {
        name: string;
        description?: string;
        thumbnail?: string;
        category: string;
        config: any;
        isPublic?: boolean;
        organizationId?: string;
    }) {
        return this.prisma.template.create({
            data: {
                name: data.name,
                description: data.description,
                thumbnail: data.thumbnail,
                category: data.category as any,
                config: data.config,
                isPublic: data.isPublic ?? false,
                organizationId: data.organizationId,
            },
        });
    }
}
