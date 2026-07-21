import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export interface PermissionDto {
    name: string;
    resource: string;
    action: string;
    description?: string;
}

export interface ResourcePolicyDto {
    resource: string;
    permissions: string[];
    description?: string;
}

// Predefined permission actions
export const PERMISSION_ACTIONS = ['create', 'read', 'update', 'delete', 'manage'] as const;

// Predefined resources
export const RESOURCES = [
    'users', 'roles', 'organizations', 'presentations', 'templates',
    'models', 'prompts', 'policies', 'logs', 'settings',
    'assets', 'webhooks', 'api-keys',
] as const;

@Injectable()
export class AdminPermissionsService {
    constructor(private prisma: PrismaService) { }

    // ===============================
    // Permission Definition CRUD
    // ===============================

    async getAllPermissions() {
        const policy = await this.prisma.systemPolicy.findUnique({
            where: { key: 'rbac.permissions' },
        });
        return policy?.value || this.getDefaultPermissions();
    }

    async createPermission(dto: PermissionDto) {
        const permissions = (await this.getAllPermissions()) as unknown as PermissionDto[];
        const exists = permissions.find(p => p.name === dto.name);

        if (exists) {
            throw new BadRequestException('Permission already exists');
        }

        const updated = [...permissions, dto];
        await this.savePermissions(updated);

        await this.createAuditLog('CREATE', 'PERMISSION', dto);
        return dto;
    }

    async updatePermission(name: string, dto: Partial<PermissionDto>) {
        const permissions = (await this.getAllPermissions()) as unknown as PermissionDto[];
        const index = permissions.findIndex(p => p.name === name);

        if (index === -1) {
            throw new NotFoundException('Permission not found');
        }

        permissions[index] = { ...permissions[index], ...dto };
        await this.savePermissions(permissions);

        await this.createAuditLog('UPDATE', 'PERMISSION', { name, ...dto });
        return permissions[index];
    }

    async deletePermission(name: string) {
        const permissions = (await this.getAllPermissions()) as unknown as PermissionDto[];
        const filtered = permissions.filter(p => p.name !== name);

        if (filtered.length === permissions.length) {
            throw new NotFoundException('Permission not found');
        }

        await this.savePermissions(filtered);
        await this.createAuditLog('DELETE', 'PERMISSION', { name });

        return { success: true };
    }

    private async savePermissions(permissions: PermissionDto[]) {
        await this.prisma.systemPolicy.upsert({
            where: { key: 'rbac.permissions' },
            create: {
                category: 'rbac',
                key: 'rbac.permissions',
                value: permissions as unknown as any,
                description: 'System permission definitions',
            },
            update: { value: permissions as unknown as any },
        });
    }

    // ===============================
    // Role-Permission Mapping
    // ===============================

    async getRolePermissions(roleId: string) {
        const role = await this.prisma.role.findUnique({
            where: { id: roleId },
            select: { id: true, name: true, permissions: true },
        });

        if (!role) {
            throw new NotFoundException('Role not found');
        }

        return role;
    }

    async setRolePermissions(roleId: string, permissions: string[]) {
        const role = await this.prisma.role.findUnique({ where: { id: roleId } });

        if (!role) {
            throw new NotFoundException('Role not found');
        }

        if (role.isSystem) {
            throw new BadRequestException('Cannot modify system role permissions');
        }

        const updated = await this.prisma.role.update({
            where: { id: roleId },
            data: { permissions },
        });

        await this.createAuditLog('UPDATE', 'ROLE_PERMISSIONS', { roleId, permissions });
        return updated;
    }

    async addPermissionToRole(roleId: string, permission: string) {
        const role = await this.prisma.role.findUnique({ where: { id: roleId } });

        if (!role) {
            throw new NotFoundException('Role not found');
        }

        const currentPermissions = (role.permissions as string[]) || [];
        if (currentPermissions.includes(permission)) {
            return role;
        }

        const updated = await this.prisma.role.update({
            where: { id: roleId },
            data: { permissions: [...currentPermissions, permission] },
        });

        await this.createAuditLog('ADD_PERMISSION', 'ROLE', { roleId, permission });
        return updated;
    }

