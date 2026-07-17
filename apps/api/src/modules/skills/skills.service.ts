import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSkillDto } from './dto/skill.dto';

interface SkillUser {
    id: string;
    organizationId?: string | null;
}

@Injectable()
export class SkillsService {
    constructor(private prisma: PrismaService) {}

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
}
