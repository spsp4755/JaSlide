-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'SYSTEM_ADMIN';
ALTER TYPE "UserRole" ADD VALUE 'OPERATOR';
ALTER TYPE "UserRole" ADD VALUE 'AUDITOR';

-- AlterTable
ALTER TABLE "LlmModel" ADD COLUMN     "apiKey" TEXT,
ALTER COLUMN "apiKeyEnvVar" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mfaSecret" TEXT;

-- CreateTable
CREATE TABLE "LoginLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "device" TEXT,
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'light',
    "font" TEXT NOT NULL DEFAULT 'default',
    "exportType" TEXT NOT NULL DEFAULT 'pptx',
    "customData" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UXState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastStep" TEXT,
    "focusMode" BOOLEAN NOT NULL DEFAULT false,
    "sessionData" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UXState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityScore" (
    "id" TEXT NOT NULL,
    "presentationId" TEXT NOT NULL,
    "slideId" TEXT,
    "readability" DOUBLE PRECISION NOT NULL,
    "clarity" DOUBLE PRECISION NOT NULL,
    "overall" DOUBLE PRECISION NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "errorType" TEXT NOT NULL,
    "errorData" JSONB,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "recoveryAction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecoveryLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoginLog_userId_idx" ON "LoginLog"("userId");

-- CreateIndex
CREATE INDEX "LoginLog_email_idx" ON "LoginLog"("email");

-- CreateIndex
CREATE INDEX "LoginLog_success_idx" ON "LoginLog"("success");

-- CreateIndex
CREATE INDEX "LoginLog_createdAt_idx" ON "LoginLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_key" ON "UserPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UXState_userId_key" ON "UXState"("userId");

-- CreateIndex
CREATE INDEX "AutoRule_userId_idx" ON "AutoRule"("userId");

-- CreateIndex
CREATE INDEX "AutoRule_isActive_idx" ON "AutoRule"("isActive");

-- CreateIndex
CREATE INDEX "QualityScore_presentationId_idx" ON "QualityScore"("presentationId");

-- CreateIndex
CREATE INDEX "QualityScore_slideId_idx" ON "QualityScore"("slideId");

-- CreateIndex
CREATE INDEX "RecoveryLog_userId_idx" ON "RecoveryLog"("userId");

-- CreateIndex
CREATE INDEX "RecoveryLog_errorType_idx" ON "RecoveryLog"("errorType");

-- CreateIndex
CREATE INDEX "RecoveryLog_resolved_idx" ON "RecoveryLog"("resolved");

-- AddForeignKey
ALTER TABLE "LoginLog" ADD CONSTRAINT "LoginLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UXState" ADD CONSTRAINT "UXState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoRule" ADD CONSTRAINT "AutoRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
