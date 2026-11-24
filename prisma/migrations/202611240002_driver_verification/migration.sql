ALTER TABLE "User"
 ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
 ADD COLUMN "verificationVersion" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "verificationReviewedAt" TIMESTAMP(3),
 ADD COLUMN "verificationReviewedBy" TEXT,
 ADD COLUMN "verificationNote" TEXT,
 ADD COLUMN "registrationNoticeSeenAt" TIMESTAMP(3),
 ADD COLUMN "verificationNoticeSeenAt" TIMESTAMP(3);
-- Existing accounts also require an explicit document review. Do not show them
-- a new-registration notice. Existing assigned jobs can still be completed.
UPDATE "User" SET "registrationNoticeSeenAt" = CURRENT_TIMESTAMP;
CREATE INDEX "User_role_verificationStatus_createdAt_idx" ON "User" ("role", "verificationStatus", "createdAt");
