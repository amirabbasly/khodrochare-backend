ALTER TABLE "User" ALTER COLUMN "nationalId" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);
-- Driver registration still requires its existing identity and password.
ALTER TABLE "User" ADD CONSTRAINT "User_driver_credentials_required"
CHECK (role <> 'DRIVER' OR ("nationalId" IS NOT NULL AND "passwordHash" IS NOT NULL));

CREATE TABLE "CustomerOtpChallenge" (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('REGISTER','LOGIN','RESET_PASSWORD')),
  "codeHash" TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SENDING' CHECK (status IN ('SENDING','SENT','FAILED','INVALIDATED','USED','LOCKED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3)
);
CREATE INDEX "CustomerOtpChallenge_phone_createdAt_idx" ON "CustomerOtpChallenge"(phone,"createdAt");
CREATE INDEX "CustomerOtpChallenge_expiresAt_idx" ON "CustomerOtpChallenge"("expiresAt");
