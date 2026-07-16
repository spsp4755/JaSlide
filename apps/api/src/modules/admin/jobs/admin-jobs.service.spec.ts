import { AdminJobsService } from './admin-jobs.service';

describe('AdminJobsService', () => {
    const prisma = {
        generationJob: { findUnique: jest.fn(), update: jest.fn() },
    };
    const queueService = { addGenerationJob: jest.fn() };
    const service = new AdminJobsService(prisma as any, queueService as any);

    beforeEach(() => jest.clearAllMocks());

    it('queues a retried job after resetting its database status', async () => {
        prisma.generationJob.findUnique.mockResolvedValue({ id: 'job-1' });

        await expect(service.retry('job-1')).resolves.toEqual({ success: true, message: 'Job queued for retry' });

        expect(prisma.generationJob.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'job-1' } }));
        expect(queueService.addGenerationJob).toHaveBeenCalledWith('job-1');
    });
});
