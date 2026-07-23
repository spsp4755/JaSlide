import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LlmService } from './llm.service';
import { PromptTemplateService } from './prompt-template.service';
import { PrismaService } from '../../prisma/prisma.service';

const openAiConstructor = jest.fn();
jest.mock('openai', () => ({
    __esModule: true,
    default: jest.fn().mockImplementation((config) => {
        openAiConstructor(config);
        return { chat: { completions: { create: jest.fn() } } };
    }),
}));

const outline = {
    title: '신규 서비스 제안',
    slides: [
        { order: 1, title: '제안 개요', type: 'TITLE', keyPoints: ['목표', '기대 효과'] },
        { order: 2, title: '실행 계획', type: 'CONTENT', keyPoints: ['분석', '출시'] },
    ],
};

describe('LlmService contracts', () => {
    let service: LlmService;

    const createService = async (responses: string[]) => {
        const client = {
            chat: {
                completions: {
                    create: jest.fn().mockImplementation(() => Promise.resolve({
                        choices: [{ message: { content: responses.shift() } }],
                    })),
                },
            },
        };

        const module = await Test.createTestingModule({
            providers: [
                LlmService,
                PromptTemplateService,
                { provide: ConfigService, useValue: {} },
                { provide: PrismaService, useValue: {} },
            ],
        }).compile();
        service = module.get(LlmService);
        jest.spyOn(service as any, 'getOpenAIClient').mockResolvedValue({ client, model: 'internal-model', maxTokens: 8192 });
        return client.chat.completions.create;
    };

    const createUnconfiguredService = async (config: Record<string, string>) => {
        const module = await Test.createTestingModule({
            providers: [
                LlmService,
                PromptTemplateService,
                { provide: ConfigService, useValue: { get: (key: string) => config[key] } },
                { provide: PrismaService, useValue: { llmModel: { findFirst: jest.fn().mockResolvedValue(null) } } },
            ],
        }).compile();
        return module.get(LlmService);
    };

    beforeEach(() => openAiConstructor.mockClear());

    it('uses the configured internal OpenAI-compatible endpoint when no database model is active', async () => {
        const unconfiguredService = await createUnconfiguredService({
            OPENAI_BASE_URL: 'https://llm.intranet.example/v1',
            OPENAI_MODEL: 'company-model',
            OPENAI_API_KEY: 'internal-placeholder',
        });

        await expect((unconfiguredService as any).getOpenAIClient()).resolves.toMatchObject({ model: 'company-model' });
        expect(openAiConstructor).toHaveBeenCalledWith({
            baseURL: 'https://llm.intranet.example/v1',
            apiKey: 'internal-placeholder',
        });
    });

    it('uses a placeholder key for an internal endpoint when OPENAI_API_KEY is omitted', async () => {
        const unconfiguredService = await createUnconfiguredService({
            OPENAI_BASE_URL: 'http://vllm.internal/v1',
            OPENAI_MODEL: 'internal-model',
        });

        await expect((unconfiguredService as any).getOpenAIClient()).resolves.toMatchObject({ model: 'internal-model' });
        expect(openAiConstructor).toHaveBeenCalledWith({
            baseURL: 'http://vllm.internal/v1',
            apiKey: 'not-needed',
        });
    });

    it('returns a valid Korean outline with exactly the requested slides', async () => {
        await createService([JSON.stringify(outline)]);

        await expect(service.generateOutline({ content: '신규 서비스 제안서', slideCount: 2, language: 'ko' }))
            .resolves.toEqual(outline);
    });

    it('repairs malformed outline JSON using one additional response', async () => {
        const create = await createService(['{not json', JSON.stringify(outline)]);

        await expect(service.generateOutline({ content: '신규 서비스 제안서', slideCount: 2, language: 'ko' }))
            .resolves.toEqual(outline);
        expect(create).toHaveBeenCalledTimes(2);
    });

    it('rejects an outline with a different slide count after retries', async () => {
        const invalid = { ...outline, slides: [outline.slides[0]] };
        const create = await createService([JSON.stringify(invalid), JSON.stringify(invalid), JSON.stringify(invalid), JSON.stringify(invalid)]);

        await expect(service.generateOutline({ content: '신규 서비스 제안서', slideCount: 2, language: 'ko' }))
            .rejects.toThrow('expected 2 slides');
        expect(create).toHaveBeenCalledTimes(4);
    });

    it('batches large outline requests instead of asking for every slide in one completion', async () => {
        const firstBatch = {
            title: '연간 사업 계획',
            slides: Array.from({ length: 6 }, (_, index) => ({
                order: index + 1, title: `1부-${index + 1}장`, type: 'CONTENT',
                keyPoints: ['핵심 포인트 A', '핵심 포인트 B'], templateIndex: index,
            })),
        };
        const secondBatch = {
            title: '무시됨',
            slides: Array.from({ length: 2 }, (_, index) => ({
                order: index + 1, title: `2부-${index + 1}장`, type: 'CONTENT',
                keyPoints: ['핵심 포인트 C', '핵심 포인트 D'], templateIndex: 10 + index,
            })),
        };
        const create = await createService([JSON.stringify(firstBatch), JSON.stringify(secondBatch)]);

        const result = await service.generateOutline({
            content: '긴 사업 계획서', slideCount: 8, language: 'ko', templateSlides: Array.from({ length: 20 }, (_, i) => `slide-${i}.html`),
        });

        // Two completions (6 + 2), not one 8-slide request.
        expect(create).toHaveBeenCalledTimes(2);
        // Merged and renumbered continuously across both batches.
        expect(result.title).toBe('연간 사업 계획');
        expect(result.slides).toHaveLength(8);
        expect(result.slides.map((slide) => slide.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        expect(result.slides[7].title).toBe('2부-2장');

        // The second batch's prompt carries forward context from the first, so the
        // model continues the narrative and spreads across the template instead of
        // repeating titles or reusing the same template pages.
        const secondPrompt = create.mock.calls[1][0].messages[1].content as string;
        expect(secondPrompt).toContain('continuation of a longer deck');
        expect(secondPrompt).toContain('1부-1장');
        expect(secondPrompt).toContain('0 (already used)');
    });

    it('coerces out-of-range bullet levels to 0 instead of rejecting', async () => {
        const reply = { heading: '실행 계획', bullets: [{ text: '첫 번째 항목', level: 2 }] };
        const create = await createService([JSON.stringify(reply)]);

        await expect(service.generateSlideContent({
            title: '실행 계획', type: 'CONTENT', keyPoints: ['분석'], language: 'ko',
        })).resolves.toEqual({ heading: '실행 계획', bullets: [{ text: '첫 번째 항목', level: 0 }] });
        expect(create).toHaveBeenCalledTimes(1);
    });

    it('drops unknown and malformed optional slide content fields', async () => {
        const reply = { heading: '실행 계획', body: 123, internalNotes: 'do not persist' };
        const create = await createService([JSON.stringify(reply)]);

        await expect(service.generateSlideContent({
            title: '실행 계획', type: 'CONTENT', keyPoints: ['분석'], language: 'ko',
        })).resolves.toEqual({ heading: '실행 계획' });
        expect(create).toHaveBeenCalledTimes(1);
    });

    it('asks for concise, scannable slide content rather than long prose', async () => {
        const reply = { heading: 'AI safety', body: 'Concrete explanation', bullets: [{ text: 'Specific finding', level: 0 }] };
        const create = await createService([JSON.stringify(reply)]);

        await service.generateSlideContent({
            title: 'AI safety', type: 'CONTENT', keyPoints: ['Risks'], language: 'en',
        });

        const prompt = create.mock.calls[0][0].messages[1].content as string;
        expect(prompt).toContain('scannable');
        expect(prompt).toContain('not a document');
    });

    it('edits a slide and returns the full validated content object (not a flat string)', async () => {
        const edited = { heading: '개선된 제목', bullets: [{ text: '간결한 항목', level: 0 }] };
        const create = await createService([JSON.stringify(edited)]);

        const result = await service.editSlideContent(
            { heading: '원래 제목', body: '너무 긴 줄글 내용...' },
            '더 간결하게 만들어줘',
            'CONTENT',
        );

        expect(result).toEqual(edited);
        expect(create).toHaveBeenCalledTimes(1);
    });

    it('shows chart JSON only for chart slides', () => {
        const prompts = new PromptTemplateService();

        expect(prompts.getSlideContentPrompt({ title: 'Text', type: 'CONTENT', keyPoints: ['Point'], language: 'en' })).not.toContain('"chart"');
        expect(prompts.getSlideContentPrompt({ title: 'Chart', type: 'CHART', keyPoints: ['Point'], language: 'en' })).toContain('"chart"');
    });

    it('keeps valid chart data for chart slides', async () => {
        const reply = { heading: 'ASR', chart: { labels: ['Before', 'After'], values: [48, 11], series: 'ASR' } };
        await createService([JSON.stringify(reply)]);

        await expect(service.generateSlideContent({
            title: 'ASR', type: 'CHART', keyPoints: ['Measured result'], language: 'en',
        })).resolves.toEqual(reply);
    });

    it('adds editable example data when a chart slide has no numeric source data', async () => {
        const reply = { heading: 'Risk reduction', bullets: [{ text: 'Replace these numbers with measured results', level: 0 }] };
        await createService([JSON.stringify(reply)]);

        await expect(service.generateSlideContent({
            title: 'Risk reduction', type: 'CHART', keyPoints: ['No metrics provided'], language: 'en',
        })).resolves.toMatchObject({
            heading: 'Risk reduction',
            chart: { labels: ['현재 수준', '개선 목표'], values: [60, 35], isExample: true },
        });
    });

    it('normalizes the nested chart format returned by the configured reasoning model', async () => {
        const reply = {
            slide: {
                heading: 'Risk reduction',
                bullets: ['Layer defenses', 'Monitor anomalies'],
                chart: {
                    label: 'Attack success rate',
                    xAxisLabels: ['Before', 'After'],
                    series: [{ name: 'ASR', values: [85, 25] }],
                    isExample: true,
                },
            },
        };
        await createService([JSON.stringify(reply)]);

        await expect(service.generateSlideContent({
            title: 'Risk reduction', type: 'CHART', keyPoints: ['No metrics provided'], language: 'en',
        })).resolves.toEqual({
            heading: 'Risk reduction',
            bullets: [{ text: 'Layer defenses', level: 0 }, { text: 'Monitor anomalies', level: 0 }],
            chart: { labels: ['Before', 'After'], values: [85, 25], series: 'ASR', isExample: true },
        });
    });

    it('reserves enough output tokens for reasoning-model outlines', async () => {
        const create = await createService([JSON.stringify(outline)]);

        await service.generateOutline({ content: 'AI security plan', slideCount: 2, language: 'en' });

        expect(create.mock.calls[0][0]).toMatchObject({ max_tokens: 8192 });
    });

    it('uses the admin-configured maxTokens for slide content instead of a hardcoded 4096', async () => {
        const reply = { heading: 'Risk reduction', body: 'Detailed content that a low token cap would truncate.' };
        const create = await createService([JSON.stringify(reply)]);

        await service.generateSlideContent({
            title: 'Risk reduction', type: 'CONTENT', keyPoints: ['Point'], language: 'en',
        });

        expect(create.mock.calls[0][0]).toMatchObject({ max_tokens: 8192 });
    });

    it('generates a complete HTML slide while preserving the template markup contract', async () => {
        const html = '<div class="slide-container"><main data-object="true">AI 보안</main></div>';
        await createService([JSON.stringify({ html })]);

        await expect(service.generateSlideHtml({
            templateHtml: '<div class="slide-container"><main data-object="true">Template</main></div>',
            title: 'AI 보안', type: 'CONTENT', keyPoints: ['위협을 식별한다'], language: 'ko',
        })).resolves.toBe(html);
    });
});
