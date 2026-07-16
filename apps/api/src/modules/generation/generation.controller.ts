import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { GenerationService } from './generation.service';
import { StartGenerationDto, AIEditDto } from './dto/generation.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('generation')
@Controller('generation')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class GenerationController {
    constructor(private generationService: GenerationService) { }

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
