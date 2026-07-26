import { Controller, Post, Get, Param, Query, Res, UseGuards, Body } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ExportService } from './export.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('export')
@Controller('export')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ExportController {
    constructor(private exportService: ExportService) { }

    @Post(':presentationId/pptx')
    @ApiOperation({ summary: 'Export presentation to PPTX' })
    async exportPptx(
        @CurrentUser() user: any,
        @Param('presentationId') presentationId: string,
        @Body('editable') editable: boolean,
        @Res() res: Response,
    ) {
        const result = await this.exportService.exportToPptx(presentationId, user.id, editable);

        // Encode filename for non-ASCII characters (RFC 5987)
        const encodedFilename = encodeURIComponent(result.filename).replace(/['()]/g, escape);

        res.setHeader('Content-Type', result.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
        res.send(result.buffer);
    }

    @Post(':presentationId/pdf')
    @ApiOperation({ summary: 'Export presentation to PDF' })
    async exportPdf(
        @CurrentUser() user: any,
        @Param('presentationId') presentationId: string,
        @Res() res: Response,
    ) {
        const result = await this.exportService.exportToPdf(presentationId, user.id);

        // Encode filename for non-ASCII characters (RFC 5987)
        const encodedFilename = encodeURIComponent(result.filename).replace(/['()]/g, escape);

        res.setHeader('Content-Type', result.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
        res.send(result.buffer);
    }

    @Post(':presentationId/google-slides')
    @ApiOperation({ summary: 'Export presentation to Google Slides' })
    async exportGoogleSlides(
        @CurrentUser() user: any,
        @Param('presentationId') presentationId: string,
        @Query('accessToken') accessToken: string,
    ) {
        return this.exportService.exportToGoogleSlides(presentationId, user.id, accessToken);
    }

    @Get(':presentationId/preview')
    @ApiOperation({ summary: 'Get slide preview image' })
    async getPreview(
        @CurrentUser() user: any,
        @Param('presentationId') presentationId: string,
        @Query('slide') slideIndex: number,
        @Res() res: Response,
    ) {
        const result = await this.exportService.getExportPreview(
            presentationId,
            user.id,
            slideIndex || 0,
        );

        res.setHeader('Content-Type', result.mimeType);
        res.send(result.buffer);
    }
}
