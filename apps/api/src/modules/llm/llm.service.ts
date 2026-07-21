import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PromptTemplateService } from './prompt-template.service';
import { PrismaService } from '../../prisma/prisma.service';

export interface GenerateOutlineInput {
    content: string;
    slideCount: number;
    language: string;
    style?: string;
    templateSlides?: string[];
}

export interface SlideOutline {
    title: string;
    slides: {
        order: number;
        title: string;
        type: string;
        keyPoints: string[];
        templateIndex?: number;
    }[];
}

export interface GenerateSlideContentInput {
    title: string;
    type: string;
    keyPoints: string[];
    language: string;
}

export interface SlideContent {
    heading?: string;
    subheading?: string;
    body?: string;
    bullets?: { text: string; level: number }[];
    chart?: { labels: string[]; values: number[]; series?: string; isExample?: boolean };
}

interface LlmModelConfig {
    provider: string;
    modelId: string;
    endpoint?: string | null;
    apiKey?: string | null;
    maxTokens: number;
}

@Injectable()
export class LlmService {
    private readonly logger = new Logger(LlmService.name);
    private cachedClient: OpenAI | null = null;
    private cachedModel: string | null = null;
    private cachedMaxTokens: number = 4096;
    private cacheExpiry: number = 0;
    private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    private readonly SLIDE_TYPES = new Set([
        'TITLE', 'CONTENT', 'BULLET_LIST', 'TWO_COLUMN', 'IMAGE',
        'CHART', 'QUOTE', 'COMPARISON', 'SECTION_HEADER',
    ]);

    constructor(
        private configService: ConfigService,
        private promptTemplates: PromptTemplateService,
        private prisma: PrismaService,
    ) { }

    private async getDefaultLlmModel(): Promise<LlmModelConfig | null> {
        // Find default or first active model
        const model = await this.prisma.llmModel.findFirst({
            where: { isActive: true },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        });

        if (!model) {
            return null;
        }

        // Get API key: prioritize direct apiKey, then env var, then config
        let apiKey = model.apiKey;
        if (!apiKey && model.apiKeyEnvVar) {
            apiKey = process.env[model.apiKeyEnvVar] || null;
        }
        if (!apiKey) {
            apiKey = this.configService.get<string>('OPENAI_API_KEY') || null;
        }

        return {
            provider: model.provider,
            modelId: model.modelId,
            endpoint: model.endpoint,
            apiKey,
            maxTokens: model.maxTokens,
        };
    }

    // Providers that don't require API keys (local LLMs)
    private readonly LOCAL_PROVIDERS = ['vllm', 'ollama', 'local', 'lmstudio', 'localai'];

    private isLocalProvider(provider: string): boolean {
        return this.LOCAL_PROVIDERS.includes(provider.toLowerCase());
    }

