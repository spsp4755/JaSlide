-- CreateEnum
CREATE TYPE "BlockType" AS ENUM ('TEXT', 'IMAGE', 'CHART', 'TABLE', 'ICON', 'SHAPE');

-- CreateEnum
CREATE TYPE "CollaboratorRole" AS ENUM ('OWNER', 'EDITOR', 'COMMENTER', 'VIEWER');

-- CreateTable
CREATE TABLE "Version" (
    "id" TEXT NOT NULL,
    "presentationId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "name" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UndoRedoSnapshot" (
    "id" TEXT NOT NULL,
    "presentationId" TEXT NOT NULL,
    "slideId" TEXT,
    "action" TEXT NOT NULL,
    "beforeState" JSONB NOT NULL,
    "afterState" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UndoRedoSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Block" (
    "id" TEXT NOT NULL,
    "slideId" TEXT NOT NULL,
    "type" "BlockType" NOT NULL,
    "order" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "style" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InputPrompt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InputPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InputCombination" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "promptText" TEXT,
    "documentUrl" TEXT,
    "sourceUrl" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InputCombination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecentWork" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "presentationId" TEXT NOT NULL,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecentWork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "presentationId" TEXT NOT NULL,
    "slideId" TEXT,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "parentId" TEXT,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collaborator" (
    "id" TEXT NOT NULL,
    "presentationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "CollaboratorRole" NOT NULL DEFAULT 'VIEWER',
    "invitedBy" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Collaborator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportPreset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareLog" (
    "id" TEXT NOT NULL,
    "presentationId" TEXT NOT NULL,
    "sharedBy" TEXT NOT NULL,
    "sharedTo" TEXT,
    "method" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FontSet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "titleFont" TEXT NOT NULL,
    "bodyFont" TEXT NOT NULL,
    "headingFont" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FontSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Version_presentationId_idx" ON "Version"("presentationId");

-- CreateIndex
CREATE UNIQUE INDEX "Version_presentationId_versionNumber_key" ON "Version"("presentationId", "versionNumber");

-- CreateIndex
CREATE INDEX "UndoRedoSnapshot_presentationId_idx" ON "UndoRedoSnapshot"("presentationId");

-- CreateIndex
CREATE INDEX "Block_slideId_idx" ON "Block"("slideId");

-- CreateIndex
CREATE INDEX "Block_type_idx" ON "Block"("type");

-- CreateIndex
CREATE INDEX "InputPrompt_userId_idx" ON "InputPrompt"("userId");

-- CreateIndex
CREATE INDEX "InputCombination_userId_idx" ON "InputCombination"("userId");

-- CreateIndex
CREATE INDEX "Favorite_userId_idx" ON "Favorite"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_userId_resourceType_resourceId_key" ON "Favorite"("userId", "resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "RecentWork_userId_idx" ON "RecentWork"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RecentWork_userId_presentationId_key" ON "RecentWork"("userId", "presentationId");

-- CreateIndex
CREATE INDEX "Comment_presentationId_idx" ON "Comment"("presentationId");

-- CreateIndex
CREATE INDEX "Comment_slideId_idx" ON "Comment"("slideId");

-- CreateIndex
CREATE INDEX "Collaborator_presentationId_idx" ON "Collaborator"("presentationId");

-- CreateIndex
CREATE UNIQUE INDEX "Collaborator_presentationId_userId_key" ON "Collaborator"("presentationId", "userId");

-- CreateIndex
CREATE INDEX "ExportPreset_userId_idx" ON "ExportPreset"("userId");

-- CreateIndex
CREATE INDEX "ShareLog_presentationId_idx" ON "ShareLog"("presentationId");

-- CreateIndex
CREATE INDEX "FontSet_isPublic_idx" ON "FontSet"("isPublic");

-- CreateIndex
CREATE INDEX "FontSet_organizationId_idx" ON "FontSet"("organizationId");

-- AddForeignKey
ALTER TABLE "Version" ADD CONSTRAINT "Version_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "Presentation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UndoRedoSnapshot" ADD CONSTRAINT "UndoRedoSnapshot_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "Presentation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_slideId_fkey" FOREIGN KEY ("slideId") REFERENCES "Slide"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InputPrompt" ADD CONSTRAINT "InputPrompt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InputCombination" ADD CONSTRAINT "InputCombination_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecentWork" ADD CONSTRAINT "RecentWork_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecentWork" ADD CONSTRAINT "RecentWork_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "Presentation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "Presentation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_slideId_fkey" FOREIGN KEY ("slideId") REFERENCES "Slide"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collaborator" ADD CONSTRAINT "Collaborator_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "Presentation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collaborator" ADD CONSTRAINT "Collaborator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportPreset" ADD CONSTRAINT "ExportPreset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLog" ADD CONSTRAINT "ShareLog_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "Presentation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FontSet" ADD CONSTRAINT "FontSet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
