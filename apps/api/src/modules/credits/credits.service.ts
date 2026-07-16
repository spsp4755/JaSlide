import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CreditsService {
    constructor(private prisma: PrismaService) { }

    async getBalance(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { creditsRemaining: true },
        });

        if (!user) {
            throw new BadRequestException('User not found');
        }

        return {
            available: user.creditsRemaining,
            pending: 0, // For future use
        };
    }

    async checkBalance(userId: string, requiredAmount: number): Promise<boolean> {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { creditsRemaining: true },
        });

        return user ? user.creditsRemaining >= requiredAmount : false;
    }

    async deductCredits(
        userId: string,
        amount: number,
        type: 'USAGE' | 'ADJUSTMENT' = 'USAGE',
        description: string,
        referenceId?: string,
    ) {
        // Use transaction to ensure atomicity
        const result = await this.prisma.$transaction(async (tx) => {
            if (referenceId) {
                const existing = await tx.creditTransaction.findFirst({
                    where: { userId, type, referenceId },
                    orderBy: { createdAt: 'desc' },
                });
                if (existing) {
                    return { transaction: existing, newBalance: existing.balance };
                }
            }

            // Get current balance
            const user = await tx.user.findUnique({
                where: { id: userId },
                select: { creditsRemaining: true },
            });

            if (!user || user.creditsRemaining < amount) {
                throw new BadRequestException('Insufficient credits');
            }

            const newBalance = user.creditsRemaining - amount;

            // Update user balance
            await tx.user.update({
                where: { id: userId },
                data: { creditsRemaining: newBalance },
            });

            // Create transaction record
            const transaction = await tx.creditTransaction.create({
                data: {
                    userId,
                    amount: -amount,
                    type,
                    description,
                    referenceId,
                    referenceType: referenceId ? 'presentation' : undefined,
                    balance: newBalance,
                },
            });

            return { transaction, newBalance };
        });

        return result;
    }

    async addCredits(
        userId: string,
        amount: number,
        type: 'PURCHASE' | 'BONUS' | 'REFUND' | 'SUBSCRIPTION' = 'PURCHASE',
        description: string,
        referenceId?: string,
    ) {
        const result = await this.prisma.$transaction(async (tx) => {
            const user = await tx.user.findUnique({
                where: { id: userId },
                select: { creditsRemaining: true },
            });

            if (!user) {
                throw new BadRequestException('User not found');
            }

            const newBalance = user.creditsRemaining + amount;

            await tx.user.update({
                where: { id: userId },
                data: { creditsRemaining: newBalance },
            });

            const transaction = await tx.creditTransaction.create({
                data: {
                    userId,
                    amount,
                    type,
                    description,
                    referenceId,
                    balance: newBalance,
                },
            });

            return { transaction, newBalance };
        });

        return result;
    }

    async getTransactionHistory(userId: string, page = 1, limit = 20) {
        const skip = (page - 1) * limit;

        const [transactions, total] = await Promise.all([
            this.prisma.creditTransaction.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.creditTransaction.count({ where: { userId } }),
        ]);

        return {
            data: transactions,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }

    async getUsageSummary(userId: string, days = 30) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const transactions = await this.prisma.creditTransaction.findMany({
            where: {
                userId,
                type: 'USAGE',
                createdAt: { gte: startDate },
            },
        });

        const totalUsed = transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);

        return {
            totalUsed,
            transactionCount: transactions.length,
            period: `${days} days`,
            averagePerDay: Math.round(totalUsed / days * 100) / 100,
        };
    }
}
