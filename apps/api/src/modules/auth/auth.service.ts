import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto, RegisterDto, AuthResponse } from './dto/auth.dto';

@Injectable()
export class AuthService {
    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService,
        private configService: ConfigService,
    ) { }

    async register(dto: RegisterDto): Promise<AuthResponse> {
        // Check if user exists
        const existingUser = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });

        if (existingUser) {
            throw new ConflictException('User with this email already exists');
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(dto.password, 10);

        // Create user
        const user = await this.prisma.user.create({
            data: {
                email: dto.email,
                name: dto.name,
                password: hashedPassword,
            },
        });

        // Generate token
        const token = this.generateToken(user.id, user.email);

        return {
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
            },
            accessToken: token,
        };
    }

    async login(dto: LoginDto, ipAddress?: string, userAgent?: string): Promise<AuthResponse> {
        const user = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });

        // Check if account is locked
        if (user?.lockedUntil && user.lockedUntil > new Date()) {
            await this.logLoginAttempt(dto.email, false, user?.id, ipAddress, userAgent, 'Account is locked');
            throw new UnauthorizedException('Account is temporarily locked. Please try again later.');
        }

        if (!user || !user.password) {
            await this.logLoginAttempt(dto.email, false, null, ipAddress, userAgent, 'Invalid credentials');
            throw new UnauthorizedException('Invalid credentials');
        }

        const isPasswordValid = await bcrypt.compare(dto.password, user.password);

        if (!isPasswordValid) {
            // Increment failed attempts
            const attempts = user.failedLoginAttempts + 1;
            const lockoutThreshold = 5;

            await this.prisma.user.update({
                where: { id: user.id },
                data: {
                    failedLoginAttempts: attempts,
                    // Lock account for 15 minutes after 5 failed attempts
                    lockedUntil: attempts >= lockoutThreshold
                        ? new Date(Date.now() + 15 * 60 * 1000)
                        : null,
                },
            });

            await this.logLoginAttempt(dto.email, false, user.id, ipAddress, userAgent, 'Invalid password');
            throw new UnauthorizedException('Invalid credentials');
        }

        // Reset failed attempts on successful login
        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                failedLoginAttempts: 0,
                lockedUntil: null,
                lastLoginAt: new Date(),
            },
        });

        // Log successful login
        await this.logLoginAttempt(dto.email, true, user.id, ipAddress, userAgent);

        const token = this.generateToken(user.id, user.email);

        return {
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
            },
            accessToken: token,
        };
    }

    private async logLoginAttempt(
        email: string,
        success: boolean,
        userId?: string | null,
        ipAddress?: string,
        userAgent?: string,
        errorMsg?: string,
    ): Promise<void> {
        try {
            await this.prisma.loginLog.create({
                data: {
                    email,
                    success,
                    userId: userId || undefined,
                    ipAddress,
                    userAgent,
                    errorMsg,
                },
            });
        } catch {
            // Don't fail login if logging fails
        }
    }

    async validateOAuthUser(profile: {
        email: string;
        name?: string;
        image?: string;
        provider: string;
        providerAccountId: string;
    }): Promise<AuthResponse> {
        let user = await this.prisma.user.findUnique({
            where: { email: profile.email },
        });

        if (!user) {
            // Create new user
            user = await this.prisma.user.create({
                data: {
                    email: profile.email,
                    name: profile.name,
                    image: profile.image,
                    accounts: {
                        create: {
                            type: 'oauth',
                            provider: profile.provider,
                            providerAccountId: profile.providerAccountId,
                        },
                    },
                },
            });
        } else {
            // Link account if not already linked
            const existingAccount = await this.prisma.account.findUnique({
                where: {
                    provider_providerAccountId: {
                        provider: profile.provider,
                        providerAccountId: profile.providerAccountId,
                    },
                },
            });

            if (!existingAccount) {
                await this.prisma.account.create({
                    data: {
                        userId: user.id,
                        type: 'oauth',
                        provider: profile.provider,
                        providerAccountId: profile.providerAccountId,
                    },
                });
            }
        }

        const token = this.generateToken(user.id, user.email);

        return {
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
            },
            accessToken: token,
        };
    }

    async loginWithKeycloak(profile: {
        issuer: string;
        subject: string;
        email: string;
        name?: string;
        image?: string;
        roles: string[];
    }): Promise<AuthResponse> {
        const provider = 'keycloak';
        const providerAccountId = `${profile.issuer}|${profile.subject}`;
        const linkedAccount = await this.prisma.account.findUnique({
            where: { provider_providerAccountId: { provider, providerAccountId } },
            include: { user: true },
        });

        let user: any;
        if (linkedAccount) {
            user = linkedAccount.user;
            if (!user || user.email !== profile.email) {
                throw new UnauthorizedException('Invalid Keycloak account');
            }
        } else {
            user = await this.prisma.user.findUnique({ where: { email: profile.email } });
            if (user) {
                await this.prisma.account.create({
                    data: { userId: user.id, type: 'oauth', provider, providerAccountId },
                });
            } else {
                user = await this.prisma.user.create({
                    data: {
                        email: profile.email,
                        name: profile.name,
                        image: profile.image,
                        role: this.keycloakRole(profile.roles),
                        accounts: {
                            create: { type: 'oauth', provider, providerAccountId },
                        },
                    },
                });
            }
        }

        if (
            user.status === 'SUSPENDED'
            || user.status === 'INACTIVE'
            || (user.lockedUntil && user.lockedUntil > new Date())
        ) {
            throw new UnauthorizedException('Account is unavailable');
        }

        return {
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
            },
            accessToken: this.generateToken(user.id, user.email),
        };
    }

    private keycloakRole(roles: string[]) {
        const adminRoles = (this.configService.get<string>('KEYCLOAK_ADMIN_ROLES') || '')
            .split(',')
            .map((role) => role.trim())
            .filter(Boolean);
        return roles.some((role) => adminRoles.includes(role)) ? 'ADMIN' : 'USER';
    }

    private generateToken(userId: string, email: string): string {
        return this.jwtService.sign({ sub: userId, email });
    }

    async validateToken(token: string): Promise<{ userId: string; email: string } | null> {
        try {
            const payload = this.jwtService.verify(token);
            return { userId: payload.sub, email: payload.email };
        } catch {
            return null;
        }
    }
}
