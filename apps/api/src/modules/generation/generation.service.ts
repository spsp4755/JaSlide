import { Injectable, Logger, BadRequestException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { StartGenerationDto, AIEditDto, GenerateOutlineDto } from './dto/generation.dto';
import type { Prisma } from '@prisma/client';
import { QueueService } from '../queue/queue.service';

class GenerationCancelledError extends Error { }

export function defaultLayoutForSlideType(type: string): string {
    return type === 'TWO_COLUMN' ? 'two-column' : 'center';
}

@Injectable()
export class GenerationService implements OnModuleInit {
    private readonly logger = new Logger(GenerationService.name);

    constructor(
        private prisma: PrismaService,
        private llmService: LlmService,
        private queueService: QueueService,
    ) { }

    async onModuleInit() {
        this.queueService.registerGenerationProcessor((jobId) => this.processGeneration(jobId));
        const queuedJobs = await this.prisma.generationJob.findMany({
            where: { status: 'QUEUED' },
            select: { id: true },
        });
        await Promise.all(queuedJobs.map(async ({ id }) => {
            try {
                await this.queueService.addGenerationJob(id);
            } catch (error) {
                this.logger.error(`Could not recover generation job ${id}`, error);
            }
        }));
    }

    private async resolveSkill(user: { id: string; organizationId?: string | null }, skillId?: string) {
        if (!skillId) return null;
        const skill = await this.prisma.presentationSkill.findFirst({
            where: {
                id: skillId,
                OR: [
                    { isPublic: true },
                    { userId: user.id },
                    ...(user.organizationId ? [{ organizationId: user.organizationId }] : []),
                ],
            },
            select: { id: true, templateId: true, outlineGuidance: true },
        });
        if (!skill) {
            throw new BadRequestException('Skill not found');
        }
        return skill;
    }

    private async templateSlides(templateId?: string | null): Promise<string[]> {
        if (!templateId) return [];
        const template = await this.prisma.template.findUnique({ where: { id: templateId }, select: { config: true } });
        const slides = (template?.config as any)?.zipTemplate?.slides;
        return Array.isArray(slides) ? slides.filter((slide): slide is string => typeof slide === 'string') : [];
    }

    // Reused outline generation shared by the outline endpoint and (implicitly) the pipeline.
    async generateOutline(user: { id: string; organizationId?: string | null }, dto: GenerateOutlineDto) {
        if (!dto.content?.trim()) {
            throw new BadRequestException('Content is required');
        }
        const skill = await this.resolveSkill(user, dto.skillId);
        const templateSlides = await this.templateSlides(dto.templateId ?? skill?.templateId);
        const guidedContent = skill?.outlineGuidance
            ? `${dto.content}\n\n[작성 Skill 가이드]\n${skill.outlineGuidance}`
            : dto.content;
        const language = dto.language || (await this.llmService.detectLanguage(guidedContent));
        return this.llmService.generateOutline({
            content: guidedContent,
            slideCount: dto.slideCount ?? 10,
            language,
            style: dto.options?.style,
            templateSlides,
        });
    }

    async startGeneration(user: { id: string; organizationId?: string | null }, dto: StartGenerationDto) {
        const userId = user.id;

        // An edited outline reflects the user's final choices; reject it up front
        // rather than failing mid-job during content generation.
        const approvedOutline = dto.outline
            ? this.llmService.validateClientOutline(dto.outline)
            : null;
        const effectiveSlideCount = approvedOutline?.slides.length ?? dto.slideCount;

        const skill = await this.resolveSkill(user, dto.skillId);
        const templateId = dto.templateId ?? skill?.templateId;
        const templateSlides = await this.templateSlides(templateId);

        // Create presentation
        const presentation = await this.prisma.presentation.create({
            data: {
                title: dto.title || 'New Presentation',
                userId,
                sourceType: dto.sourceType,
                sourceContent: dto.content,
                templateId,
                skillId: skill?.id,
                status: 'GENERATING',
            },
        });

        // Create generation job
        const job = await this.prisma.generationJob.create({
            data: {
                userId,
                presentationId: presentation.id,
                status: 'QUEUED',
                input: {
                    sourceType: dto.sourceType,
                    content: dto.content,
                    slideCount: effectiveSlideCount,
                    language: dto.language || 'ko',
                    templateId,
                    templateSlides,
                    skillGuidance: skill?.outlineGuidance,
                    options: dto.options,
                    outline: approvedOutline ?? undefined,
                } as Prisma.InputJsonValue,
                skillId: skill?.id,
                progress: 0,
            },
        });

        await this.queueService.addGenerationJob(job.id);

        return {
            jobId: job.id,
            presentationId: presentation.id,
            status: 'QUEUED',
        };
    }

    async getJobStatus(jobId: string, userId: string) {
        const job = await this.prisma.generationJob.findFirst({
            where: { id: jobId, userId },
            include: {
                presentation: {
                    include: {
                        slides: { orderBy: { order: 'asc' } },
                    },
                },
            },
        });

        if (!job) {
            throw new BadRequestException('Job not found');
        }

        return {
            id: job.id,
            status: job.status,
            progress: job.progress,
            error: job.error,
            presentation: job.status === 'COMPLETED' ? job.presentation : null,
        };
    }

    async cancelGeneration(jobId: string, userId: string) {
        const job = await this.prisma.generationJob.findFirst({ where: { id: jobId, userId } });
        if (!job) throw new BadRequestException('Job not found');
        if (job.status === 'COMPLETED' || job.status === 'FAILED') {
            throw new BadRequestException('Completed jobs cannot be cancelled');
        }

        await this.prisma.generationJob.update({
            where: { id: jobId },
            data: { status: 'CANCELLED' },
        });
        return { success: true };
    }

    async processGeneration(jobId: string) {
        const job = await this.prisma.generationJob.findUnique({
            where: { id: jobId },
        });

        if (!job || job.status === 'COMPLETED' || job.status === 'CANCELLED') return;

        const input = job.input as any;
        const guidedContent = input.skillGuidance
            ? `${input.content}\n\n[작성 Skill 가이드]\n${input.skillGuidance}`
            : input.content;

        try {
            // Update status: Generating outline
            await this.updateJobStatus(jobId, 'GENERATING_OUTLINE', 10);

            // Detect language if not specified
            const language = input.language || (await this.llmService.detectLanguage(guidedContent));

            // Use the user-approved outline when present; otherwise generate one.
            const outline = input.outline
                ? this.llmService.validateClientOutline(input.outline)
                : await this.llmService.generateOutline({
                    content: guidedContent,
                    slideCount: input.slideCount,
                    language,
                    style: input.options?.style,
                    templateSlides: input.templateSlides,
                });

            await this.updateJobStatus(jobId, 'GENERATING_CONTENT', 30);

            // Generate content for each slide
            const slides = [];
            for (let i = 0; i < outline.slides.length; i++) {
                const slideOutline = outline.slides[i];

                const content = await this.llmService.generateSlideContent({
                    title: slideOutline.title,
                    type: slideOutline.type,
                    keyPoints: slideOutline.keyPoints,
                    language,
                });

                slides.push({
                    order: i,
                    type: slideOutline.type as any,
                    title: slideOutline.title,
                    content: { ...content, ...(Number.isInteger(slideOutline.templateIndex) ? { templateIndex: slideOutline.templateIndex } : {}) } as unknown as Prisma.InputJsonValue,
                    layout: defaultLayoutForSlideType(slideOutline.type),
                });

                // Update progress
                const progress = 30 + Math.floor((i + 1) / outline.slides.length * 50);
                await this.updateJobStatus(jobId, 'GENERATING_CONTENT', progress);
            }

            await this.updateJobStatus(jobId, 'APPLYING_DESIGN', 85);
            await this.assertNotCancelled(jobId);

            // Update presentation with title and create slides
            await this.prisma.$transaction([
                this.prisma.slide.deleteMany({ where: { presentationId: job.presentationId! } }),
                this.prisma.presentation.update({
                    where: { id: job.presentationId! },
                    data: {
                        title: outline.title,
                        status: 'COMPLETED',
                        metadata: { outline: outline.slides },
                    },
                }),
                ...slides.map((slide) =>
                    this.prisma.slide.create({
                        data: {
                            presentationId: job.presentationId!,
                            ...slide,
                        },
                    }),
                ),
            ]);

            await this.updateJobStatus(jobId, 'COMPLETED', 100);
        } catch (error) {
            if (error instanceof GenerationCancelledError) return;
            this.logger.error('Generation failed', error);

            await this.prisma.generationJob.update({
                where: { id: jobId },
                data: {
                    status: 'FAILED',
                    error: { message: (error as Error).message },
                },
            });

            await this.prisma.presentation.update({
                where: { id: job.presentationId! },
                data: { status: 'FAILED' },
            });
        }
    }

    private async updateJobStatus(jobId: string, status: string, progress: number) {
        const result = await this.prisma.generationJob.updateMany({
            where: { id: jobId, status: { not: 'CANCELLED' } },
            data: { status: status as any, progress },
        });
        if (result.count === 0) throw new GenerationCancelledError();
    }

    private async assertNotCancelled(jobId: string) {
        const job = await this.prisma.generationJob.findUnique({
            where: { id: jobId },
            select: { status: true },
        });
        if (!job || job.status === 'CANCELLED') throw new GenerationCancelledError();
    }

    async aiEdit(userId: string, dto: AIEditDto) {
        // Get current slide content
        const slide = await this.prisma.slide.findUnique({
            where: { id: dto.slideId },
            include: { presentation: { select: { userId: true } } },
        });

        if (!slide || slide.presentation.userId !== userId) {
            throw new BadRequestException('Slide not found');
        }

        // Apply AI edit
        const currentContent = JSON.stringify(slide.content);
        const editedContent = await this.llmService.editContent(currentContent, dto.instruction);

        // Update slide
        const updatedSlide = await this.prisma.slide.update({
            where: { id: dto.slideId },
            data: { content: JSON.parse(editedContent) },
        });

        return {
            success: true,
            slide: updatedSlide,
        };
    }
}
