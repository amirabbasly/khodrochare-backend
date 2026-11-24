ALTER TABLE "User" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE "AssistanceRequest" ADD COLUMN "operatorConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "operatorActorId" TEXT, ADD COLUMN "operatorActorName" TEXT, ADD COLUMN "operatorNotes" TEXT;
ALTER TABLE "HallListing" ADD COLUMN "submittedAt" TIMESTAMP(3), ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedBy" TEXT, ADD COLUMN "moderationNote" TEXT;
ALTER TABLE "HallListing" DROP CONSTRAINT "HallListing_status_check";
ALTER TABLE "HallListing" ADD CONSTRAINT "HallListing_status_check"
CHECK (status IN ('DRAFT','PENDING_REVIEW','REJECTED','PUBLISHED','BLOCKED','SOLD','DELETED'));
ALTER TABLE "HallPlan" ADD COLUMN "originalPriceToman" INTEGER;
UPDATE "HallPlan" SET "priceToman"=99000,"originalPriceToman"=320000 WHERE code='LADDER';
UPDATE "HallPlan" SET "priceToman"=149000,"originalPriceToman"=700000 WHERE code='URGENT';
UPDATE "HallPlan" SET "priceToman"=199000,"originalPriceToman"=720000 WHERE code='FEATURED';
CREATE INDEX "AssistanceRequest_operatorConfirmedAt_status_idx" ON "AssistanceRequest"("operatorConfirmedAt",status);
CREATE TABLE "OperatorAudit" (
 id TEXT PRIMARY KEY, "actorId" TEXT NOT NULL, "actorRole" TEXT NOT NULL,
 "actorName" TEXT NOT NULL, action TEXT NOT NULL, "targetId" TEXT NOT NULL,
 details JSONB NOT NULL DEFAULT '{}', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "OperatorAudit_targetId_createdAt_idx" ON "OperatorAudit"("targetId","createdAt");
