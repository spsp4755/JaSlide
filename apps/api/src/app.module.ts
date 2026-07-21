import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { PresentationsModule } from './modules/presentations/presentations.module';
import { SlidesModule } from './modules/slides/slides.module';
import { GenerationModule } from './modules/generation/generation.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { AssetsModule } from './modules/assets/assets.module';
import { ExportModule } from './modules/export/export.module';
import { LlmModule } from './modules/llm/llm.module';
import { QueueModule } from './modules/queue/queue.module';
import { HealthModule } from './modules/health/health.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { AdminModule } from './modules/admin/admin.module';
// CRUD UIUX Extension modules
import { BlocksModule } from './modules/blocks/blocks.module';
import { VersionsModule } from './modules/versions/versions.module';
import { CommentsModule } from './modules/comments/comments.module';
import { CollaboratorsModule } from './modules/collaborators/collaborators.module';
import { FavoritesModule } from './modules/favorites/favorites.module';
import { ExportPresetsModule } from './modules/export-presets/export-presets.module';
import { RecentWorksModule } from './modules/recent-works/recent-works.module';
import { ColorPalettesModule } from './modules/color-palettes/color-palettes.module';
import { FontSetsModule } from './modules/font-sets/font-sets.module';
import { InputPromptsModule } from './modules/input-prompts/input-prompts.module';
import { SkillsModule } from './modules/skills/skills.module';

@Module({
    imports: [
        // Configuration
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: ['.env.local', '.env'],
        }),

        // Rate limiting
        ThrottlerModule.forRoot([
            {
                ttl: 60000, // 1 minute
                limit: 100, // 100 requests per minute
            },
        ]),

        // Database
        PrismaModule,

        // Feature modules
        AuthModule,
        UsersModule,
        PresentationsModule,
        SlidesModule,
        GenerationModule,
        TemplatesModule,
        AssetsModule,
        ExportModule,
        LlmModule,
        QueueModule,
        HealthModule,
        MonitoringModule,

        // CRUD UIUX Extension modules
        BlocksModule,
        VersionsModule,
        CommentsModule,
        CollaboratorsModule,
        FavoritesModule,
        ExportPresetsModule,
        RecentWorksModule,
        ColorPalettesModule,
        FontSetsModule,
        InputPromptsModule,
        SkillsModule,

        // Admin module
        AdminModule,
    ],
})
export class AppModule { }

