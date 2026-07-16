import { Injectable, Logger, BadRequestException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { CreditsService } from '../credits/credits.service';
import { StartGenerationDto, AIEditDto } from './dto/generation.dto';
import { CREDIT_COSTS } from '@jaslide/shared';
import type { Prisma } from '@prisma/client';
import { QueueService } from '../queue/queue.service';

class GenerationCancelledError extends Error { }

@Injectable()
export class GenerationService implements OnModuleInit {
    private readonly logger = new Logger(GenerationService.name);

    constructor(
        private prisma: PrismaService,
        private llmService: LlmService,
        private creditsService: CreditsService,
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

    async startGeneration(userId: string, dto: StartGenerationDto) {
        // Estimate cost
        const estimatedCost = dto.slideCount * CREDIT_COSTS.SLIDE_BASIC;

        // Check credits
        const hasCredits = await this.creditsService.checkBalance(userId, estimatedCost);
        if (!hasCredits) {
            throw new BadRequestException('Insufficient credits');
        }

        // Create presentation
        const presentation = await this.prisma.presentation.create({
            data: {
                title: dto.title || 'New Presentation',
                userId,
                sourceType: dto.sourceType,
                sourceContent: dto.content,
                templateId: dto.templateId,
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
                    slideCount: dto.slideCount,
                    language: dto.language || 'ko',
                    templateId: dto.templateId,
                    options: dto.options,
                } as Prisma.InputJsonValue,
                progress: 0,
                creditsCost: estimatedCost,
            },
        });

        await this.queueService.addGenerationJob(job.id);

        return {
            jobId: job.id,
            presentationId: presentation.id,
            status: 'QUEUED',
            estimatedCost,
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

        try {
            // Update status: Generating outline
            await this.updateJobStatus(jobId, 'GENERATING_OUTLINE', 10);

            // Detect language if not specified
            const language = input.language || (await this.llmService.detectLanguage(input.content));

            // Generate outline
            const outline = await this.llmService.generateOutline({
                content: input.content,
                slideCount: input.slideCount,
                language,
                style: input.options?.style,
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

                // Suggest layout
                const layout = await this.llmService.suggestLayout(content, slideOutline.type);

                slides.push({
                    order: i,
                    type: slideOutline.type as any,
                    title: slideOutline.title,
                    content: content as unknown as Prisma.InputJsonValue,
                    layout,
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

            // Deduct credits
            await this.creditsService.deductCredits(
                job.userId,
                job.creditsCost,
                'USAGE',
                `Generated presentation with ${slides.length} slides`,
                job.presentationId ?? undefined,
            );

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

        // Check credits for AI edit
        const hasCredits = await this.creditsService.checkBalance(userId, CREDIT_COSTS.AI_EDIT_SIMPLE);
        if (!hasCredits) {
            throw new BadRequestException('Insufficient credits');
        }

        // Apply AI edit
        const currentContent = JSON.stringify(slide.content);
        const editedContent = await this.llmService.editContent(currentContent, dto.instruction);

        // Update slide
        const updatedSlide = await this.prisma.slide.update({
            where: { id: dto.slideId },
            data: { content: JSON.parse(editedContent) },
        });

        // Deduct credits
        await this.creditsService.deductCredits(
            userId,
            CREDIT_COSTS.AI_EDIT_SIMPLE,
            'USAGE',
            `AI edit on slide`,
            dto.slideId,
        );

        return {
            success: true,
            slide: updatedSlide,
        };
    }
}
