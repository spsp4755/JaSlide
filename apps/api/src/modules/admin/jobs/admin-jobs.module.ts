import { Module } from '@nestjs/common';
import { AdminJobsController } from './admin-jobs.controller';
import { AdminJobsService } from './admin-jobs.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { QueueModule } from '../../queue/queue.module';

@Module({
    imports: [PrismaModule, QueueModule],
    controllers: [AdminJobsController],
    providers: [AdminJobsService],
    exports: [AdminJobsService],
})
export class AdminJobsModule { }
