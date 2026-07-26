import {
    Controller,
    Get,
    Post,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
    UseInterceptors,
    UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MultipartUtf8Interceptor } from '../../multipart-utf8.interceptor';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { AssetsService } from './assets.service';
import { ChartService, ChartData, ChartConfig } from './chart.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('assets')
@Controller('assets')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AssetsController {
    constructor(
        private assetsService: AssetsService,
        private chartService: ChartService,
    ) { }

    @Post('upload')
    @ApiOperation({ summary: 'Upload an asset' })
    @ApiConsumes('multipart/form-data')
    @UseInterceptors(FileInterceptor('file'), MultipartUtf8Interceptor)
    async upload(
        @CurrentUser() user: any,
        @UploadedFile() file: Express.Multer.File,
        @Query('type') type?: 'IMAGE' | 'ICON' | 'LOGO' | 'BACKGROUND',
    ) {
        return this.assetsService.upload(
            user.id,
            {
                filename: file.originalname,
                mimeType: file.mimetype,
                size: file.size,
                buffer: file.buffer,
            },
            type || 'IMAGE',
        );
    }

    @Get()
    @ApiOperation({ summary: 'Get all user assets' })
    async findAll(@CurrentUser() user: any, @Query('type') type?: string) {
        return this.assetsService.findAll(user.id, type);
    }

    @Get('stock')
    @ApiOperation({ summary: 'Search stock images' })
    async searchStock(@Query('q') query: string) {
        return this.assetsService.getStockImages(query);
    }

    @Get('icons')
    @ApiOperation({ summary: 'Search icons' })
    async searchIcons(@Query('q') query: string) {
        return this.assetsService.getIcons(query);
    }

    @Post('chart')
    @ApiOperation({ summary: 'Generate a chart SVG' })
    async generateChart(
        @Body() body: { data: ChartData; config?: ChartConfig },
    ) {
        return this.chartService.generateChart(body.data, body.config);
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get asset by ID' })
    async findById(@Param('id') id: string) {
        return this.assetsService.findById(id);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete asset' })
    async delete(@CurrentUser() user: any, @Param('id') id: string) {
        return this.assetsService.delete(id, user.id);
    }
}

