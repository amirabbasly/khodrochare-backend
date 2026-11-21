ALTER TYPE "RequestStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
CREATE INDEX "AssistanceRequest_status_createdAt_idx" ON "AssistanceRequest"("status", "createdAt");
