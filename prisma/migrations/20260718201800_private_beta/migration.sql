-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('proposed', 'confirmed', 'declined', 'cancelled');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "onboardingState" JSONB;

-- AlterTable
ALTER TABLE "PracticeLocation" ADD COLUMN     "staffingTarget" JSONB;

-- CreateTable
CREATE TABLE "PipelineStatusChange" (
    "id" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "candidateUserId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorUserId" TEXT,
    "reasonCode" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineStatusChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "candidateUserId" TEXT NOT NULL,
    "status" "InterviewStatus" NOT NULL DEFAULT 'proposed',
    "slots" JSONB NOT NULL,
    "chosenSlot" TIMESTAMP(3),
    "proposedByUserId" TEXT NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateConsent" (
    "id" TEXT NOT NULL,
    "candidateUserId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vacancyId" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'contact_details',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "CandidateConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchDecisionFeedback" (
    "id" TEXT NOT NULL,
    "matchSnapshotId" TEXT,
    "vacancyId" TEXT NOT NULL,
    "candidateUserId" TEXT,
    "organizationId" TEXT,
    "actorType" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchDecisionFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "readAt" TIMESTAMP(3),
    "dedupeKey" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEmail" (
    "id" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "notificationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "OutboxEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "schedule" JSONB NOT NULL,
    "absentFrom" TIMESTAMP(3),
    "absentUntil" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PipelineStatusChange_vacancyId_candidateUserId_createdAt_idx" ON "PipelineStatusChange"("vacancyId", "candidateUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Interview_vacancyId_candidateUserId_idx" ON "Interview"("vacancyId", "candidateUserId");

-- CreateIndex
CREATE INDEX "Interview_candidateUserId_status_idx" ON "Interview"("candidateUserId", "status");

-- CreateIndex
CREATE INDEX "CandidateConsent_organizationId_idx" ON "CandidateConsent"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateConsent_candidateUserId_organizationId_vacancyId_s_key" ON "CandidateConsent"("candidateUserId", "organizationId", "vacancyId", "scope");

-- CreateIndex
CREATE INDEX "MatchDecisionFeedback_vacancyId_idx" ON "MatchDecisionFeedback"("vacancyId");

-- CreateIndex
CREATE INDEX "MatchDecisionFeedback_reasonCode_createdAt_idx" ON "MatchDecisionFeedback"("reasonCode", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_type_key" ON "NotificationPreference"("userId", "type");

-- CreateIndex
CREATE INDEX "OutboxEmail_status_createdAt_idx" ON "OutboxEmail"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TeamMember_locationId_idx" ON "TeamMember"("locationId");

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "PracticeLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
