import { Body, Controller, Delete, Get, Post, Query, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateSkillDto } from './dto/skill.dto';
import { SkillsService } from './skills.service';

@Controller('skills')
@UseGuards(JwtAuthGuard)
export class SkillsController {
    constructor(private skillsService: SkillsService) {}

    @Get()
    findVisible(@CurrentUser() user: { id: string; organizationId?: string }, @Query('category') category?: string) {
        return this.skillsService.findVisible(user, category);
    }

    @Post()
    create(@CurrentUser() user: { id: string; organizationId?: string }, @Body() dto: CreateSkillDto) {
        return this.skillsService.create(user, dto);
    }

    @Delete()
    removeMany(@CurrentUser() user: { id: string }, @Body('ids') ids: string[]) {
        return this.skillsService.removeMany(user.id, ids);
    }

    @Post('import-pptx')
    @ApiConsumes('multipart/form-data')
    @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
    importPptx(
        @CurrentUser() user: { id: string; organizationId?: string },
        @UploadedFile() file: Express.Multer.File,
        @Body('name') name?: string,
    ) {
        return this.skillsService.importPptx(user, file, name);
    }
}
