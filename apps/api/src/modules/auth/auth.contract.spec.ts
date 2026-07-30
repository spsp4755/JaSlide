import {
    ConflictException,
    INestApplication,
    UnauthorizedException,
    ValidationPipe,
} from '@nestjs/common';
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
        app.useGlobalPipes(new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
            transformOptions: { enableImplicitConversion: true },
        }));
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

    it('returns 201, user JSON, and the same session cookie on registration', async () => {
        authService.register.mockResolvedValue({ user, accessToken: 'registered-token' });

        const response = await request(app.getHttpServer())
            .post('/api/auth/register')
            .send({ email: user.email, password: 'password123', name: user.name })
            .expect(201);

        expect(response.body).toEqual({ user });
        expect(response.headers['set-cookie']).toEqual([
            'jaslide_session=registered-token; Path=/; HttpOnly; SameSite=Lax',
        ]);
    });

    it('keeps the existing duplicate-registration conflict', async () => {
        authService.register.mockRejectedValue(
            new ConflictException('User with this email already exists'),
        );

        const response = await request(app.getHttpServer())
            .post('/api/auth/register')
            .send({ email: user.email, password: 'password123', name: user.name })
            .expect(409);

        expect(response.body).toEqual({
            message: 'User with this email already exists',
            error: 'Conflict',
            statusCode: 409,
        });
    });

    it.each([
        [
            'missing password',
            { email: user.email },
            ['password should not be empty', 'password must be a string'],
        ],
        [
            'empty password',
            { email: user.email, password: '' },
            ['password should not be empty'],
        ],
        [
            'unknown property',
            { email: user.email, password: 'password123', extra: true },
            ['property extra should not exist'],
        ],
        [
            'single-label email domain',
            { email: 'a@b', password: 'password123' },
            ['email must be an email'],
        ],
        [
            'one-character top-level domain',
            { email: 'x@y.c', password: 'password123' },
            ['email must be an email'],
        ],
        [
            'case-variant email key',
            { Email: user.email, password: 'password123' },
            ['property Email should not exist', 'email must be an email'],
        ],
        [
            'case-variant password key',
            { email: user.email, Password: 'password123' },
            [
                'property Password should not exist',
                'password should not be empty',
                'password must be a string',
            ],
        ],
    ])('rejects %s using the global validation contract', async (_name, body, messages) => {
        const response = await request(app.getHttpServer())
            .post('/api/auth/login')
            .send(body)
            .expect(400);

        expect(response.body).toEqual({
            message: messages,
            error: 'Bad Request',
            statusCode: 400,
        });
        expect(authService.login).not.toHaveBeenCalled();
    });

    it.each([
        ['malformed JSON', '{"email":"test@example.com"'],
        [
            'multiple JSON values',
            '{"email":"test@example.com","password":"password123"}{"email":"other@example.com","password":"password123"}',
        ],
    ])('rejects %s before authentication', async (_name, body) => {
        const response = await request(app.getHttpServer())
            .post('/api/auth/login')
            .set('Content-Type', 'application/json')
            .send(body)
            .expect(400);

        expect(response.body.error).toBe('Bad Request');
        expect(response.body.statusCode).toBe(400);
        expect(typeof response.body.message).toBe('string');
        expect(authService.login).not.toHaveBeenCalled();
    });
});
