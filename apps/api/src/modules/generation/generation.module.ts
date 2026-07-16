import { Module } from '@nestjs/common';
import { GenerationController } from './generation.controller';
import { GenerationService } from './generation.service';
import { DocumentParserService } from './document-parser.service';
import { DesignEngineService } from './design-engine.service';
import { DataVisualizationService } from './data-visualization.service';
import { LlmModule } from '../llm/llm.module';
import { CreditsModule } from '../credits/credits.module';
import { AssetsModule } from '../assets/assets.module';
import { QueueModule } from '../queue/queue.module';

@Module({
    imports: [LlmModule, CreditsModule, AssetsModule, QueueModule],
    controllers: [GenerationController],
    providers: [
        GenerationService,
        DocumentParserService,
        DesignEngineService,
        DataVisualizationService,
    ],
    exports: [
        GenerationService,
        DocumentParserService,
        DesignEngineService,
        DataVisualizationService,
    ],
})
export class GenerationModule { }

