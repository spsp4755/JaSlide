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
}

export interface SlideOutline {
    title: string;
    slides: {
        order: number;
        title: string;
        type: string;
        keyPoints: string[];
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

    private async getOpenAIClient(): Promise<{ client: OpenAI; model: string }> {
        const now = Date.now();

        // Return cached client if still valid
        if (this.cachedClient && this.cachedModel && now < this.cacheExpiry) {
            return { client: this.cachedClient, model: this.cachedModel };
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
                this.cacheExpiry = now + this.CACHE_TTL;

                this.logger.log(`Using local LLM: ${llmConfig.provider} at ${llmConfig.endpoint}`);
                return { client: this.cachedClient, model: this.cachedModel };
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
                this.cacheExpiry = now + this.CACHE_TTL;

                return { client: this.cachedClient, model: this.cachedModel };
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
            this.cacheExpiry = now + this.CACHE_TTL;

            return { client: this.cachedClient, model: this.cachedModel };
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
                (value) => this.validateOutline(value, input.slideCount),
            );
        } catch (error) {
            this.logger.error('Failed to generate outline', error);
            throw error;
        }
    }

    async generateSlideContent(input: GenerateSlideContentInput): Promise<SlideContent> {
        const prompt = this.promptTemplates.getSlideContentPrompt(input);

        try {
            return await this.generateValidatedJson(
                'You are a professional presentation content writer. Return valid JSON only.',
                prompt,
                (value) => this.validateSlideContent(value),
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
            const response = await client.chat.completions.create({
                model,
                messages: [
                    {
                        role: 'system',
                        content: `You are a helpful editor. Apply the requested edit to the content and return the result as JSON with a "content" field.`,
                    },
                    { role: 'user', content: prompt },
                ],
                temperature: 0.5,
                response_format: { type: 'json_object' },
            });

            const content = response.choices[0]?.message?.content;
            if (!content) {
                throw new Error('No response from LLM');
            }

            const result = JSON.parse(content);
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
            const response = await client.chat.completions.create({
                model,
                messages: [
                    { role: 'system', content: 'You are a presentation design expert.' },
                    { role: 'user', content: prompt },
                ],
                temperature: 0.3,
                response_format: { type: 'json_object' },
            });

            const result = JSON.parse(response.choices[0]?.message?.content || '{}');
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

    private async generateValidatedJson<T>(
        system: string,
        prompt: string,
        validate: (value: unknown) => T,
    ): Promise<T> {
        const { client, model } = await this.getOpenAIClient();
        let responseText = '';
        let error: unknown;

        for (let attempt = 0; attempt < 2; attempt++) {
            const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
                { role: 'system', content: system },
                {
                    role: 'user',
                    content: attempt === 0
                        ? prompt
                        : `${prompt}\n\nThe previous response was invalid: ${responseText}\nValidation error: ${error instanceof Error ? error.message : 'invalid JSON'}. Return a corrected JSON object only.`,
                },
            ];
            const response = await client.chat.completions.create({
                model,
                messages,
                temperature: 0.7,
                response_format: { type: 'json_object' },
            });
            responseText = response.choices[0]?.message?.content || '';

            try {
                if (!responseText) {
                    throw new Error('No response from LLM');
                }
                return validate(JSON.parse(responseText));
            } catch (caught) {
                error = caught;
            }
        }

        throw error instanceof Error ? error : new Error('Invalid LLM JSON response');
    }

    private validateOutline(value: unknown, slideCount: number): SlideOutline {
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
            return { order: slide.order, title: slide.title, type: slide.type, keyPoints: slide.keyPoints };
        });
        return { title: value.title, slides };
    }

    private validateSlideContent(value: unknown): SlideContent {
        if (!this.isRecord(value) || !this.isText(value.heading)) {
            throw new Error('Slide content requires a non-empty heading');
        }
        const allowedFields = new Set(['heading', 'subheading', 'body', 'bullets']);
        if (Object.keys(value).some((field) => !allowedFields.has(field))
            || (value.subheading !== undefined && !this.isText(value.subheading))
            || (value.body !== undefined && !this.isText(value.body))) {
            throw new Error('Invalid slide content field');
        }

        let bullets: { text: string; level: number }[] | undefined;
        if (value.bullets !== undefined) {
            if (!Array.isArray(value.bullets) || value.bullets.length > 5) {
                throw new Error('Slide content allows at most five bullets');
            }
            bullets = value.bullets.map((bullet) => {
                if (!this.isRecord(bullet) || !this.isText(bullet.text) || (bullet.level !== 0 && bullet.level !== 1)) {
                    throw new Error('Invalid bullet level or text');
                }
                return { text: bullet.text, level: bullet.level };
            });
        }

        return {
            heading: value.heading,
            ...(value.subheading !== undefined ? { subheading: value.subheading } : {}),
            ...(value.body !== undefined ? { body: value.body } : {}),
            ...(bullets !== undefined ? { bullets } : {}),
        };
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    private isText(value: unknown): value is string {
        return typeof value === 'string' && value.trim().length > 0;
    }
}
