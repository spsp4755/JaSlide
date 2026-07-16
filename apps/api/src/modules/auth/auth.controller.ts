import {
    Controller,
    Post,
    Get,
    Body,
    Query,
    UnauthorizedException,
    UseGuards,
    Req,
    Res,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto, AuthResponse } from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { OidcService } from './services/oidc.service';
import { JwtService } from '@nestjs/jwt';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
    constructor(
        private authService: AuthService,
        private oidcService?: OidcService,
        private jwtService?: JwtService,
    ) { }

    private readonly sessionCookieOptions = {
        httpOnly: true,
        sameSite: 'lax' as const,
        secure: process.env.NODE_ENV === 'production',
        path: '/',
    };

    private setSession(response: Response, accessToken: string) {
        response.cookie('jaslide_session', accessToken, this.sessionCookieOptions);
    }

    private clearSession(response: Response) {
        response.clearCookie('jaslide_session', this.sessionCookieOptions);
    }

    private readonly keycloakCookieOptions = {
        ...this.sessionCookieOptions,
        path: '/api/auth/keycloak',
        maxAge: 10 * 60 * 1000,
    };

    private sessionResponse({ accessToken, ...response }: AuthResponse) {
        return response;
    }

    private readCookie(request: any, name: string) {
        return request?.cookies?.[name]
            || request?.headers?.cookie?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1];
    }

    @Post('register')
    @ApiOperation({ summary: 'Register a new user' })
    @ApiResponse({ status: 201, description: 'User registered successfully' })
    @ApiResponse({ status: 409, description: 'User already exists' })
    async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) response: Response) {
        const result = await this.authService.register(dto);
        this.setSession(response, result.accessToken);
        return this.sessionResponse(result);
    }

    @Post('login')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Login with email and password' })
    @ApiResponse({ status: 200, description: 'Login successful' })
    @ApiResponse({ status: 401, description: 'Invalid credentials' })
    async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
        const result = await this.authService.login(dto);
        this.setSession(response, result.accessToken);
        return this.sessionResponse(result);
    }

    @Post('logout')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Log out and clear the current session' })
    logout(@Res({ passthrough: true }) response: Response) {
        this.clearSession(response);
    }

    @Get('keycloak')
    @ApiOperation({ summary: 'Start Keycloak login' })
    async keycloak(@Res() response: Response) {
        const oidc = this.oidcService;
        const jwt = this.jwtService;
        if (!oidc || !jwt) throw new UnauthorizedException('Keycloak is not configured');

        const request = await oidc.createAuthorizationRequest();
        const transaction = await jwt.signAsync(
            { state: request.state, nonce: request.nonce, verifier: request.verifier },
            { expiresIn: '10m', audience: 'keycloak_login' },
        );
        response.cookie('jaslide_keycloak_login', transaction, this.keycloakCookieOptions);
        response.redirect(request.authorizationUrl);
    }

    @Get('keycloak/callback')
    @ApiOperation({ summary: 'Complete Keycloak login' })
    async keycloakCallback(
        @Query('code') code: string,
        @Query('state') state: string,
        @Req() request: any,
        @Res() response: Response,
    ) {
        const oidc = this.oidcService;
        const jwt = this.jwtService;
        const transaction = this.readCookie(request, 'jaslide_keycloak_login');
        if (!oidc || !jwt || !code || !state || !transaction) {
            throw new UnauthorizedException('Invalid Keycloak login response');
        }

        let login: { state: string; nonce: string; verifier: string };
        try {
            login = await jwt.verifyAsync(transaction, { audience: 'keycloak_login' });
        } catch {
            throw new UnauthorizedException('Keycloak login has expired');
        }
        oidc.validateState(login.state, state);
        const identity = await oidc.completeAuthorizationCode(code, login.verifier, login.nonce);
        const result = await this.authService.validateOAuthUser({
            email: identity.email,
            name: identity.name,
            image: identity.picture,
            provider: 'keycloak',
            providerAccountId: identity.sub,
        });

        this.setSession(response, result.accessToken);
        response.clearCookie('jaslide_keycloak_login', this.keycloakCookieOptions);
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        response.redirect(`${frontendUrl}/${result.user.role === 'ADMIN' || result.user.role === 'SYSTEM_ADMIN' ? 'admin' : 'dashboard'}`);
    }

    @Get('google')
    @UseGuards(AuthGuard('google'))
    @ApiOperation({ summary: 'Login with Google OAuth' })
    async googleAuth() {
        // Guard redirects to Google
    }

    @Get('google/callback')
    @UseGuards(AuthGuard('google'))
    @ApiOperation({ summary: 'Google OAuth callback' })
    async googleAuthCallback(@Req() req: any, @Res() res: Response) {
        const result = await this.authService.validateOAuthUser({
            email: req.user.email,
            name: req.user.name,
            image: req.user.picture,
            provider: 'google',
            providerAccountId: req.user.id,
        });

        this.setSession(res, result.accessToken);
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        res.redirect(`${frontendUrl}/auth/callback`);
    }

    @Get('me')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get current user info' })
    @ApiResponse({ status: 200, description: 'Current user info' })
    async me(@CurrentUser() user: any) {
        return user;
    }
}
