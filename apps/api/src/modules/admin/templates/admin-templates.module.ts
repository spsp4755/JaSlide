import { Module } from '@nestjs/common';
import { AdminTemplatesController } from './admin-templates.controller';
import { AdminTemplatesService } from './admin-templates.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AssetsModule } from '../../assets/assets.module';

@Module({
    imports: [PrismaModule, AssetsModule],
    controllers: [AdminTemplatesController],
    providers: [AdminTemplatesService],
    exports: [AdminTemplatesService],
})
export class AdminTemplatesModule { }
