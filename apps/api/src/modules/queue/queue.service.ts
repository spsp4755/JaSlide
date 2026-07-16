import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';

type GenerationProcessor = (jobId: string) => Promise<void>;

@Injectable()
export class QueueService implements OnModuleDestroy {
    private readonly logger = new Logger(QueueService.name);
    private readonly generationQueue: Queue;
    private generationWorker: Worker | null = null;

    constructor(configService: ConfigService) {
        const redisUrl = new URL(configService.get<string>('REDIS_URL') || 'redis://localhost:6379');
        const connection = {
            host: redisUrl.hostname,
            port: Number(redisUrl.port || 6379),
            ...(redisUrl.username ? { username: decodeURIComponent(redisUrl.username) } : {}),
            ...(redisUrl.password ? { password: decodeURIComponent(redisUrl.password) } : {}),
            ...(redisUrl.protocol === 'rediss:' ? { tls: {} } : {}),
            maxRetriesPerRequest: null,
        };
        this.generationQueue = new Queue('generation', { connection });
    }

    registerGenerationProcessor(processor: GenerationProcessor) {
        if (this.generationWorker) return;
        this.generationWorker = new Worker(
            'generation',
            async (job) => processor(job.data.jobId),
            { connection: this.generationQueue.opts.connection, concurrency: 1 },
        );
        this.generationWorker.on('error', (error) => this.logger.error('Generation queue error', error));
    }

    async addGenerationJob(jobId: string) {
        await this.generationQueue.add('generate', { jobId }, {
            jobId,
            removeOnComplete: 100,
            removeOnFail: 100,
        });
    }

    async onModuleDestroy() {
        await this.generationWorker?.close();
        await this.generationQueue.close();
    }
}
