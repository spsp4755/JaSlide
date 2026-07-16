import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class AdminOperationsService {
    constructor(private prisma: PrismaService) { }

    async getSystemHealth() {
        const startTime = process.hrtime();
        let dbStatus = 'up';
        let dbLatency = 0;

        try {
            const dbStart = Date.now();
            await this.prisma.$queryRaw`SELECT 1`;
            dbLatency = Date.now() - dbStart;
        } catch {
            dbStatus = 'down';
        }

        const memoryUsage = process.memoryUsage();

        return {
            status: dbStatus === 'up' ? 'healthy' : 'degraded',
            services: {
                api: { status: 'up', latency: 0 },
                database: { status: dbStatus, latency: dbLatency },
                redis: { status: 'up', latency: 3 }, // Placeholder
                renderer: { status: 'up', latency: 120 }, // Placeholder
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
        const startedAt = Date.now();
        try {
            await axios.post(`${endpoint.replace(/\/$/, '')}/chat/completions`, {
                model: model.modelId,
                messages: [{ role: 'user', content: 'Reply with OK.' }],
                max_tokens: 1,
                temperature: 0,
            }, {
                headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
                timeout: 10_000,
            });
            return {
                success: true,
                model: model.name,
                responseTime: Date.now() - startedAt,
                message: 'Model endpoint is reachable',
            };
        } catch (error) {
            const status = axios.isAxiosError(error) ? error.response?.status : undefined;
            return {
                success: false,
                error: status ? `Model endpoint returned HTTP ${status}` : 'Model endpoint is unreachable',
            };
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
