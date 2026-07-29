import { Module } from '@nestjs/common';
import { SlidesController } from './slides.controller';
import { SlidesService } from './slides.service';
import { AssetsModule } from '../assets/assets.module';

@Module({
    imports: [AssetsModule],
    controllers: [SlidesController],
    providers: [SlidesService],
    exports: [SlidesService],
})
export class SlidesModule { }
