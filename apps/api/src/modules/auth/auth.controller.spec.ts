jest.mock('bcrypt', () => ({}));

import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';

describe('AuthController', () => {
    const authService = {
        login: jest.fn(),
        register: jest.fn(),
    } as unknown as jest.Mocked<AuthService>;
    const response = {
        cookie: jest.fn(),
        clearCookie: jest.fn(),
    };
    const loginResult = {
        user: {
            id: 'user-123',
            email: 'test@example.com',
            name: 'Test User',
            creditsRemaining: 100,
            role: 'USER' as const,
        },
        accessToken: 'jwt-token',
    };
    let controller: AuthController;

    beforeEach(() => {
        jest.clearAllMocks();
        controller = new AuthController(authService);
    });

    it('sets an HttpOnly session cookie after local login', async () => {
        authService.login.mockResolvedValue(loginResult);

        const result = await (controller as any).login(
            { email: 'test@example.com', password: 'password123' },
            response,
        );

        expect(response.cookie).toHaveBeenCalledWith('jaslide_session', 'jwt-token', {
            httpOnly: true,
            sameSite: 'lax',
            secure: false,
            path: '/',
        });
        expect(result).not.toHaveProperty('accessToken');
    });

    it('sets an HttpOnly session cookie after local registration', async () => {
        authService.register.mockResolvedValue(loginResult);

        const result = await (controller as any).register(
            { email: 'test@example.com', password: 'password123', name: 'Test User' },
            response,
        );

        expect(response.cookie).toHaveBeenCalledWith('jaslide_session', 'jwt-token', {
            httpOnly: true,
            sameSite: 'lax',
            secure: false,
            path: '/',
        });
        expect(result).not.toHaveProperty('accessToken');
    });

    it('clears the session cookie on logout', () => {
        (controller as any).logout(response);

        expect(response.clearCookie).toHaveBeenCalledWith('jaslide_session', {
            httpOnly: true,
            sameSite: 'lax',
            secure: false,
            path: '/',
        });
    });
});
