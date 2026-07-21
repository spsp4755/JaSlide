-- DropForeignKey
ALTER TABLE "CreditTransaction" DROP CONSTRAINT "CreditTransaction_userId_fkey";

-- AlterTable
ALTER TABLE "GenerationJob" DROP COLUMN "creditsCost";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "creditsRemaining";

-- DropTable
DROP TABLE "CreditPolicy";

-- DropTable
DROP TABLE "CreditTransaction";

-- DropTable
DROP TABLE "PricingPlan";

-- DropEnum
DROP TYPE "CreditTransactionType";