    async removePermissionFromRole(roleId: string, permission: string) {
        const role = await this.prisma.role.findUnique({ where: { id: roleId } });

        if (!role) {
            throw new NotFoundException('Role not found');
        }

        const currentPermissions = (role.permissions as string[]) || [];
        const updated = await this.prisma.role.update({
            where: { id: roleId },
            data: { permissions: currentPermissions.filter(p => p !== permission) },
        });

        await this.createAuditLog('REMOVE_PERMISSION', 'ROLE', { roleId, permission });
        return updated;
    }

    // ===============================
    // Resource Policy Management
    // ===============================

    async getResourcePolicies() {
        const policy = await this.prisma.systemPolicy.findUnique({
            where: { key: 'rbac.resource-policies' },
        });
        return policy?.value || this.getDefaultResourcePolicies();
    }

    async setResourcePolicy(dto: ResourcePolicyDto) {
        const policies = (await this.getResourcePolicies()) as unknown as ResourcePolicyDto[];
        const index = policies.findIndex(p => p.resource === dto.resource);

        if (index >= 0) {
            policies[index] = dto;
        } else {
            policies.push(dto);
        }

        await this.prisma.systemPolicy.upsert({
            where: { key: 'rbac.resource-policies' },
            create: {
                category: 'rbac',
                key: 'rbac.resource-policies',
                value: policies as unknown as any,
                description: 'Resource-level access policies',
            },
            update: { value: policies as unknown as any },
        });

        await this.createAuditLog('UPDATE', 'RESOURCE_POLICY', dto);
        return dto;
    }

    async deleteResourcePolicy(resource: string) {
        const policies = (await this.getResourcePolicies()) as unknown as ResourcePolicyDto[];
        const filtered = policies.filter(p => p.resource !== resource);

        await this.prisma.systemPolicy.upsert({
            where: { key: 'rbac.resource-policies' },
            create: {
                category: 'rbac',
                key: 'rbac.resource-policies',
                value: filtered as unknown as any,
                description: 'Resource-level access policies',
            },
            update: { value: filtered as unknown as any },
        });

        await this.createAuditLog('DELETE', 'RESOURCE_POLICY', { resource });
        return { success: true };
    }

    // ===============================
    // Permission Check Utilities
    // ===============================

    async checkUserPermission(userId: string, resource: string, action: string): Promise<boolean> {
        // Get user's direct role
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { role: true },
        });

        if (!user) return false;

        // System admins have all permissions
        if (user.role === ('SYSTEM_ADMIN' as any)) return true;

        // Get user's assigned roles
        const assignments = await this.prisma.userRoleAssignment.findMany({
            where: { userId },
            include: { role: true },
        });

        const allPermissions = new Set<string>();

        // Collect permissions from all roles
        for (const assignment of assignments) {
            const perms = assignment.role.permissions as string[];
            perms?.forEach(p => allPermissions.add(p));
        }

        // Check for specific permission or wildcard
        const permissionKey = `${resource}:${action}`;
        const wildcardKey = `${resource}:*`;
        const fullWildcard = '*:*';

        return allPermissions.has(permissionKey) ||
            allPermissions.has(wildcardKey) ||
            allPermissions.has(fullWildcard);
    }

    // ===============================
    // Default Data
    // ===============================

    private getDefaultPermissions(): PermissionDto[] {
        const permissions: PermissionDto[] = [];

        for (const resource of RESOURCES) {
            for (const action of PERMISSION_ACTIONS) {
                permissions.push({
                    name: `${resource}:${action}`,
                    resource,
                    action,
                    description: `Can ${action} ${resource}`,
                });
            }
        }

        return permissions;
    }

    private getDefaultResourcePolicies(): ResourcePolicyDto[] {
        return RESOURCES.map(resource => ({
            resource,
            permissions: PERMISSION_ACTIONS.map(action => `${resource}:${action}`),
            description: `Access policy for ${resource}`,
        }));
    }

    private async createAuditLog(action: string, resource: string, details?: any) {
        await this.prisma.auditLog.create({
            data: { action, resource, details },
        });
    }
}

