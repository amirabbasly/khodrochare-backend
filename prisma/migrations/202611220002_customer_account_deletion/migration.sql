ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "CustomerOtpChallenge" DROP CONSTRAINT "CustomerOtpChallenge_purpose_check";
ALTER TABLE "CustomerOtpChallenge" ADD CONSTRAINT "CustomerOtpChallenge_purpose_check"
CHECK (purpose IN ('REGISTER','LOGIN','RESET_PASSWORD','DELETE_ACCOUNT'));
