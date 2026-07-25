import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';

@Injectable()
export class AdminOperationsService {
    constructor(
        private prisma: PrismaService,
        private queueService: QueueService,
        private configService: ConfigService,
    ) { }

    async getSystemHealth() {
        const startTime = process.hrtime();
        const check = async (action: () => Promise<unknown>) => {
            const startedAt = Date.now();
            try {
                await action();
                return { status: 'up', latency: Date.now() - startedAt };
            } catch {
                return { status: 'down', latency: Date.now() - startedAt };
            }
        };
        const [database, redis, renderer] = await Promise.all([
            check(() => this.prisma.$queryRaw`SELECT 1`),
            check(() => this.queueService.ping()),
            check(() => axios.get(`${(this.configService.get<string>('RENDERER_URL') || 'http://localhost:8000').replace(/\/$/, '')}/health`, { timeout: 3_000 })),
        ]);

        const memoryUsage = process.memoryUsage();

        return {
            status: [database, redis, renderer].every((service) => service.status === 'up') ? 'healthy' : 'degraded',
            services: {
                api: { status: 'up', latency: 0 },
                database,
                redis,
                renderer,
            },
            memory: {
                heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
                heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
                rss: Math.round(memoryUsage.rss / 1024 / 1024),
            },
            uptime: process.uptime(),
        };
    }

    async clearCache(cacheType: 'templates' | 'models' | 'all') {
        // Placeholder - implement actual cache clearing logic
        return { success: true, message: `Cache cleared: ${cacheType}` };
    }

    async testModel(modelId: string) {
        const model = await this.prisma.llmModel.findUnique({ where: { id: modelId } });
        if (!model) {
            return { success: false, error: 'Model not found' };
        }

        const endpoint = model.endpoint || (model.provider.toLowerCase() === 'openai' ? 'https://api.openai.com/v1' : null);
        if (!endpoint) {
            return { success: false, error: 'Model endpoint is not configured' };
        }

        const apiKey = model.apiKey || (model.apiKeyEnvVar ? process.env[model.apiKeyEnvVar] : undefined);
        const base = endpoint.replace(/\/$/, '');
        const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
        const startedAt = Date.now();

        // Ask for the model list first. Every OpenAI-compatible server exposes it, it
        // needs no inference, and it also tells us whether this modelId is actually
        // installed. A completion probe alone reported a healthy local endpoint as
        // unreachable, because loading a model into memory outlasts any short timeout.
        try {
            const { data } = await axios.get(`${base}/models`, { headers, timeout: 5_000 });
            const installed = Array.isArray(data?.data) ? data.data.map((item: any) => item?.id).filter(Boolean) : [];
            if (installed.length && !installed.includes(model.modelId)) {
                return {
                    success: false,
                    error: `엔드포인트에 연결했지만 '${model.modelId}' 모델이 없습니다. 사용 가능: ${installed.slice(0, 5).join(', ')}`,
                };
            }
            return {
                success: true,
                model: model.name,
                responseTime: Date.now() - startedAt,
                message: '엔드포인트에 연결되었고 모델도 확인했습니다.',
            };
        } catch (listError) {
            // No /models route: fall back to a completion, allowing for a cold start.
            try {
                await axios.post(`${base}/chat/completions`, {
                    model: model.modelId,
                    messages: [{ role: 'user', content: 'Reply with OK.' }],
                    max_tokens: 1,
                    temperature: 0,
                }, { headers, timeout: 120_000 });
                return {
                    success: true,
                    model: model.name,
                    responseTime: Date.now() - startedAt,
                    message: '엔드포인트에 연결되었습니다.',
                };
            } catch (error) {
                const status = axios.isAxiosError(error) ? error.response?.status : undefined;
                const detail = axios.isAxiosError(error) ? (error.response?.data as any)?.error?.message : undefined;
                return {
                    success: false,
                    error: detail || (status ? `엔드포인트가 HTTP ${status}를 반환했습니다.` : '엔드포인트에 연결할 수 없습니다.'),
                };
            }
        }
    }

    async forceStopJobs() {
        const result = await this.prisma.generationJob.updateMany({
            where: {
                status: { in: ['PROCESSING', 'GENERATING_OUTLINE', 'GENERATING_CONTENT', 'APPLYING_DESIGN', 'RENDERING'] },
            },
            data: { status: 'CANCELLED' },
        });

        return { success: true, affectedJobs: result.count };
    }

    async getQueueStatus() {
        const queued = await this.prisma.generationJob.count({ where: { status: 'QUEUED' } });
        const processing = await this.prisma.generationJob.count({
            where: { status: { in: ['PROCESSING', 'GENERATING_OUTLINE', 'GENERATING_CONTENT', 'APPLYING_DESIGN', 'RENDERING'] } },
        });

        return { queued, processing };
    }
}
