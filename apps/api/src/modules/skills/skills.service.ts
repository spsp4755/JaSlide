import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSkillDto } from './dto/skill.dto';

interface SkillUser {
    id: string;
    organizationId?: string | null;
}

@Injectable()
export class SkillsService {
    constructor(
        private prisma: PrismaService,
        private configService: ConfigService,
    ) {}

    async findVisible(user: SkillUser, category?: string) {
        return this.prisma.presentationSkill.findMany({
            where: {
                AND: [
                    { OR: [{ isPublic: true }, { userId: user.id }, { organizationId: user.organizationId ?? undefined }] },
                    ...(category ? [{ category }] : []),
                ],
            },
            orderBy: { name: 'asc' },
        });
    }

    async create(user: SkillUser, dto: CreateSkillDto) {
        if ('packageUrl' in dto || 'package' in dto) {
            throw new BadRequestException('Unsupported Skill field');
        }

        return this.prisma.presentationSkill.create({
            data: {
                ...dto,
                userId: user.id,
                organizationId: user.organizationId ?? null,
            },
        });
    }

    async importPptx(user: SkillUser, file: Express.Multer.File, name?: string) {
        if (!file ||
            !file.originalname.toLowerCase().endsWith('.pptx') ||
            !file.size || file.size > 20 * 1024 * 1024) {
            throw new BadRequestException('PPTX file up to 20MB required');
        }

        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(file.buffer)], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }), file.originalname);
        const rendererUrl = this.configService.get<string>('RENDERER_URL') || 'http://localhost:8000';
        let config: unknown;
        try {
            const response = await axios.post(`${rendererUrl}/api/extract/style`, form, { timeout: 60000 });
            config = response.data?.config;
        } catch {
            throw new BadRequestException('Failed to extract PPTX style');
        }
        if (!this.isTemplateConfig(config)) throw new BadRequestException('Invalid PPTX style tokens');

        const skillName = name?.trim() || file.originalname.replace(/\.pptx$/i, '');
        const template = await this.prisma.template.create({
            data: {
                name: skillName,
                category: 'BUSINESS',
                config,
                isPublic: false,
                organizationId: user.organizationId ?? null,
            },
        });
        return this.prisma.presentationSkill.create({
            data: {
                name: skillName,
                description: 'PPTX에서 추출한 시각 스타일을 재사용합니다.',
                category: 'CUSTOM',
                audience: '일반 청중',
                tone: '명확하고 단정하게',
                purpose: 'PPTX 스타일을 재사용한 프레젠테이션',
                outlineGuidance: '원본의 정보 계층과 시각적 밀도를 참고해 핵심 내용을 구성합니다.',
                recommendedSlideCount: 10,
                userId: user.id,
                organizationId: user.organizationId ?? null,
                templateId: template.id,
            },
        });
    }

    private isTemplateConfig(value: unknown): value is { colors: Record<string, string>; typography: Record<string, string> } {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        const config = value as Record<string, unknown>;
        return this.isStringRecord(config.colors) && this.isStringRecord(config.typography);
    }

    private isStringRecord(value: unknown): value is Record<string, string> {
        return !!value && typeof value === 'object' && !Array.isArray(value) &&
            Object.values(value).every((item) => typeof item === 'string');
    }
}