    private async getOpenAIClient(): Promise<{ client: OpenAI; model: string; maxTokens: number }> {
        const now = Date.now();

        // Return cached client if still valid
        if (this.cachedClient && this.cachedModel && now < this.cacheExpiry) {
            return { client: this.cachedClient, model: this.cachedModel, maxTokens: this.cachedMaxTokens };
        }

        // Fetch from database
        const llmConfig = await this.getDefaultLlmModel();

        if (llmConfig) {
            // For local providers (vLLM, Ollama, etc.), API key is optional
            if (this.isLocalProvider(llmConfig.provider)) {
                if (!llmConfig.endpoint) {
                    throw new Error(
                        `Local LLM provider '${llmConfig.provider}' requires an endpoint. ` +
                        'Please configure the endpoint in Admin Settings (e.g., http://localhost:11434/v1 for Ollama).'
                    );
                }

                const clientConfig: any = {
                    baseURL: llmConfig.endpoint,
                    apiKey: llmConfig.apiKey || 'not-needed', // Some local servers require a dummy key
                };

                this.cachedClient = new OpenAI(clientConfig);
                this.cachedModel = llmConfig.modelId;
                this.cachedMaxTokens = llmConfig.maxTokens || 4096;
                this.cacheExpiry = now + this.CACHE_TTL;

                this.logger.log(`Using local LLM: ${llmConfig.provider} at ${llmConfig.endpoint}`);
                return { client: this.cachedClient, model: this.cachedModel, maxTokens: this.cachedMaxTokens };
            }

            // For cloud providers, API key is required
            if (llmConfig.apiKey) {
                const clientConfig: any = { apiKey: llmConfig.apiKey };

                // Support custom endpoints (for Azure, etc.)
                if (llmConfig.endpoint) {
                    clientConfig.baseURL = llmConfig.endpoint;
                }

                this.cachedClient = new OpenAI(clientConfig);
                this.cachedModel = llmConfig.modelId;
                this.cachedMaxTokens = llmConfig.maxTokens || 4096;
                this.cacheExpiry = now + this.CACHE_TTL;

                return { client: this.cachedClient, model: this.cachedModel, maxTokens: this.cachedMaxTokens };
            }
        }

        // Fallback to environment variables. OPENAI_BASE_URL supports OpenAI-compatible
        // internal endpoints when an administrator has not configured a DB model yet.
        const envApiKey = this.configService.get<string>('OPENAI_API_KEY');
        const envBaseUrl = this.configService.get<string>('OPENAI_BASE_URL');
        if (envApiKey || envBaseUrl) {
            this.cachedClient = new OpenAI({
                apiKey: envApiKey || 'not-needed',
                ...(envBaseUrl ? { baseURL: envBaseUrl } : {}),
            });
            this.cachedModel = this.configService.get<string>('OPENAI_MODEL') || 'gpt-4-turbo-preview';
            this.cachedMaxTokens = Number(this.configService.get<string>('OPENAI_MAX_TOKENS')) || 4096;
            this.cacheExpiry = now + this.CACHE_TTL;

            return { client: this.cachedClient, model: this.cachedModel, maxTokens: this.cachedMaxTokens };
        }

        throw new Error(
            'No LLM configured. Please configure a model in Admin Settings:\n' +
            '- For cloud providers (OpenAI, Anthropic): Set API key\n' +
            '- For local providers (vLLM, Ollama): Set endpoint (e.g., http://localhost:11434/v1)'
        );
    }

    async generateOutline(input: GenerateOutlineInput): Promise<SlideOutline> {
        const prompt = this.promptTemplates.getOutlinePrompt(input);

        try {
            return await this.generateValidatedJson(
                'You are a professional presentation consultant. Return valid JSON only.',
                prompt,
                (value) => this.validateOutline(value, input.slideCount, input.templateSlides?.length ?? 0),
                Number.MAX_SAFE_INTEGER,
            );
        } catch (error) {
            this.logger.error('Failed to generate outline', error);
            throw error;
        }
    }

    // Validates a user-edited outline before content generation. Looser than the
    // LLM validator: the user may keep a single key point per slide and any slide
    // count, and order is renumbered here so the client need not send it perfectly.
    validateClientOutline(value: unknown): SlideOutline {
        if (!this.isRecord(value) || !this.isText(value.title) || !Array.isArray(value.slides)) {
            throw new Error('Outline must include a non-empty title and slides');
        }
        if (value.slides.length < 1) {
            throw new Error('Outline must include at least one slide');
        }
        const slides = value.slides.map((slide, index) => {
            if (!this.isRecord(slide) || !this.isText(slide.title)
                || !this.isText(slide.type) || !this.SLIDE_TYPES.has(slide.type)
                || !Array.isArray(slide.keyPoints) || slide.keyPoints.length < 1 || slide.keyPoints.length > 8
                || !slide.keyPoints.every((point) => this.isText(point))) {
                throw new Error(`Invalid outline slide at position ${index + 1}`);
            }
            return {
                order: index + 1, title: slide.title, type: slide.type, keyPoints: slide.keyPoints,
                ...(Number.isInteger(slide.templateIndex) && (slide.templateIndex as number) >= 0 ? { templateIndex: slide.templateIndex as number } : {}),
            };
        });
        return { title: value.title, slides };
    }

