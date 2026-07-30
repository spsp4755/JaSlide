-- CreateTable
-- A single settings row (fixed id) so admins can edit Keycloak/SSO
-- configuration at runtime instead of only via environment variables.
CREATE TABLE "KeycloakSetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "issuer" TEXT NOT NULL DEFAULT '',
    "clientId" TEXT NOT NULL DEFAULT '',
    "clientSecret" TEXT NOT NULL DEFAULT '',
    "redirectUri" TEXT NOT NULL DEFAULT '',
    "adminRoles" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeycloakSetting_pkey" PRIMARY KEY ("id")
);
