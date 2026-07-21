import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
    extends PrismaClient
    implements OnModuleInit, OnModuleDestroy {
    constructor() {
        super({
            log:
                process.env.NODE_ENV === 'development'
                    ? ['query', 'info', 'warn', 'error']
                    : ['error'],
        });
    }

    async onModuleInit() {
        await this.$connect();
    }

    async onModuleDestroy() {
        await this.$disconnect();
    }

    async cleanDatabase() {
        if (process.env.NODE_ENV !== 'production') {
            // Clean up in correct order (respecting foreign keys)
            await this.auditLog.deleteMany();
            await this.generationJob.deleteMany();
            await this.slide.deleteMany();
            await this.presentation.deleteMany();
            await this.asset.deleteMany();
            await this.template.deleteMany();
            await this.session.deleteMany();
            await this.account.deleteMany();
            await this.user.deleteMany();
            await this.organization.deleteMany();
        }
    }
}