    async generateSlideContent(input: GenerateSlideContentInput): Promise<SlideContent> {
        const prompt = this.promptTemplates.getSlideContentPrompt(input);

        try {
            return await this.generateValidatedJson(
                'You are a professional presentation content writer. Return valid JSON only.',
                prompt,
                (value) => this.validateSlideContent(value, input.type),
                4096,
            );
        } catch (error) {
            this.logger.error('Failed to generate slide content', error);
            throw error;
        }
    }

    async editContent(currentContent: string, instruction: string): Promise<string> {
        const prompt = this.promptTemplates.getEditPrompt(currentContent, instruction);

        try {
            const { client, model } = await this.getOpenAIClient();
            const content = await this.chatJson(client, {
                model,
                messages: [
                    {
                        role: 'system',
                        content: `You are a helpful editor. Apply the requested edit to the content and return the result as JSON with a "content" field.`,
                    },
                    { role: 'user', content: prompt },
                ],
                temperature: 0.5,
            });

            if (!content) {
                throw new Error('No response from LLM');
            }

            const result = JSON.parse(this.extractJson(content));
            return result.content || currentContent;
        } catch (error) {
            this.logger.error('Failed to edit content', error);
            throw error;
        }
    }

    async suggestLayout(content: SlideContent, slideType: string): Promise<string> {
        const prompt = `Based on this slide content: ${JSON.stringify(content)}
And slide type: ${slideType}
Suggest the best layout from: center, left, right, image-left, image-right, two-column-equal
Return JSON with "layout" field only.`;

        try {
            const { client, model } = await this.getOpenAIClient();
            const content = await this.chatJson(client, {
                model,
                messages: [
                    { role: 'system', content: 'You are a presentation design expert.' },
                    { role: 'user', content: prompt },
                ],
                temperature: 0.3,
            });

            const result = JSON.parse(this.extractJson(content || '{}'));
            return result.layout || 'center';
        } catch (error) {
            this.logger.error('Failed to suggest layout', error);
            return 'center';
        }
    }

    async detectLanguage(text: string): Promise<string> {
        // Simple detection based on character range
        const koreanRegex = /[\uAC00-\uD7AF]/;
        if (koreanRegex.test(text)) {
            return 'ko';
        }
        return 'en';
    }

    // Request JSON output, tolerating OpenAI-compatible servers that reject
    // response_format: json_object (e.g. LM Studio wants json_schema/text).
    private async chatJson(
        client: OpenAI,
        params: Omit<OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming, 'response_format'>,
    ): Promise<string> {
        try {
            const res = await client.chat.completions.create({
                ...params,
                response_format: { type: 'json_object' },
            });
            return res.choices[0]?.message?.content || '';
        } catch (error: any) {
            if (error?.status === 400 && /response_format|peg-native/i.test(error?.message || '')) {
                const res = await client.chat.completions.create(params);
                return res.choices[0]?.message?.content || '';
            }
            throw error;
        }
    }

    // Pull the JSON object out of a model reply that may be fenced or prose-wrapped.
    private extractJson(text: string): string {
        const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
        const candidate = fence ? fence[1] : text;
        const start = candidate.indexOf('{');
        const end = candidate.lastIndexOf('}');
        return start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate.trim();
    }

    private async generateValidatedJson<T>(
        system: string,
        prompt: string,
        validate: (value: unknown) => T,
        requestedMaxTokens: number,
    ): Promise<T> {
        const { client, model, maxTokens } = await this.getOpenAIClient();
        let responseText = '';
        let error: unknown;

        for (let attempt = 0; attempt < 4; attempt++) {
            const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
                { role: 'system', content: system },
                {
                    role: 'user',
                    content: attempt === 0
                        ? prompt
                        : `${prompt}\n\nThe previous response was invalid. Return a corrected JSON object only. Do not use quotation marks inside text values. Validation error: ${error instanceof Error ? error.message : 'invalid JSON'}.`,
                },
            ];
            responseText = await this.chatJson(client, {
                model,
                messages,
                temperature: 0.7,
                max_tokens: Math.min(requestedMaxTokens, maxTokens || requestedMaxTokens),
            });

            try {
                if (!responseText) {
                    throw new Error('No response from LLM');
                }
                return validate(JSON.parse(this.extractJson(responseText)));
            } catch (caught) {
                error = caught;
            }
        }

