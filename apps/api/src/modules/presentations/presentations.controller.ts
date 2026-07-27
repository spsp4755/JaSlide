import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
    ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PresentationsService } from './presentations.service';
import { CreatePresentationDto, UpdatePresentationDto } from './dto/presentations.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('presentations')
@Controller('presentations')
export class PresentationsController {
    constructor(private presentationsService: PresentationsService) { }

    @Post()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Create a new presentation' })
    async create(@CurrentUser() user: any, @Body() dto: CreatePresentationDto) {
        return this.presentationsService.create(user.id, dto);
    }

    @Get()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get all presentations for current user' })
    async findAll(
        @CurrentUser() user: any,
        @Query('page') page?: number,
        @Query('limit') limit?: number,
    ) {
        return this.presentationsService.findAll(user.id, page || 1, limit || 10);
    }

    @Get('shared/:token')
    @ApiOperation({ summary: 'Get presentation by share token (public)' })
    async findByShareToken(@Param('token') token: string) {
        return this.presentationsService.findByShareToken(token);
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get presentation by ID' })
    async findById(@CurrentUser() user: any, @Param('id') id: string) {
        return this.presentationsService.findById(id, user.id);
    }

    @Put(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Update presentation' })
    async update(
        @CurrentUser() user: any,
        @Param('id') id: string,
        @Body() dto: UpdatePresentationDto,
    ) {
        return this.presentationsService.update(id, user.id, dto);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Delete presentation' })
    async delete(@CurrentUser() user: any, @Param('id') id: string) {
        return this.presentationsService.delete(id, user.id);
    }

    @Get(':id/slides/:order/template-html')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Base HTML the editor renders for one slide' })
    async slideTemplateHtml(
        @CurrentUser() user: any,
        @Param('id') id: string,
        @Param('order', ParseIntPipe) order: number,
    ) {
        return this.presentationsService.slideTemplateHtml(id, user.id, order);
    }

    @Post(':id/share')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Generate share link for presentation' })
    async share(@CurrentUser() user: any, @Param('id') id: string) {
        return this.presentationsService.generateShareToken(id, user.id);
    }

    @Post(':id/duplicate')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Duplicate presentation' })
    async duplicate(@CurrentUser() user: any, @Param('id') id: string) {
        return this.presentationsService.duplicate(id, user.id);
    }
}
