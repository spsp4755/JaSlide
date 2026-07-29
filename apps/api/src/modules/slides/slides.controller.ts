import {
    Controller,
    Get,
    Post,
    Put,
    Patch,
    Delete,
    Body,
    Param,
    UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SlidesService } from './slides.service';
import { CreateSlideDto, UpdateSlideDto, ReorderSlidesDto, SaveSceneDto } from './dto/slides.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('slides')
@Controller('presentations/:presentationId/slides')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SlidesController {
    constructor(private slidesService: SlidesService) { }

    @Post()
    @ApiOperation({ summary: 'Add a new slide to presentation' })
    async create(
        @CurrentUser() user: any,
        @Param('presentationId') presentationId: string,
        @Body() dto: CreateSlideDto,
    ) {
        return this.slidesService.create(presentationId, user.id, dto);
    }

    @Get()
    @ApiOperation({ summary: 'Get all slides for a presentation' })
    async findAll(
        @CurrentUser() user: any,
        @Param('presentationId') presentationId: string,
    ) {
        return this.slidesService.findAll(presentationId, user.id);
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get slide by ID' })
    async findById(@CurrentUser() user: any, @Param('id') id: string) {
        return this.slidesService.findById(id, user.id);
    }

    @Put(':id')
    @ApiOperation({ summary: 'Update slide' })
    async update(
        @CurrentUser() user: any,
        @Param('id') id: string,
        @Body() dto: UpdateSlideDto,
    ) {
        return this.slidesService.update(id, user.id, dto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete slide' })
    async delete(@CurrentUser() user: any, @Param('id') id: string) {
        return this.slidesService.delete(id, user.id);
    }

    @Post('reorder')
    @ApiOperation({ summary: 'Reorder slides' })
    async reorder(
        @CurrentUser() user: any,
        @Param('presentationId') presentationId: string,
        @Body() dto: ReorderSlidesDto,
    ) {
        return this.slidesService.reorder(presentationId, user.id, dto);
    }

    @Post(':id/duplicate')
    @ApiOperation({ summary: 'Duplicate slide' })
    async duplicate(@CurrentUser() user: any, @Param('id') id: string) {
        return this.slidesService.duplicate(id, user.id);
    }

    @Get(':id/scene')
    @ApiOperation({ summary: 'Get the slide as an editable SlideScene' })
    async getScene(@CurrentUser() user: any, @Param('id') id: string) {
        return this.slidesService.getScene(id, user.id);
    }

    @Patch(':id/scene')
    @ApiOperation({ summary: 'Save an edited SlideScene back onto the slide' })
    async saveScene(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: SaveSceneDto) {
        return this.slidesService.saveScene(id, user.id, dto.scene);
    }
}