        throw error instanceof Error ? error : new Error('Invalid LLM JSON response');
    }

    private validateOutline(value: unknown, slideCount: number, templateCount: number): SlideOutline {
        if (!this.isRecord(value) || !this.isText(value.title) || !Array.isArray(value.slides)) {
            throw new Error('Outline must include a non-empty title and slides');
        }
        if (value.slides.length !== slideCount) {
            throw new Error(`Outline expected ${slideCount} slides, received ${value.slides.length}`);
        }

        const slides = value.slides.map((slide, index) => {
            if (!this.isRecord(slide) || slide.order !== index + 1 || !this.isText(slide.title)
                || !this.isText(slide.type) || !this.SLIDE_TYPES.has(slide.type)
                || !Array.isArray(slide.keyPoints) || slide.keyPoints.length < 2 || slide.keyPoints.length > 5
                || !slide.keyPoints.every((point) => this.isText(point))) {
                throw new Error(`Invalid outline slide at position ${index + 1}`);
            }
            return {
                order: slide.order, title: slide.title, type: slide.type, keyPoints: slide.keyPoints,
                ...(Number.isInteger(slide.templateIndex) && (slide.templateIndex as number) >= 0 && (templateCount === 0 || (slide.templateIndex as number) < templateCount) ? { templateIndex: slide.templateIndex as number } : {}),
            };
        });
        return { title: value.title, slides };
    }

    private validateSlideContent(value: unknown, type: string): SlideContent {
        if (this.isRecord(value) && this.isRecord(value.slide)) {
            value = value.slide;
        }
        if (!this.isRecord(value) || !this.isText(value.heading)) {
            throw new Error('Slide content requires a non-empty heading');
        }

        // ponytail: tolerant of varied local-model output — keep the known fields,
        // ignore extras and malformed optionals instead of rejecting the whole slide.
        let bullets: { text: string; level: number }[] | undefined;
        if (Array.isArray(value.bullets)) {
            const cleaned = value.bullets
                .filter((bullet): bullet is string | Record<string, unknown> => this.isText(bullet) || (this.isRecord(bullet) && this.isText(bullet.text)))
                .slice(0, 5)
                .map((bullet) => this.isText(bullet)
                    ? { text: bullet, level: 0 }
                    : { text: bullet.text as string, level: bullet.level === 1 ? 1 : 0 });
            if (cleaned.length > 0) bullets = cleaned;
        }

        const chartValue = this.isRecord(value.chart) ? value.chart : undefined;
        const chartLabels = chartValue?.labels ?? chartValue?.xAxisLabels;
        const chartSeries = Array.isArray(chartValue?.series) && this.isRecord(chartValue.series[0]) ? chartValue.series[0] : undefined;
        const chartValues = chartValue?.values ?? chartSeries?.values;
        const chart = Array.isArray(chartLabels) && Array.isArray(chartValues)
            && chartLabels.length >= 2 && chartLabels.length <= 6
            && chartLabels.length === chartValues.length
            && chartLabels.every((label) => this.isText(label))
            && chartValues.every((number) => typeof number === 'number' && Number.isFinite(number))
            ? {
                labels: chartLabels as string[],
                values: chartValues as number[],
                ...(this.isText(chartValue?.series) ? { series: chartValue.series as string } : this.isText(chartSeries?.name) ? { series: chartSeries.name as string } : this.isText(chartValue?.label) ? { series: chartValue.label as string } : {}),
                ...(chartValue?.isExample === true ? { isExample: true } : {}),
            }
            : type === 'CHART'
                ? { labels: ['현재 수준', '개선 목표'], values: [60, 35], series: '예시 지표', isExample: true }
                : undefined;

        return {
            heading: value.heading,
            ...(this.isText(value.subheading) ? { subheading: value.subheading } : {}),
            ...(this.isText(value.body) ? { body: value.body } : {}),
            ...(bullets !== undefined ? { bullets } : {}),
            ...(chart ? { chart } : {}),
        };
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    private isText(value: unknown): value is string {
        return typeof value === 'string' && value.trim().length > 0;
    }
}
