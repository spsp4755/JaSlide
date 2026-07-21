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

    it('asks for substantive slide content rather than repeating short key points', async () => {
        const reply = { heading: 'AI safety', body: 'Concrete explanation', bullets: [{ text: 'Specific finding', level: 0 }] };
        const create = await createService([JSON.stringify(reply)]);

        await service.generateSlideContent({
            title: 'AI safety', type: 'CONTENT', keyPoints: ['Risks'], language: 'en',
        });

        expect(create.mock.calls[0][0].messages[1].content).toContain('substantive, self-contained explanation');
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
});
