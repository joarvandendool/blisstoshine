-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "publicConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicConsentAt" TIMESTAMP(3),
ADD COLUMN     "publicDescription" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

