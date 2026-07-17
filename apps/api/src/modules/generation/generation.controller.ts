import { Controller, Post, Get, Body, Param, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { GenerationService } from './generation.service';
import { StartGenerationDto, AIEditDto } from './dto/generation.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SourceExtractionService } from './source-extraction.service';

@ApiTags('generation')
@Controller('generation')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class GenerationController {
    constructor(
        private generationService: GenerationService,
        private sourceExtractionService: SourceExtractionService,
    ) { }

    @Post('source/extract')
    @ApiOperation({ summary: 'Extract uploaded source content for generation' })
    @ApiConsumes('multipart/form-data')
    @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
    async extractSource(@UploadedFile() file: Express.Multer.File) {
        return this.sourceExtractionService.extract(file);
    }

    @Post('start')
    @ApiOperation({ summary: 'Start presentation generation' })
    async startGeneration(@CurrentUser() user: any, @Body() dto: StartGenerationDto) {
        return this.generationService.startGeneration(user.id, dto);
    }

    @Get(':jobId/status')
    @ApiOperation({ summary: 'Get generation job status' })
    async getJobStatus(@CurrentUser() user: any, @Param('jobId') jobId: string) {
        return this.generationService.getJobStatus(jobId, user.id);
    }

    @Post(':jobId/cancel')
    @ApiOperation({ summary: 'Cancel presentation generation' })
    async cancelGeneration(@CurrentUser() user: any, @Param('jobId') jobId: string) {
        return this.generationService.cancelGeneration(jobId, user.id);
    }

    @Post('edit')
    @ApiOperation({ summary: 'Apply AI edit to slide' })
    async aiEdit(@CurrentUser() user: any, @Body() dto: AIEditDto) {
        return this.generationService.aiEdit(user.id, dto);
    }
}
