import { BadRequestException } from '@nestjs/common';
import { SkillsService } from './skills.service';

describe('SkillsService', () => {
    const prisma = {
        presentationSkill: {
            create: jest.fn(),
            findMany: jest.fn(),
        },
    };
    const service = new SkillsService(prisma as any);
    const user = { id: 'user-1', organizationId: 'org-1' };

    beforeEach(() => jest.clearAllMocks());

    it('lists public, own, and own-organization skills only', async () => {
        prisma.presentationSkill.findMany.mockResolvedValue([]);

        await expect(service.findVisible(user, 'BUSINESS')).resolves.toEqual([]);

        expect(prisma.presentationSkill.findMany).toHaveBeenCalledWith({
            where: {
                AND: [
                    { OR: [{ isPublic: true }, { userId: 'user-1' }, { organizationId: 'org-1' }] },
                    { category: 'BUSINESS' },
                ],
            },
            orderBy: { name: 'asc' },
        });
    });

    it('rejects unsupported executable package fields', async () => {
        await expect(service.create(user, {
            name: '임원 보고',
            category: 'BUSINESS',
            audience: '임원',
            tone: 'formal',
            purpose: '분기 실적 보고',
            outlineGuidance: '핵심 지표부터 제시한다.',
            recommendedSlideCount: 8,
            packageUrl: 'skill.zip',
        } as any)).rejects.toBeInstanceOf(BadRequestException);
    });
});
