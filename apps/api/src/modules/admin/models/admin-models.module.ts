import { Module } from '@nestjs/common';
import { AdminModelsController } from './admin-models.controller';
import { AdminModelsService } from './admin-models.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { LlmModule } from '../../llm/llm.module';

@Module({
    imports: [PrismaModule, LlmModule],
    controllers: [AdminModelsController],
    providers: [AdminModelsService],
    exports: [AdminModelsService],
})
export class AdminModelsModule { }
