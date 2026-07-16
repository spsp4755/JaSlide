import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';
import { RbacGuard, RbacService } from './guards/rbac.guard';
import { AuditService } from './services/audit.service';
import { OidcService } from './services/oidc.service';
import { EncryptionService } from './services/encryption.service';

// Conditionally import Google Strategy only when credentials are available
const googleStrategyProvider = process.env.GOOGLE_CLIENT_ID
    ? [require('./strategies/google.strategy').GoogleStrategy]
    : [];

const requireJwtSecret = (configService: ConfigService) => {
    const secret = configService.get<string>('JWT_SECRET')?.trim();
    if (!secret) throw new Error('JWT_SECRET must be configured');
    return secret;
};

@Module({
    imports: [
        UsersModule,
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.registerAsync({
            imports: [ConfigModule],
            useFactory: async (configService: ConfigService) => ({
                secret: requireJwtSecret(configService),
                signOptions: {
                    expiresIn: configService.get<string>('JWT_EXPIRES_IN') || '7d',
                },
            }),
            inject: [ConfigService],
        }),
    ],
    controllers: [AuthController],
    providers: [
        AuthService,
        JwtStrategy,
        RbacGuard,
        RbacService,
        AuditService,
        OidcService,
        EncryptionService,
        ...googleStrategyProvider,
    ],
    exports: [AuthService, RbacGuard, RbacService, AuditService, OidcService, EncryptionService],
})
export class AuthModule { }


