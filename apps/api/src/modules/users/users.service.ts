import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateUserDto } from './dto/users.dto';

@Injectable()
export class UsersService {
    constructor(private prisma: PrismaService) { }

    async findById(id: string) {
        const user = await this.prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                email: true,
                name: true,
                image: true,
                role: true,
                preferences: true,
                organizationId: true,
                createdAt: true,
            },
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        return user;
    }

    async findByEmail(email: string) {
        return this.prisma.user.findUnique({
            where: { email },
        });
    }

    async update(id: string, dto: UpdateUserDto) {
        const user = await this.prisma.user.update({
            where: { id },
            data: {
                name: dto.name,
                image: dto.image,
                preferences: dto.preferences,
            },
            select: {
                id: true,
                email: true,
                name: true,
                image: true,
                role: true,
                preferences: true,
                organizationId: true,
            },
        });

        return user;
    }

    async getPresentations(userId: string, page = 1, limit = 10) {
        const skip = (page - 1) * limit;

        const [presentations, total] = await Promise.all([
            this.prisma.presentation.findMany({
                where: { userId },
                orderBy: { updatedAt: 'desc' },
                skip,
                take: limit,
                select: {
                    id: true,
                    title: true,
                    status: true,
                    sourceType: true,
                    createdAt: true,
                    updatedAt: true,
                    _count: { select: { slides: true } },
                },
            }),
            this.prisma.presentation.count({ where: { userId } }),
        ]);

        return {
            data: presentations,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }
}
