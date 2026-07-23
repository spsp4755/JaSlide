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

export function preservesTemplateStructure(template: string, candidate: string): boolean {
    const count = (html: string, pattern: RegExp) => (html.match(pattern) || []).length;
    return count(candidate, /<table\b/gi) >= count(template, /<table\b/gi)
        && count(candidate, /<(?:td|th)\b/gi) >= count(template, /<(?:td|th)\b/gi)
        && count(candidate, /data-object\s*=\s*["']true["']/gi) >= count(template, /data-object\s*=\s*["']true["']/gi);
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
        const config = (template?.config as any) || {};
        const slides = config.zipTemplate?.slides;
        if (Array.isArray(slides)) return slides.filter((slide): slide is string => typeof slide === 'string');
        // PPTX imports store positioned HTML, not ZIP filenames.  Give the outline
        // model a compact text catalog so it can select the matching layout.
        return Array.isArray(config.htmlSlides)
            ? config.htmlSlides.filter((slide: unknown): slide is string => typeof slide === 'string').map((slide: string) =>
                slide.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180) || 'Visual layout')
            : [];
    }

    private async templateHtmlSlides(templateId?: string | null): Promise<string[]> {
        if (!templateId) return [];
        const template = await this.prisma.template.findUnique({ where: { id: templateId }, select: { config: true } });
        const slides = (template?.config as any)?.htmlSlides;
        return Array.isArray(slides) ? slides.filter((slide): slide is string => typeof slide === 'string' && slide.trim().length > 0) : [];
    }

    private automaticSlideCount(content: string): number {
        // ponytail: length heuristic; add an LLM planning pass only if content structure needs finer sizing.
        return Math.min(30, Math.max(1, Math.ceil(content.replace(/\s/g, '').length / 350)));
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
            slideCount: dto.slideCount ?? this.automaticSlideCount(guidedContent),
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
            const htmlTemplates = await this.templateHtmlSlides(input.templateId);

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
                const requestedTemplateIndex = Number.isInteger(slideOutline.templateIndex) ? slideOutline.templateIndex as number : -1;
                const templateIndex = htmlTemplates.length
                    ? (htmlTemplates[requestedTemplateIndex] ? requestedTemplateIndex : i % htmlTemplates.length)
                    : -1;
                let html = templateIndex >= 0 ? htmlTemplates[templateIndex] : undefined;
                if (html) {
                    try {
                        const generatedHtml = await this.llmService.generateSlideHtml({
                            templateHtml: htmlTemplates[templateIndex], title: slideOutline.title,
                            type: slideOutline.type, keyPoints: slideOutline.keyPoints, language,
                        });
                        html = preservesTemplateStructure(htmlTemplates[templateIndex], generatedHtml)
                            ? generatedHtml
                            : htmlTemplates[templateIndex];
                    } catch (error) {
                        this.logger.warn(`HTML generation failed for slide ${i + 1}; retaining the selected template`);
                    }
                }

                slides.push({
                    order: i,
                    type: slideOutline.type as any,
                    title: slideOutline.title,
                    content: { ...content, ...(html ? { html } : {}), ...(templateIndex >= 0 ? { templateIndex } : {}) } as unknown as Prisma.InputJsonValue,
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

    async aiEdit(userId: string, dto: AIEditDto, signal?: AbortSignal) {
        const slideIds = dto.slideIds?.length ? dto.slideIds : dto.slideId ? [dto.slideId] : [];
        if (!slideIds.length) {
            throw new BadRequestException('No slide specified');
        }

        const edits = await Promise.all(slideIds.map((id) => this.editOneSlide(userId, id, dto.instruction, signal)));
        if (signal?.aborted) throw new GenerationCancelledError();
        const slides = await Promise.all(edits.map(({ id, content }) => this.prisma.slide.update({ where: { id }, data: { content: content as any } })));

        return { success: true, slide: slides[0], slides };
    }

    private async editOneSlide(userId: string, slideId: string, instruction: string, signal?: AbortSignal) {
        const slide = await this.prisma.slide.findUnique({
            where: { id: slideId },
            include: { presentation: { select: { userId: true } } },
        });

        if (!slide || slide.presentation.userId !== userId) {
            throw new BadRequestException('Slide not found');
        }

        // editSlideContent returns the full validated slide object; store it directly.
        // (The old flow stringified then re-parsed a flat text reply, which always threw.)
        const currentContent = (slide.content ?? {}) as any;
        if (signal?.aborted) throw new GenerationCancelledError();
        const editedContent = typeof currentContent.html === 'string'
            ? { ...currentContent, html: await this.llmService.editSlideHtml(currentContent.html, instruction, signal) }
            : await this.llmService.editSlideContent(currentContent, instruction, slide.type, signal);
        if (signal?.aborted) throw new GenerationCancelledError();
        return { id: slideId, content: editedContent };
    }
}
