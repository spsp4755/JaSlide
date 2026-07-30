import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { OidcService } from './services/oidc.service';
import { JwtService } from '@nestjs/jwt';

describe('HTTP authentication contract', () => {
    const user = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'USER',
    };
    const principal = {
        ...user,
        image: null,
        organizationId: null,
        status: 'ACTIVE',
    };
    const authService = {
        login: jest.fn(),
        register: jest.fn(),
    };
    let app: INestApplication;

    beforeAll(async () => {
        const module = await Test.createTestingModule({
            controllers: [AuthController],
            providers: [
                { provide: AuthService, useValue: authService },
                { provide: OidcService, useValue: {} },
                { provide: JwtService, useValue: {} },
            ],
        })
            .overrideGuard(JwtAuthGuard)
            .useValue({
                canActivate(context: any) {
                    context.switchToHttp().getRequest().user = principal;
                    return true;
                },
            })
            .compile();
        app = module.createNestApplication();
        app.setGlobalPrefix('api');
        await app.init();
    });

    afterAll(() => app.close());

    beforeEach(() => jest.clearAllMocks());

    it('returns only user JSON and the legacy session cookie on login', async () => {
        authService.login.mockResolvedValue({ user, accessToken: 'signed-token' });

        const response = await request(app.getHttpServer())
            .post('/api/auth/login')
            .send({ email: user.email, password: 'password123' })
            .expect(200);

        expect(response.body).toEqual({ user });
        expect(response.headers['set-cookie']).toEqual([
            'jaslide_session=signed-token; Path=/; HttpOnly; SameSite=Lax',
        ]);
    });

    it('keeps the existing invalid-login response', async () => {
        authService.login.mockRejectedValue(new UnauthorizedException('Invalid credentials'));

        const response = await request(app.getHttpServer())
            .post('/api/auth/login')
            .send({ email: user.email, password: 'wrong' })
            .expect(401);

        expect(response.body).toEqual({
            message: 'Invalid credentials',
            error: 'Unauthorized',
            statusCode: 401,
        });
    });

    it('clears the same cookie and returns no content on logout', async () => {
        const response = await request(app.getHttpServer())
            .post('/api/auth/logout')
            .expect(204);

        expect(response.text).toBe('');
        expect(response.headers['set-cookie']).toEqual([
            'jaslide_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax',
        ]);
    });

    it('returns the database-backed principal from me', async () => {
        const response = await request(app.getHttpServer())
            .get('/api/auth/me')
            .expect(200);

        expect(response.body).toEqual(principal);
    });
});
