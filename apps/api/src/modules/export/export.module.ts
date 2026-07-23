import { Module } from '@nestjs/common';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';
import { GoogleSlidesService } from './google-slides.service';
import { ConfigModule } from '@nestjs/config';
import { AssetsModule } from '../assets/assets.module';

@Module({
    imports: [ConfigModule, AssetsModule],
    controllers: [ExportController],
    providers: [ExportService, GoogleSlidesService],
    exports: [ExportService, GoogleSlidesService],
})
export class ExportModule { }

