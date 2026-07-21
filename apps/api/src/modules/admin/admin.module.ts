import { Module } from '@nestjs/common';
import { AdminUsersModule } from './users/admin-users.module';
import { AdminOrganizationsModule } from './organizations/admin-organizations.module';
import { AdminRolesModule } from './roles/admin-roles.module';
import { AdminTemplatesModule } from './templates/admin-templates.module';
import { AdminModelsModule } from './models/admin-models.module';
import { AdminPromptsModule } from './prompts/admin-prompts.module';
import { AdminAssetsModule } from './assets/admin-assets.module';
import { AdminJobsModule } from './jobs/admin-jobs.module';
import { AdminDocumentsModule } from './documents/admin-documents.module';
import { AdminPoliciesModule } from './policies/admin-policies.module';
import { AdminLogsModule } from './logs/admin-logs.module';
import { AdminOperationsModule } from './operations/admin-operations.module';
import { AdminAlertsModule } from './alerts/admin-alerts.module';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';
import { PrismaModule } from '../../prisma/prisma.module';
// New Admin CRUD Modules
import { AdminSecurityPoliciesModule } from './security-policies/admin-security-policies.module';
import { AdminSessionsModule } from './sessions/admin-sessions.module';
import { AdminPermissionsModule } from './permissions/admin-permissions.module';
import { AdminLayoutsModule } from './layouts/admin-layouts.module';
import { AdminThemesModule } from './themes/admin-themes.module';
import { AdminFontSetsModule } from './font-sets/admin-font-sets.module';
import { AdminColorPalettesModule } from './color-palettes/admin-color-palettes.module';
import { AdminSeedDataModule } from './seed-data/admin-seed-data.module';
import { AdminApiKeysModule } from './api-keys/admin-api-keys.module';
import { AdminWebhooksModule } from './webhooks/admin-webhooks.module';
import { AdminIntegrationsModule } from './integrations/admin-integrations.module';

@Module({
    imports: [
        PrismaModule,
        AdminUsersModule,
        AdminOrganizationsModule,
        AdminRolesModule,
        AdminTemplatesModule,
        AdminModelsModule,
        AdminPromptsModule,
        AdminAssetsModule,
        AdminJobsModule,
        AdminDocumentsModule,
        AdminPoliciesModule,
        AdminLogsModule,
        AdminOperationsModule,
        AdminAlertsModule,
        // New Admin CRUD Modules
        AdminSecurityPoliciesModule,
        AdminSessionsModule,
        AdminPermissionsModule,
        AdminLayoutsModule,
        AdminThemesModule,
        AdminFontSetsModule,
        AdminColorPalettesModule,
        AdminSeedDataModule,
        AdminApiKeysModule,
        AdminWebhooksModule,
        AdminIntegrationsModule,
    ],
    controllers: [AdminDashboardController],
    providers: [AdminDashboardService],
})
export class AdminModule { }

