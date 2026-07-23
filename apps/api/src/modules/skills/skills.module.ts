import { Module } from '@nestjs/common';
import { SkillsController } from './skills.controller';
import { SkillsService } from './skills.service';
import { AssetsModule } from '../assets/assets.module';

@Module({
    controllers: [SkillsController],
    imports: [AssetsModule],
    providers: [SkillsService],
    exports: [SkillsService],
})
export class SkillsModule {}
