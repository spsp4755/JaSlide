import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(
        private configService: ConfigService,
        private prisma: PrismaService,
    ) {
        super({
            jwtFromRequest: ExtractJwt.fromExtractors([
                (request) => request?.cookies?.jaslide_session
                    || request?.headers?.cookie?.match(/(?:^|;\s*)jaslide_session=([^;]+)/)?.[1],
                ExtractJwt.fromAuthHeaderAsBearerToken(),
            ]),
            ignoreExpiration: false,
            secretOrKey: configService.get<string>('JWT_SECRET') || 'your-secret-key',
        });
    }

    async validate(payload: { sub: string; email: string }) {
        if (!payload?.sub) {
            throw new UnauthorizedException('Invalid token payload');
        }

        const user = await this.prisma.user.findUnique({
            where: { id: payload.sub },
            select: {
                id: true,
                email: true,
                name: true,
                image: true,
                creditsRemaining: true,
                role: true,
                organizationId: true,
                status: true,
            },
        });

        if (!user) {
            throw new UnauthorizedException('User not found');
        }

        if (user.status === 'SUSPENDED' || user.status === 'INACTIVE') {
            throw new UnauthorizedException('Account is suspended or inactive');
        }

        return user;
    }
}
