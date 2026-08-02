ALTER TABLE "Template" ADD COLUMN "userId" TEXT;

CREATE INDEX "Template_userId_idx" ON "Template"("userId");

ALTER TABLE "Template" ADD CONSTRAINT "Template_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
