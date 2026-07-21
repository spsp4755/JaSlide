import { Module } from '@nestjs/common';
import { GenerationController } from './generation.controller';
import { GenerationService } from './generation.service';
import { DocumentParserService } from './document-parser.service';
import { DesignEngineService } from './design-engine.service';
import { DataVisualizationService } from './data-visualization.service';
import { SourceExtractionService } from './source-extraction.service';
import { LlmModule } from '../llm/llm.module';
import { AssetsModule } from '../assets/assets.module';
import { QueueModule } from '../queue/queue.module';

@Module({
    imports: [LlmModule, AssetsModule, QueueModule],
    controllers: [GenerationController],
    providers: [
        GenerationService,
        DocumentParserService,
        DesignEngineService,
        DataVisualizationService,
        SourceExtractionService,
    ],
    exports: [
        GenerationService,
        DocumentParserService,
        DesignEngineService,
        DataVisualizationService,
        SourceExtractionService,
    ],
})
export class GenerationModule { }
