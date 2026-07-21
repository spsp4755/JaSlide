import {
    Controller,
    Get,
    Put,
    Body,
    Param,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/users.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('users')
@Controller('users')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UsersController {
    constructor(private usersService: UsersService) { }

    @Get('me')
    @ApiOperation({ summary: 'Get current user profile' })
    async getProfile(@CurrentUser() user: any) {
        return this.usersService.findById(user.id);
    }

    @Put('me')
    @ApiOperation({ summary: 'Update current user profile' })
    async updateProfile(@CurrentUser() user: any, @Body() dto: UpdateUserDto) {
        return this.usersService.update(user.id, dto);
    }

    @Get('me/presentations')
    @ApiOperation({ summary: 'Get current user presentations' })
    async getPresentations(
        @CurrentUser() user: any,
        @Query('page') page?: number,
        @Query('limit') limit?: number,
    ) {
        return this.usersService.getPresentations(user.id, page || 1, limit || 10);
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get user by ID (admin only)' })
    async getUser(@Param('id') id: string) {
        return this.usersService.findById(id);
    }
}
