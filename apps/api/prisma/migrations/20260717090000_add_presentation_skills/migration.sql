CREATE TABLE "PresentationSkill" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "outlineGuidance" TEXT NOT NULL,
    "recommendedSlideCount" INTEGER NOT NULL,
    "thumbnail" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "organizationId" TEXT,
    "templateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PresentationSkill_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Presentation" ADD COLUMN "skillId" TEXT;
ALTER TABLE "GenerationJob" ADD COLUMN "skillId" TEXT;

CREATE INDEX "PresentationSkill_category_idx" ON "PresentationSkill"("category");
CREATE INDEX "PresentationSkill_userId_idx" ON "PresentationSkill"("userId");
CREATE INDEX "PresentationSkill_organizationId_idx" ON "PresentationSkill"("organizationId");
CREATE INDEX "PresentationSkill_templateId_idx" ON "PresentationSkill"("templateId");
CREATE INDEX "Presentation_skillId_idx" ON "Presentation"("skillId");
CREATE INDEX "GenerationJob_skillId_idx" ON "GenerationJob"("skillId");

ALTER TABLE "PresentationSkill" ADD CONSTRAINT "PresentationSkill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PresentationSkill" ADD CONSTRAINT "PresentationSkill_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PresentationSkill" ADD CONSTRAINT "PresentationSkill_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Presentation" ADD CONSTRAINT "Presentation_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "PresentationSkill"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "PresentationSkill"("id") ON DELETE SET NULL ON UPDATE CASCADE;
