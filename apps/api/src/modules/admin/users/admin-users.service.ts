import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
    AdminCreateUserDto,
    AdminUpdateUserDto,
    AdminUserFilterDto,
} from '../dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AdminUsersService {
    constructor(private prisma: PrismaService) { }

    async findAll(filter: AdminUserFilterDto) {
        const { page = 1, limit = 20, search, role, status, organizationId, sortBy, sortOrder } = filter;
        const skip = (page - 1) * limit;

        const where: any = {};

        if (search) {
            where.OR = [
                { email: { contains: search, mode: 'insensitive' } },
                { name: { contains: search, mode: 'insensitive' } },
            ];
        }

        if (role) {
            where.role = role;
        }

        if (status) {
            where.status = status;
        }

        if (organizationId) {
            where.organizationId = organizationId;
        }

        const [users, total] = await Promise.all([
            this.prisma.user.findMany({
                where,
                skip,
                take: limit,
                orderBy: sortBy ? { [sortBy]: sortOrder || 'desc' } : { createdAt: 'desc' },
                select: {
                    id: true,
                    email: true,
                    name: true,
                    image: true,
                    role: true,
                    status: true,
                    organizationId: true,
                    organization: { select: { id: true, name: true } },
                    lastLoginAt: true,
                    createdAt: true,
                    updatedAt: true,
                    _count: { select: { presentations: true } },
                },
            }),
            this.prisma.user.count({ where }),
        ]);

        return {
            data: users,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }

    async findById(id: string) {
        const user = await this.prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                email: true,
                name: true,
                image: true,
                role: true,
                status: true,
                preferences: true,
                organizationId: true,
                organization: { select: { id: true, name: true, slug: true } },
                lastLoginAt: true,
                createdAt: true,
                updatedAt: true,
                _count: { select: { presentations: true } },
            },
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        return user;
    }

    async create(dto: AdminCreateUserDto) {
        // Check if email already exists
        const existing = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });

        if (existing) {
            throw new BadRequestException('Email already exists');
        }

        // Hash password if provided
        let hashedPassword: string | undefined;
        if (dto.password) {
            hashedPassword = await bcrypt.hash(dto.password, 10);
        }

        const user = await this.prisma.user.create({
            data: {
                email: dto.email,
                name: dto.name,
                password: hashedPassword,
                organizationId: dto.organizationId,
                role: dto.role || 'USER',
            },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                status: true,
                organizationId: true,
                createdAt: true,
            },
        });

        // Create audit log
        await this.prisma.auditLog.create({
            data: {
                action: 'CREATE',
                resource: 'USER',
                resourceId: user.id,
                details: { email: dto.email },
            },
        });

        return user;
    }

    async update(id: string, dto: AdminUpdateUserDto) {
        const existing = await this.prisma.user.findUnique({ where: { id } });
        if (!existing) {
            throw new NotFoundException('User not found');
        }

        const user = await this.prisma.user.update({
            where: { id },
            data: {
                name: dto.name,
                image: dto.image,
                role: dto.role,
                status: dto.status,
                organizationId: dto.organizationId,
            },
            select: {
                id: true,
                email: true,
                name: true,
                image: true,
                role: true,
                status: true,
                organizationId: true,
                updatedAt: true,
            },
        });

        // Create audit log
        await this.prisma.auditLog.create({
            data: {
                action: 'UPDATE',
                resource: 'USER',
                resourceId: id,
                details: { ...dto },
            },
        });

        return user;
    }

    async delete(id: string) {
        const existing = await this.prisma.user.findUnique({ where: { id } });
        if (!existing) {
            throw new NotFoundException('User not found');
        }

        // Soft delete by setting status to INACTIVE
        await this.prisma.user.update({
            where: { id },
            data: { status: 'INACTIVE' },
        });

        // Create audit log
        await this.prisma.auditLog.create({
            data: {
                action: 'DELETE',
                resource: 'USER',
                resourceId: id,
            },
        });

        return { success: true, message: 'User deactivated successfully' };
    }

}
