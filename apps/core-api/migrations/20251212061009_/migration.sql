-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "domain" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" JSONB NOT NULL DEFAULT '[]',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRoleAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditPolicy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "modelType" TEXT NOT NULL,
    "modelName" TEXT,
    "costPerUnit" INTEGER NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "monthlyCredits" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "features" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmModel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "endpoint" TEXT,
    "apiKeyEnvVar" TEXT NOT NULL,
    "maxTokens" INTEGER NOT NULL DEFAULT 4096,
    "rateLimit" INTEGER,
    "costPerToken" DECIMAL(10,8) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptRegistry" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ColorPalette" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "colors" JSONB NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ColorPalette_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LayoutRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slideType" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LayoutRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemPolicy" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertConfig" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "responseTime" INTEGER NOT NULL,
    "requestBody" JSONB,
    "responseBody" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE INDEX "UserRoleAssignment_userId_idx" ON "UserRoleAssignment"("userId");

-- CreateIndex
CREATE INDEX "UserRoleAssignment_roleId_idx" ON "UserRoleAssignment"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRoleAssignment_userId_roleId_key" ON "UserRoleAssignment"("userId", "roleId");

-- CreateIndex
CREATE INDEX "CreditPolicy_modelType_idx" ON "CreditPolicy"("modelType");

-- CreateIndex
CREATE INDEX "CreditPolicy_isActive_idx" ON "CreditPolicy"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PricingPlan_name_key" ON "PricingPlan"("name");

-- CreateIndex
CREATE INDEX "PricingPlan_isActive_idx" ON "PricingPlan"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "LlmModel_name_key" ON "LlmModel"("name");

-- CreateIndex
CREATE INDEX "LlmModel_provider_idx" ON "LlmModel"("provider");

-- CreateIndex
CREATE INDEX "LlmModel_isActive_idx" ON "LlmModel"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PromptRegistry_name_key" ON "PromptRegistry"("name");

-- CreateIndex
CREATE INDEX "PromptRegistry_category_idx" ON "PromptRegistry"("category");

-- CreateIndex
CREATE INDEX "PromptTemplateVersion_templateId_idx" ON "PromptTemplateVersion"("templateId");

-- CreateIndex
CREATE INDEX "PromptTemplateVersion_isActive_idx" ON "PromptTemplateVersion"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplateVersion_templateId_version_key" ON "PromptTemplateVersion"("templateId", "version");

-- CreateIndex
CREATE INDEX "ColorPalette_isPublic_idx" ON "ColorPalette"("isPublic");

-- CreateIndex
CREATE INDEX "ColorPalette_organizationId_idx" ON "ColorPalette"("organizationId");

-- CreateIndex
CREATE INDEX "LayoutRule_slideType_idx" ON "LayoutRule"("slideType");

-- CreateIndex
CREATE INDEX "LayoutRule_isDefault_idx" ON "LayoutRule"("isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "SystemPolicy_key_key" ON "SystemPolicy"("key");

-- CreateIndex
CREATE INDEX "SystemPolicy_category_idx" ON "SystemPolicy"("category");

-- CreateIndex
CREATE INDEX "AlertConfig_eventType_idx" ON "AlertConfig"("eventType");

-- CreateIndex
CREATE INDEX "AlertConfig_isActive_idx" ON "AlertConfig"("isActive");

-- CreateIndex
CREATE INDEX "ApiLog_userId_idx" ON "ApiLog"("userId");

-- CreateIndex
CREATE INDEX "ApiLog_path_idx" ON "ApiLog"("path");

-- CreateIndex
CREATE INDEX "ApiLog_statusCode_idx" ON "ApiLog"("statusCode");

-- CreateIndex
CREATE INDEX "ApiLog_createdAt_idx" ON "ApiLog"("createdAt");

-- CreateIndex
CREATE INDEX "Organization_domain_idx" ON "Organization"("domain");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptTemplateVersion" ADD CONSTRAINT "PromptTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PromptRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ColorPalette" ADD CONSTRAINT "ColorPalette_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
