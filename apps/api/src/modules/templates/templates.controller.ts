import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { TemplatesService } from './templates.service';

@ApiTags('templates')
@Controller('templates')
export class TemplatesController {
    constructor(private templatesService: TemplatesService) { }

    @Get()
    @ApiOperation({ summary: 'Get all public templates' })
    async findAll(@Query('category') category?: string) {
        return this.templatesService.findAll(category);
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get template by ID' })
    async findById(@Param('id') id: string) {
        return this.templatesService.findById(id);
    }
}
