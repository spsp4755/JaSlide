import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminTemplatesService } from './admin-templates.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { PaginationDto } from '../dto';

@Controller('admin/templates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminTemplatesController {
    constructor(private templatesService: AdminTemplatesService) { }

    @Get()
    async findAll(@Query() filter: PaginationDto & { category?: string; isPublic?: boolean }) {
        return this.templatesService.findAll(filter);
    }

    @Get(':id')
    async findById(@Param('id') id: string) {
        return this.templatesService.findById(id);
    }

    @Post()
    async create(@Body() data: any) {
        return this.templatesService.create(data);
    }

    @Post('import-pptx')
    @UseInterceptors(FileInterceptor('file', {
        limits: { fileSize: 20 * 1024 * 1024 },
        // Browsers and offline clients often send an empty or generic MIME type
        // for .pptx files. The renderer validates the actual OOXML ZIP package.
        fileFilter: (_request, file, callback) => callback(null, file.originalname.toLowerCase().endsWith('.pptx')),
    }))
    async importPptx(
        @UploadedFile() file: Express.Multer.File,
        @Body() data: { name: string; description?: string; category?: string; isPublic?: boolean; organizationId?: string },
    ) {
        return this.templatesService.importPptx(file, data);
    }

    @Post(':id/reextract-pptx')
    async reextractPptx(@Param('id') id: string) {
        return this.templatesService.reextractPptx(id);
    }

    @Post('import-html-zip')
    @UseInterceptors(FileInterceptor('file', {
        limits: { fileSize: 20 * 1024 * 1024 },
        fileFilter: (_request, file, callback) => callback(
            null,
            file.originalname.toLowerCase().endsWith('.zip') &&
            ['application/zip', 'application/x-zip-compressed'].includes(file.mimetype),
        ),
    }))
    async importHtmlZip(
        @UploadedFile() file: Express.Multer.File,
        @Body() data: { name: string; description?: string; category?: string; isPublic?: boolean; organizationId?: string },
    ) {
        return this.templatesService.importHtmlZip(file, data);
    }

    @Patch(':id')
    async update(@Param('id') id: string, @Body() data: any) {
        return this.templatesService.update(id, data);
    }

    @Delete(':id')
    async delete(@Param('id') id: string) {
        return this.templatesService.delete(id);
    }

    // Color Palettes
    @Get('palettes/list')
    async findColorPalettes(@Query() filter: PaginationDto) {
        return this.templatesService.findColorPalettes(filter);
    }

    @Post('palettes')
    async createColorPalette(@Body() data: any) {
        return this.templatesService.createColorPalette(data);
    }

    @Delete('palettes/:id')
    async deleteColorPalette(@Param('id') id: string) {
        return this.templatesService.deleteColorPalette(id);
    }

    // Layout Rules
    @Get('layouts/list')
    async findLayoutRules(@Query() filter: PaginationDto) {
        return this.templatesService.findLayoutRules(filter);
    }

    @Post('layouts')
    async createLayoutRule(@Body() data: any) {
        return this.templatesService.createLayoutRule(data);
    }

    @Delete('layouts/:id')
    async deleteLayoutRule(@Param('id') id: string) {
        return this.templatesService.deleteLayoutRule(id);
    }
}
