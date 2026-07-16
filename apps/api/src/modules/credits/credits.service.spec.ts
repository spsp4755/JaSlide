import { Test, TestingModule } from '@nestjs/testing';
import { CreditsService } from './credits.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';

describe('CreditsService', () => {
    let service: CreditsService;
    let prisma: any;

    const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        creditsRemaining: 100,
    };

    const mockTransaction = {
        id: 'tx-123',
        userId: 'user-123',
        amount: -10,
        type: 'USAGE' as const,
        description: 'AI Generation',
        referenceId: 'job-123',
        referenceType: 'presentation',
        balance: 90,
        createdAt: new Date(),
    };

    beforeEach(async () => {
        prisma = {
            user: {
                findUnique: jest.fn(),
                update: jest.fn(),
            },
            creditTransaction: {
                create: jest.fn(),
                findFirst: jest.fn(),
                findMany: jest.fn(),
                count: jest.fn(),
            },
            $transaction: jest.fn().mockImplementation((callback) => callback(prisma)),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CreditsService,
                {
                    provide: PrismaService,
                    useValue: prisma,
                },
            ],
        }).compile();

        service = module.get<CreditsService>(CreditsService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('getBalance', () => {
        it('should return user credit balance', async () => {
            prisma.user.findUnique.mockResolvedValue(mockUser);

            const result = await service.getBalance('user-123');

            expect(result.available).toBe(100);
            expect(result.pending).toBe(0);
        });

        it('should throw BadRequestException if user not found', async () => {
            prisma.user.findUnique.mockResolvedValue(null);

            await expect(service.getBalance('unknown-id')).rejects.toThrow(BadRequestException);
        });
    });

    describe('checkBalance', () => {
        it('should return true if user has enough credits', async () => {
            prisma.user.findUnique.mockResolvedValue(mockUser);

            const result = await service.checkBalance('user-123', 50);

            expect(result).toBe(true);
        });

        it('should return false if user does not have enough credits', async () => {
            prisma.user.findUnique.mockResolvedValue(mockUser);

            const result = await service.checkBalance('user-123', 150);

            expect(result).toBe(false);
        });
    });

    describe('deductCredits', () => {
        it('should deduct credits and create transaction', async () => {
            prisma.user.findUnique.mockResolvedValue(mockUser);
            prisma.user.update.mockResolvedValue({ ...mockUser, creditsRemaining: 90 });
            prisma.creditTransaction.create.mockResolvedValue(mockTransaction);

            const result = await service.deductCredits(
                'user-123',
                10,
                'USAGE',
                'AI Generation',
                'job-123',
            );

            expect(result).toBeDefined();
            expect(result.transaction.amount).toBe(-10);
            expect(result.newBalance).toBe(90);
        });

        it('should return the existing transaction when a generation is retried', async () => {
            prisma.creditTransaction.findFirst.mockResolvedValue(mockTransaction);

            const result = await service.deductCredits(
                'user-123',
                10,
                'USAGE',
                'AI Generation',
                'job-123',
            );

            expect(result).toEqual({ transaction: mockTransaction, newBalance: 90 });
            expect(prisma.user.update).not.toHaveBeenCalled();
            expect(prisma.creditTransaction.create).not.toHaveBeenCalled();
        });

        it('should throw if user does not have enough credits', async () => {
            prisma.user.findUnique.mockResolvedValue(mockUser);

            await expect(
                service.deductCredits('user-123', 150, 'USAGE', 'Big task'),
            ).rejects.toThrow(BadRequestException);
        });
    });

    describe('addCredits', () => {
        it('should add credits and create transaction', async () => {
            prisma.user.findUnique.mockResolvedValue(mockUser);
            prisma.user.update.mockResolvedValue({ ...mockUser, creditsRemaining: 150 });
            prisma.creditTransaction.create.mockResolvedValue({
                ...mockTransaction,
                amount: 50,
                type: 'PURCHASE',
                balance: 150,
            });

            const result = await service.addCredits('user-123', 50, 'PURCHASE', 'Credit purchase');

            expect(result).toBeDefined();
            expect(result.transaction.amount).toBe(50);
            expect(result.newBalance).toBe(150);
        });
    });

    describe('getTransactionHistory', () => {
        it('should return transaction history', async () => {
            prisma.creditTransaction.findMany.mockResolvedValue([mockTransaction]);
            prisma.creditTransaction.count.mockResolvedValue(1);

            const result = await service.getTransactionHistory('user-123');

            expect(result.data).toHaveLength(1);
            expect(result.data[0].type).toBe('USAGE');
            expect(result.total).toBe(1);
        });
    });
});
