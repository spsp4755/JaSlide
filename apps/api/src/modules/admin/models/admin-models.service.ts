import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { LlmService } from '../../llm/llm.service';
import { AdminCreateLlmModelDto, AdminUpdateLlmModelDto, PaginationDto } from '../dto';

@Injectable()
export class AdminModelsService {
    constructor(private prisma: PrismaService, private llmService: LlmService) { }

    async findAll(filter: PaginationDto & { provider?: string }) {
        const { page = 1, limit = 20, provider } = filter;
        const skip = (page - 1) * limit;

        const where: any = {};
        if (provider) where.provider = provider;

        const [models, total] = await Promise.all([
            this.prisma.llmModel.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
            this.prisma.llmModel.count({ where }),
        ]);

        return { data: models, total, page, limit, totalPages: Math.ceil(total / limit) };
    }

    async findById(id: string) {
        const model = await this.prisma.llmModel.findUnique({ where: { id } });
        if (!model) throw new NotFoundException('Model not found');
        return model;
    }

    async create(dto: AdminCreateLlmModelDto) {
        const created = await this.prisma.llmModel.create({
            data: {
                name: dto.name,
                provider: dto.provider,
                modelId: dto.modelId,
                endpoint: dto.endpoint,
                apiKey: dto.apiKey,
                apiKeyEnvVar: dto.apiKeyEnvVar,
                maxTokens: dto.maxTokens ?? 4096,
                rateLimit: dto.rateLimit,
                costPerToken: dto.costPerToken,
                isActive: dto.isActive ?? true,
                isDefault: dto.isDefault ?? false,
                config: dto.config || {},
            },
        });
        this.llmService.invalidateClientCache();
        return created;
    }

    async update(id: string, dto: AdminUpdateLlmModelDto) {
        const existing = await this.prisma.llmModel.findUnique({ where: { id } });
        if (!existing) throw new NotFoundException('Model not found');
        const updated = await this.prisma.llmModel.update({ where: { id }, data: dto });
        this.llmService.invalidateClientCache();
        return updated;
    }

    async delete(id: string) {
        await this.prisma.llmModel.delete({ where: { id } });
        this.llmService.invalidateClientCache();
        return { success: true };
    }

    async setDefault(id: string) {
        await this.prisma.$transaction([
            this.prisma.llmModel.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
            this.prisma.llmModel.update({ where: { id }, data: { isDefault: true } }),
        ]);
        this.llmService.invalidateClientCache();
        return { success: true };
    }
}
