import { BadRequestException } from '@nestjs/common';

jest.mock('../llm/llm.service', () => ({ LlmService: class LlmService {} }));
jest.mock('../queue/queue.service', () => ({ QueueService: class QueueService {} }));

import { GenerationService } from './generation.service';

describe('GenerationService cancellation', () => {
    const prisma = {
        presentationSkill: {
            findFirst: jest.fn(),
        },
        presentation: {
            create: jest.fn(),
        },
        generationJob: {
            findFirst: jest.fn(),
            update: jest.fn(),
            create: jest.fn(),
        },
    };
    const service = new GenerationService(prisma as any, {} as any, {} as any, {} as any);

    beforeEach(() => jest.clearAllMocks());

    it('cancels only the requesting user job', async () => {
        prisma.generationJob.findFirst.mockResolvedValue({ id: 'job-1', status: 'GENERATING_CONTENT' });

        await expect(service.cancelGeneration('job-1', 'user-1')).resolves.toEqual({ success: true });

        expect(prisma.generationJob.findFirst).toHaveBeenCalledWith({ where: { id: 'job-1', userId: 'user-1' } });
        expect(prisma.generationJob.update).toHaveBeenCalledWith({
            where: { id: 'job-1' },
            data: { status: 'CANCELLED' },
        });
    });

    it('does not cancel completed jobs', async () => {
        prisma.generationJob.findFirst.mockResolvedValue({ id: 'job-1', status: 'COMPLETED' });

        await expect(service.cancelGeneration('job-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.generationJob.update).not.toHaveBeenCalled();
    });

    it('applies an owned Skill guidance and its linked template to a generation job', async () => {
        const credits = { checkBalance: jest.fn().mockResolvedValue(true) };
        const queue = { addGenerationJob: jest.fn().mockResolvedValue(undefined) };
        const skillService = new GenerationService(prisma as any, {} as any, credits as any, queue as any);
        prisma.presentationSkill.findFirst.mockResolvedValue({
            id: 'skill-1',
            templateId: 'template-from-skill',
            outlineGuidance: '문제, 근거, 실행 계획 순서로 작성',
        });
        prisma.presentation.create.mockResolvedValue({ id: 'presentation-1' });
        prisma.generationJob.create.mockResolvedValue({ id: 'job-1' });

        await expect(skillService.startGeneration({ id: 'user-1' }, {
            sourceType: 'TEXT' as any,
            content: '2026년 사업 계획',
            slideCount: 10,
            skillId: 'skill-1',
        })).resolves.toMatchObject({ jobId: 'job-1', presentationId: 'presentation-1' });

        expect(prisma.presentationSkill.findFirst).toHaveBeenCalledWith({
            where: { id: 'skill-1', OR: [{ isPublic: true }, { userId: 'user-1' }] },
            select: { id: true, templateId: true, outlineGuidance: true },
        });
        expect(prisma.presentation.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ templateId: 'template-from-skill', skillId: 'skill-1' }),
        }));
        expect(prisma.generationJob.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ skillId: 'skill-1', input: expect.objectContaining({
                templateId: 'template-from-skill',
                skillGuidance: '문제, 근거, 실행 계획 순서로 작성',
            }) }),
        }));
    });

    it('allows selecting a Skill shared within the caller\'s organization', async () => {
        const credits = { checkBalance: jest.fn().mockResolvedValue(true) };
        const queue = { addGenerationJob: jest.fn().mockResolvedValue(undefined) };
        const skillService = new GenerationService(prisma as any, {} as any, credits as any, queue as any);
        prisma.presentationSkill.findFirst.mockResolvedValue({
            id: 'skill-org',
            templateId: null,
            outlineGuidance: null,
        });
        prisma.presentation.create.mockResolvedValue({ id: 'presentation-2' });
        prisma.generationJob.create.mockResolvedValue({ id: 'job-2' });

        await expect(skillService.startGeneration({ id: 'user-2', organizationId: 'org-1' }, {
            sourceType: 'TEXT' as any,
            content: '팀 공유 Skill 테스트',
            slideCount: 8,
            skillId: 'skill-org',
        })).resolves.toMatchObject({ jobId: 'job-2' });

        expect(prisma.presentationSkill.findFirst).toHaveBeenCalledWith({
            where: {
                id: 'skill-org',
                OR: [{ isPublic: true }, { userId: 'user-2' }, { organizationId: 'org-1' }],
            },
            select: { id: true, templateId: true, outlineGuidance: true },
        });
    });
});
