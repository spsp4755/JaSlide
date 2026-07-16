import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminJobFilterDto } from '../dto';
import { QueueService } from '../../queue/queue.service';

@Injectable()
export class AdminJobsService {
    constructor(
        private prisma: PrismaService,
        private queueService: QueueService,
    ) { }

    async findAll(filter: AdminJobFilterDto) {
        const { page = 1, limit = 20, userId, status, startDate, endDate } = filter;
        const skip = (page - 1) * limit;

        const where: any = {};
        if (userId) where.userId = userId;
        if (status) where.status = status;
        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) where.createdAt.gte = new Date(startDate);
            if (endDate) where.createdAt.lte = new Date(endDate);
        }

        const [jobs, total] = await Promise.all([
            this.prisma.generationJob.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    user: { select: { id: true, email: true, name: true } },
                    presentation: { select: { id: true, title: true } },
                },
            }),
            this.prisma.generationJob.count({ where }),
        ]);

        return { data: jobs, total, page, limit, totalPages: Math.ceil(total / limit) };
    }

    async findById(id: string) {
        const job = await this.prisma.generationJob.findUnique({
            where: { id },
            include: {
                user: { select: { id: true, email: true, name: true } },
                presentation: true,
            },
        });

        if (!job) throw new NotFoundException('Job not found');
        return job;
    }

    async retry(id: string) {
        const job = await this.prisma.generationJob.findUnique({ where: { id } });
        if (!job) throw new NotFoundException('Job not found');

        await this.prisma.generationJob.update({
            where: { id },
            data: { status: 'QUEUED', error: undefined, startedAt: null, completedAt: null },
        });
        await this.queueService.addGenerationJob(id);

        return { success: true, message: 'Job queued for retry' };
    }

    async cancel(id: string) {
        const job = await this.prisma.generationJob.findUnique({ where: { id } });
        if (!job) throw new NotFoundException('Job not found');

        await this.prisma.generationJob.update({
            where: { id },
            data: { status: 'CANCELLED' },
        });

        return { success: true, message: 'Job cancelled' };
    }

    async getStats() {
        const [statusCounts, recent24h] = await Promise.all([
            this.prisma.generationJob.groupBy({ by: ['status'], _count: true }),
            this.prisma.generationJob.count({
                where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
            }),
        ]);

        return { byStatus: statusCounts, last24Hours: recent24h };
    }
}
