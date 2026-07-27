import { Injectable, Logger, BadRequestException, ServiceUnavailableException, OnModuleInit } from '@nestjs/common';
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

// Keep compact labels, but replace the long content regions that make a
// report/table template useful. Existing blank placeholders still work.
const isTableLabel = (text: string) => Boolean(text) && !text.includes('\n') && text.length <= 60;

export function populatePptxTableCells(cells: unknown, values: string[]): string[][] {
    if (!Array.isArray(cells)) return [];
    const rows = cells.map((row) => Array.isArray(row) ? row.map((cell) => typeof cell === 'string' ? cell.trim() : '') : []);
    // Spread the lines across every content cell. Handing each cell the whole
    // body plus a repeat of the same key points filled a 실적/계획 table with
    // duplicate text in both columns.
    const lines = values.filter(Boolean);
    const slots = rows.flat().filter((text) => !isTableLabel(text)).length;
    const size = Math.ceil(lines.length / Math.max(slots, 1)) || 1;
    const chunks = Array.from({ length: slots }, (_, index) => lines.slice(index * size, index * size + size).join('\n'));
    return rows.map((row) => row.map((text) => isTableLabel(text) ? text : (chunks.shift() ?? text)));
}

/**
 * Template slides that can actually hold generated content.
 *
 * A PPTX slide whose objects are all pictures — a full-bleed screenshot, a
 * diagram page — is artwork, not a layout. Offering it as one meant the outline
 * model picked it, the generator found nothing to write into, and a synthesized
 * text box got stamped across the picture. A ZIP template has no object map and
 * every slide stays eligible.
 */
export function contentCapableTemplateIndexes(pptxSlides: any[] | undefined | null, total: number): number[] {
    const all = Array.from({ length: total }, (_, index) => index);
    if (!Array.isArray(pptxSlides)) return all;
    const usable = all.filter((index) => (pptxSlides[index]?.objects || [])
        .some((object: any) => object?.kind === 'text' || object?.kind === 'table'));
    // A deck of nothing but pictures leaves nothing to choose; keep the whole
    // list so generation still produces slides rather than none.
    return usable.length ? usable : all;
}

/** Honour the outline's layout choice, but only among slides that can hold content. */
export function selectTemplateIndex(requested: number, order: number, capable: number[]): number {
    if (!capable.length) return -1;
    return capable.includes(requested) ? requested : capable[order % capable.length];
}

// A date range in any of the separators a Korean report actually uses.
const DATE_RANGE = /\d{4}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2}\s*[~\-–—]\s*\d{4}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2}/g;

/** Every date range in a text, in the order it appears. */
export function dateRangesIn(text: string): string[] {
    return [...(text || '').matchAll(DATE_RANGE)].map((match) => match[0].replace(/\s+/g, ''));
}

/**
 * Point a table's period labels at the period being reported on.
 *
 * A label cell is copied from the template so headings like "추진실적" survive,
 * but a weekly report writes the week into that same cell — and the template's
 * week is whenever its author last saved it. Swap in the ranges the model read
 * out of the source, in order, and leave the label's wording alone. A label
 * with no date, or a deck the model found no dates in, is untouched.
 */
export function retargetTableDates(cells: string[][], ranges: string[]): string[][] {
    if (!ranges.length) return cells;
    let next = 0;
    return cells.map((row) => row.map((text) => {
        if (!isTableLabel(text) || !DATE_RANGE.test(text)) return text;
        DATE_RANGE.lastIndex = 0;
        const replacement = ranges[next++];
        return replacement ? text.replace(DATE_RANGE, replacement) : text;
    }));
}

/** Map a PPTX template slide's native objects onto the generated content. */
export function pptxObjectEdits(objects: any[], slide: number, title: string, lines: string[], periods: string[] = []) {
    // Biggest type is the slide's real heading; source order puts small corner
    // labels (a team name, a page marker) first.
    const texts = objects.filter((item) => item?.kind === 'text').sort((a, b) => (b.fontSize || 0) - (a.fontSize || 0));
    const tables = objects.filter((item) => item?.kind === 'table');
    // A table owns its cell text; writing the body into a text box too would
    // duplicate the content on top of the table.
    const edits: Record<string, unknown>[] = [
        ...texts.slice(0, tables.length ? 1 : 2).map((item, index) => ({ objectId: item.id, slide, text: index === 0 ? title : lines.join('\n') })),
        ...tables.map((item) => ({
            objectId: item.id, slide,
            cells: retargetTableDates(populatePptxTableCells(item.cells, lines), periods),
        })),
    ];
    if (edits.length) return edits;

    // Some template slides carry no editable text at all — a full-bleed screenshot, or
    // a design whose words are baked into images. Those slides used to come back
    // untouched, silently dropping the generated content. Add a text box instead.
    return [{
        objectId: `generated-title-${slide}`, slide, kind: 'text', addText: title,
        text: [title, ...lines].join('\n'),
        left: 140, top: 120, width: 1640, height: lines.length ? 560 : 200,
        fontSize: 34, color: '#1A1A1A',
    }];
}

