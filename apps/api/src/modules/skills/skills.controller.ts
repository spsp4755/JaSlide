import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
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
}
