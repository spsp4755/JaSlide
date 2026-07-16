import { UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import { createHash } from 'crypto';
import { OidcService } from './oidc.service';

jest.mock('axios', () => ({
    __esModule: true,
    default: { get: jest.fn(), post: jest.fn() },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('OidcService', () => {
    const issuer = 'https://keycloak.example/realms/jaslide';
    const config = {
        get: jest.fn((key: string) => ({
            KEYCLOAK_ISSUER: issuer,
            KEYCLOAK_CLIENT_ID: 'jaslide-web',
            KEYCLOAK_REDIRECT_URI: 'https://jaslide.example/api/auth/keycloak/callback',
        })[key]),
    };
    let service: OidcService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new OidcService(config as any);
    });

    it('creates an authorization URL with state, nonce, and S256 PKCE', async () => {
        mockedAxios.get.mockResolvedValue({
            data: {
                authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
                token_endpoint: `${issuer}/protocol/openid-connect/token`,
                jwks_uri: `${issuer}/protocol/openid-connect/certs`,
            },
        } as any);

        const request = await (service as any).createAuthorizationRequest();
        const url = new URL(request.authorizationUrl);

        expect(url.searchParams.get('state')).toHaveLength(43);
        expect(url.searchParams.get('nonce')).toHaveLength(43);
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(request.verifier).toHaveLength(43);
        expect(url.searchParams.get('code_challenge')).toBe(
            createHash('sha256').update(request.verifier).digest('base64url'),
        );
    });

    it('rejects a callback state that does not match the signed login state', () => {
        expect(() => (service as any).validateState('expected-state', 'wrong-state'))
            .toThrow(UnauthorizedException);
    });

    it('rejects an unsigned ID token', async () => {
        mockedAxios.get.mockImplementation(async (url: string) => {
            if (url.endsWith('/.well-known/openid-configuration')) {
                return {
                    data: {
                        authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
                        token_endpoint: `${issuer}/protocol/openid-connect/token`,
                        jwks_uri: `${issuer}/protocol/openid-connect/certs`,
                    },
                } as any;
            }
            return { data: { keys: [] } } as any;
        });
        mockedAxios.post.mockResolvedValue({
            data: {
                access_token: 'not-exposed',
                id_token: 'eyJhbGciOiJub25lIn0.eyJpc3MiOiJodHRwczovL2tleWNsb2FrLmV4YW1wbGUvcmVhbG1zL2phc2xpZGUiLCJhdWQiOiJqYXNsaWRlLXdlYiIsImV4cCI6NDcwMDAwMDAwMCwibm9uY2UiOiJub25jZSJ9.',
                token_type: 'Bearer',
                expires_in: 300,
            },
        } as any);

        await expect((service as any).completeAuthorizationCode('code', 'verifier', 'nonce'))
            .rejects.toThrow(UnauthorizedException);
    });
});
