import { BadRequestException } from '@nestjs/common';

jest.mock('../llm/llm.service', () => ({ LlmService: class LlmService {} }));
jest.mock('../queue/queue.service', () => ({ QueueService: class QueueService {} }));

import { GenerationService } from './generation.service';
import { defaultLayoutForSlideType, preservesTemplateStructure } from './generation.service';

describe('GenerationService cancellation', () => {
    const prisma = {
        template: {
            findUnique: jest.fn().mockResolvedValue(null),
        },
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
    const service = new GenerationService(prisma as any, {} as any, {} as any);

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
        const queue = { addGenerationJob: jest.fn().mockResolvedValue(undefined) };
        const skillService = new GenerationService(prisma as any, {} as any, queue as any);
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
        const queue = { addGenerationJob: jest.fn().mockResolvedValue(undefined) };
        const skillService = new GenerationService(prisma as any, {} as any, queue as any);
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

    it('validates an edited outline and sizes the job by its slide count', async () => {
        const llm = { validateClientOutline: jest.fn((outline) => outline) };
        const queue = { addGenerationJob: jest.fn().mockResolvedValue(undefined) };
        const svc = new GenerationService(prisma as any, llm as any, queue as any);
        prisma.presentation.create.mockResolvedValue({ id: 'presentation-3' });
        prisma.generationJob.create.mockResolvedValue({ id: 'job-3' });
        const outline = {
            title: '검토된 제목',
            slides: [
                { order: 1, title: 'a', type: 'CONTENT', keyPoints: ['x'] },
                { order: 2, title: 'b', type: 'CONTENT', keyPoints: ['y'] },
            ],
        };

        await svc.startGeneration({ id: 'user-1' }, {
            sourceType: 'TEXT' as any,
            content: '내용',
            slideCount: 10,
            outline: outline as any,
        });

        expect(llm.validateClientOutline).toHaveBeenCalledWith(outline);
        expect(prisma.generationJob.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                input: expect.objectContaining({ slideCount: 2, outline }),
            }),
        }));
    });

    it('generateOutline rejects empty content', async () => {
        const svc = new GenerationService(prisma as any, {} as any, {} as any);
        await expect(svc.generateOutline({ id: 'user-1' }, { content: '   ' } as any))
            .rejects.toBeInstanceOf(BadRequestException);
    });

    it('generateOutline detects language and delegates to the LLM', async () => {
        const llm = {
            detectLanguage: jest.fn().mockResolvedValue('ko'),
            generateOutline: jest.fn().mockResolvedValue({ title: 'T', slides: [] }),
        };
        const svc = new GenerationService(prisma as any, llm as any, {} as any);

        await svc.generateOutline({ id: 'user-1' }, { content: '발표 내용', slideCount: 8 } as any);

        expect(llm.generateOutline).toHaveBeenCalledWith(expect.objectContaining({
            content: '발표 내용', slideCount: 8, language: 'ko',
        }));
    });

    it('sizes an automatic outline from the source length instead of forcing ten slides', async () => {
        const llm = {
            detectLanguage: jest.fn().mockResolvedValue('ko'),
            generateOutline: jest.fn().mockResolvedValue({ title: 'T', slides: [] }),
        };
        const svc = new GenerationService(prisma as any, llm as any, {} as any);

        await svc.generateOutline({ id: 'user-1' }, { content: '가'.repeat(1400) } as any);

        expect(llm.generateOutline).toHaveBeenCalledWith(expect.objectContaining({ slideCount: 4 }));
    });

    it('uses a deterministic layout instead of a second LLM call per slide', () => {
        expect(defaultLayoutForSlideType('TWO_COLUMN')).toBe('two-column');
        expect(defaultLayoutForSlideType('CONTENT')).toBe('center');
    });

    it('rejects generated HTML that drops a template table', () => {
        const template = '<main class="slide-container"><div data-object="true"><table><tr><td>기존 값</td></tr></table></div></main>';
        const stripped = '<main class="slide-container"><h1>새 제목</h1></main>';

        expect(preservesTemplateStructure(template, stripped)).toBe(false);
    });

    it('uses PPTX HTML slides as the outline template catalog', async () => {
        prisma.template.findUnique.mockResolvedValue({
            config: { htmlSlides: ['<div class="slide-container"><div>주간 업무 보고</div></div>'] },
        });
        const llm = {
            detectLanguage: jest.fn().mockResolvedValue('ko'),
            generateOutline: jest.fn().mockResolvedValue({ title: '주간 보고', slides: [] }),
        };
        const svc = new GenerationService(prisma as any, llm as any, {} as any);

        await svc.generateOutline({ id: 'user-1' }, { content: '이번 주 업무 보고', templateId: 'pptx-template' } as any);

        expect(llm.generateOutline).toHaveBeenCalledWith(expect.objectContaining({
            templateSlides: ['주간 업무 보고'],
        }));
    });

    it('falls back to a PPTX template when the outline omits templateIndex', async () => {
        const pipelinePrisma = {
            generationJob: {
                findUnique: jest.fn()
                    .mockResolvedValueOnce({
                        id: 'job-html', status: 'QUEUED', presentationId: 'presentation-html', input: {
                            content: '주간 보고', slideCount: 1, language: 'ko', templateId: 'template-html',
                        },
                    })
                    .mockResolvedValueOnce({ status: 'GENERATING_CONTENT' }),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                update: jest.fn(),
            },
            template: { findUnique: jest.fn().mockResolvedValue({ config: { htmlSlides: ['<main class="slide-container"><h1>기존 보고서</h1></main>'] } }) },
            slide: { deleteMany: jest.fn(), create: jest.fn().mockResolvedValue({ id: 'slide-1' }) },
            presentation: { update: jest.fn() },
            $transaction: jest.fn().mockResolvedValue([]),
        };
        const llm = {
            generateOutline: jest.fn().mockResolvedValue({ title: '주간 보고', slides: [{ title: '이번 주 업무', type: 'CONTENT', keyPoints: ['성과'] }] }),
            generateSlideContent: jest.fn().mockResolvedValue({ heading: '이번 주 업무' }),
            generateSlideHtml: jest.fn().mockResolvedValue('<main class="slide-container"><h1>이번 주 업무</h1></main>'),
        };
        const svc = new GenerationService(pipelinePrisma as any, llm as any, {} as any);

        await svc.processGeneration('job-html');

        expect(llm.generateSlideHtml).toHaveBeenCalledWith(expect.objectContaining({ templateHtml: '<main class="slide-container"><h1>기존 보고서</h1></main>' }));
        expect(pipelinePrisma.slide.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ content: expect.objectContaining({ templateIndex: 0 }) }) }));
    });

    it('persists HTML generated from the template selected by the outline', async () => {
        const createdSlide = { id: 'slide-1' };
        const pipelinePrisma = {
            generationJob: {
                findUnique: jest.fn()
                    .mockResolvedValueOnce({
                        id: 'job-html', status: 'QUEUED', presentationId: 'presentation-html', input: {
                            content: 'AI 보안 대응 전략', slideCount: 1, language: 'ko', templateId: 'template-html',
                        },
                    })
                    .mockResolvedValueOnce({ status: 'GENERATING_CONTENT' }),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                update: jest.fn(),
            },
            template: {
                findUnique: jest.fn().mockResolvedValue({
                    config: { htmlSlides: ['<main class="slide-container"><h1>원본 제목</h1></main>'] },
                }),
            },
            slide: { deleteMany: jest.fn(), create: jest.fn().mockResolvedValue(createdSlide) },
            presentation: { update: jest.fn() },
            $transaction: jest.fn().mockResolvedValue([]),
        };
        const llm = {
            detectLanguage: jest.fn().mockResolvedValue('ko'),
            generateOutline: jest.fn().mockResolvedValue({
                title: 'AI 보안 대응 전략',
                slides: [{ title: '위협 모델', type: 'CONTENT', keyPoints: ['공격 표면'], templateIndex: 0 }],
            }),
            generateSlideContent: jest.fn().mockResolvedValue({ body: '구조화된 보조 콘텐츠' }),
            generateSlideHtml: jest.fn().mockResolvedValue('<main class="slide-container"><h1>AI 위협 모델</h1></main>'),
        };
        const svc = new GenerationService(pipelinePrisma as any, llm as any, {} as any);

        await svc.processGeneration('job-html');

        expect(llm.generateSlideHtml).toHaveBeenCalledWith(expect.objectContaining({
            templateHtml: '<main class="slide-container"><h1>원본 제목</h1></main>',
            title: '위협 모델',
        }));
        expect(pipelinePrisma.slide.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                content: expect.objectContaining({
                    html: '<main class="slide-container"><h1>AI 위협 모델</h1></main>',
                    templateIndex: 0,
                }),
            }),
        }));
    });

    it('uses the HTML edit path and retains the slide metadata', async () => {
        const updated = { id: 'slide-html' };
        const editPrisma = {
            slide: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 'slide-html', type: 'CONTENT', content: { html: '<main>before</main>', templateIndex: 3 },
                    presentation: { userId: 'user-1' },
                }),
                update: jest.fn().mockResolvedValue(updated),
            },
        };
        const llm = { editSlideHtml: jest.fn().mockResolvedValue('<main>after</main>') };
        const svc = new GenerationService(editPrisma as any, llm as any, {} as any);

        await expect(svc.aiEdit('user-1', { slideId: 'slide-html', instruction: '제목을 바꿔줘' } as any)).resolves.toEqual({
            success: true, slide: updated, slides: [updated],
        });

        expect(llm.editSlideHtml).toHaveBeenCalledWith('<main>before</main>', '제목을 바꿔줘', undefined);
        expect(editPrisma.slide.update).toHaveBeenCalledWith({
            where: { id: 'slide-html' },
            data: { content: { html: '<main>after</main>', templateIndex: 3 } },
        });
    });
});
