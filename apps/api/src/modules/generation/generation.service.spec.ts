import { BadRequestException } from '@nestjs/common';

jest.mock('../llm/llm.service', () => ({ LlmService: class LlmService {} }));
jest.mock('../queue/queue.service', () => ({ QueueService: class QueueService {} }));

import { GenerationService } from './generation.service';

describe('GenerationService cancellation', () => {
    const prisma = {
        generationJob: {
            findFirst: jest.fn(),
            update: jest.fn(),
        },
    };
    const service = new GenerationService(prisma as any, {} as any, {} as any, {} as any);

    beforeEach(() => jest.clearAllMocks());

    it('cancels only the requesting user job', async () => {
        prisma.generationJob.findFirst.mockResolvedValue({ id: 'job-1', status: 'GENERATING_CONTENT' });

        await expect(service.cancelGeneration('job-1', 'user-1')).resolves.toEqual({ success: true });

        expect(prisma.generationJob.findFirst).toHaveBeenCalledWith({ where: { id: 'job-1', userId: 'user-1' } });
        expect(prisma.generationJob.update).toHaveBeenCalledWith({
            where: { id: 'job-1' },
            data: { status: 'CANCELLED' },
        });
    });

    it('does not cancel completed jobs', async () => {
        prisma.generationJob.findFirst.mockResolvedValue({ id: 'job-1', status: 'COMPLETED' });

        await expect(service.cancelGeneration('job-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.generationJob.update).not.toHaveBeenCalled();
    });
});