function presentationText(content: { body?: string; bullets?: { text: string; level?: number }[] }, keyPoints: string[]) {
    if (content.bullets?.length) {
        return content.bullets.map((bullet) => `${'  '.repeat(Math.max(0, bullet.level || 0))}• ${bullet.text}`).join('\n');
    }
    return content.body || keyPoints.map((point) => `• ${point}`).join('\n');
}

function removePromptEcho(value: string | undefined, instruction: string): string | undefined {
    if (!value) return value;
    const normalizedInstruction = instruction.replace(/\s+/g, ' ').trim();
    const cleaned = value.split('\n').filter((line) => line.replace(/\s+/g, ' ').trim() !== normalizedInstruction).join('\n').trim();
    return cleaned || undefined;
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
        try {
            return await this.llmService.generateOutline({
                content: guidedContent,
                slideCount: dto.slideCount ?? this.automaticSlideCount(guidedContent),
                language,
                style: dto.options?.style,
                templateSlides,
            });
        } catch (error) {
            // An LLM that is unreachable or misconfigured surfaced as a bare 500
            // "Internal server error", which tells the user nothing they can act on.
            this.logger.error(`Outline generation failed: ${(error as Error).message}`);
            throw new ServiceUnavailableException(`아웃라인을 생성하지 못했습니다: ${(error as Error).message}`);
        }
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
            const templateConfig = input.templateId
                ? (await this.prisma.template.findUnique({ where: { id: input.templateId }, select: { config: true } }))?.config as any
                : null;
            const pptxSource = templateConfig?.source?.kind === 'pptx' ? templateConfig.source : null;
            const capableTemplates = contentCapableTemplateIndexes(pptxSource?.slides, htmlTemplates.length);
            // The periods this deck reports on, as the model read them out of the
            // source. A template's own period labels are whenever its author last
            // saved it, so a weekly report has to point them at this week.
            const periods = dateRangesIn([
                outline.slides.map((item) => `${item.title}\n${(item.keyPoints || []).join('\n')}`).join('\n'),
                input.content,
            ].join('\n'));

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
                const templateIndex = selectTemplateIndex(requestedTemplateIndex, i, capableTemplates);
                // PPTX has its own object map and renderer preview. Keeping the
                // extracted HTML here makes the editor choose the lossy HTML path.
                let html = !pptxSource && templateIndex >= 0 ? htmlTemplates[templateIndex] : undefined;
                const objects = pptxSource?.slides?.[templateIndex]?.objects || [];
                const richText = presentationText(content, slideOutline.keyPoints);
                const objectEdits = pptxSource
                    ? pptxObjectEdits(objects, templateIndex, slideOutline.title, richText.split('\n'), periods)
                    : [];
                if (html && !pptxSource) {
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
                    content: { ...content, ...(html ? { html } : {}), ...(objectEdits.length ? { objectEdits } : {}), ...(templateIndex >= 0 ? { templateIndex } : {}) } as unknown as Prisma.InputJsonValue,
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

    /** Generation already refuses an LLM rewrite that drops the deck's data-object
     * markup or table cells; the per-slide AI edit did not, so one edit could leave a
     * slide whose objects the editor can no longer select and whose text an editable
     * export silently omits. Keep the previous HTML in that case. */
    private keepStructure(previous: string, edited: string, slideId: string): string {
        if (typeof edited === 'string' && preservesTemplateStructure(previous, edited)) return edited;
        this.logger.warn(`AI edit dropped slide structure for ${slideId}; retaining the previous HTML`);
        return previous;
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
            ? { ...currentContent, html: this.keepStructure(currentContent.html, await this.llmService.editSlideHtml(currentContent.html, instruction, signal), slideId) }
            : await this.llmService.editSlideContent(currentContent, instruction, slide.type, signal);
        if (typeof editedContent.heading === 'string') editedContent.heading = removePromptEcho(editedContent.heading, instruction);
        if (typeof editedContent.body === 'string') editedContent.body = removePromptEcho(editedContent.body, instruction);
        if (Array.isArray(editedContent.bullets)) editedContent.bullets = editedContent.bullets.filter((item: any) => removePromptEcho(item.text, instruction)).map((item: any) => ({ ...item, text: removePromptEcho(item.text, instruction) }));
        if (Array.isArray(currentContent.objectEdits)) {
            const text = [editedContent.heading, presentationText(editedContent, [])];
            let index = 0;
            return {
                id: slideId,
                content: {
                    ...currentContent,
                    ...editedContent,
                    objectEdits: currentContent.objectEdits.map((item: any) => typeof item.text === 'string'
                        ? { ...item, text: text[Math.min(index++, text.length - 1)] }
                        : Array.isArray(item.cells) ? { ...item, cells: populatePptxTableCells(item.cells, [presentationText(editedContent, [])]) }
                            : item),
                },
            };
        }
        if (signal?.aborted) throw new GenerationCancelledError();
        return { id: slideId, content: editedContent };
    }
}
