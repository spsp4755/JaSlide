import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

interface KeycloakConfig {
    issuer: string;
    clientId: string;
    clientSecret?: string;
    redirectUri: string;
}

interface DiscoveryDocument {
    authorization_endpoint: string;
    token_endpoint: string;
    jwks_uri: string;
}

export interface KeycloakIdentity extends JWTPayload {
    sub: string;
    email: string;
    name?: string;
    picture?: string;
}

@Injectable()
export class OidcService {
    private readonly logger = new Logger(OidcService.name);
    private discovery?: DiscoveryDocument;

    constructor(private readonly configService: ConfigService) {}

    async createAuthorizationRequest() {
        const config = this.getConfig();
        const verifier = randomBytes(32).toString('base64url');
        const state = randomBytes(32).toString('base64url');
        const nonce = randomBytes(32).toString('base64url');
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        const discovery = await this.getDiscoveryDocument(config.issuer);
        const params = new URLSearchParams({
            client_id: config.clientId,
            redirect_uri: config.redirectUri,
            response_type: 'code',
            scope: 'openid email profile',
            state,
            nonce,
            code_challenge: challenge,
            code_challenge_method: 'S256',
        });

        return {
            authorizationUrl: `${discovery.authorization_endpoint}?${params.toString()}`,
            state,
            nonce,
            verifier,
        };
    }

    validateState(expected: string, received: string) {
        if (!expected || !received || expected.length !== received.length) {
            throw new UnauthorizedException('Invalid login state');
        }

        if (!timingSafeEqual(Buffer.from(expected), Buffer.from(received))) {
            throw new UnauthorizedException('Invalid login state');
        }
    }

    async completeAuthorizationCode(code: string, verifier: string, nonce: string): Promise<KeycloakIdentity> {
        const config = this.getConfig();
        const discovery = await this.getDiscoveryDocument(config.issuer);
        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: config.clientId,
            code,
            redirect_uri: config.redirectUri,
            code_verifier: verifier,
        });
        if (config.clientSecret) body.set('client_secret', config.clientSecret);

        try {
            const response = await axios.post<{ id_token: string }>(
                discovery.token_endpoint,
                body.toString(),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
            );
            const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
            const { payload } = await jwtVerify(response.data.id_token, jwks, {
                issuer: config.issuer,
                audience: config.clientId,
            });

            if (
                payload.nonce !== nonce
                || payload.email_verified !== true
                || typeof payload.sub !== 'string'
                || typeof payload.email !== 'string'
            ) {
                throw new Error('Invalid Keycloak identity');
            }

            return payload as KeycloakIdentity;
        } catch (error) {
            this.logger.warn('Keycloak authorization code was rejected');
            throw new UnauthorizedException('Failed to authenticate with Keycloak');
        }
    }

    private getConfig(): KeycloakConfig {
        const issuer = this.configService.get<string>('KEYCLOAK_ISSUER');
        const clientId = this.configService.get<string>('KEYCLOAK_CLIENT_ID');
        if (!issuer || !clientId) throw new UnauthorizedException('Keycloak is not configured');

        const redirectUri = this.configService.get<string>('KEYCLOAK_REDIRECT_URI')
            || (this.configService.get<string>('APP_URL')
                ? `${this.configService.get<string>('APP_URL')}/api/auth/keycloak/callback`
                : undefined);
        if (!redirectUri) throw new UnauthorizedException('Keycloak redirect URI is not configured');

        return {
            issuer: issuer.replace(/\/$/, ''),
            clientId,
            clientSecret: this.configService.get<string>('KEYCLOAK_CLIENT_SECRET'),
            redirectUri,
        };
    }

    private async getDiscoveryDocument(issuer: string): Promise<DiscoveryDocument> {
        if (this.discovery) return this.discovery;

        try {
            const { data } = await axios.get<DiscoveryDocument>(`${issuer}/.well-known/openid-configuration`);
            if (!data.authorization_endpoint || !data.token_endpoint || !data.jwks_uri) throw new Error('Invalid discovery document');
            this.discovery = data;
            return data;
        } catch {
            throw new UnauthorizedException('Failed to connect to Keycloak');
        }
    }
}
