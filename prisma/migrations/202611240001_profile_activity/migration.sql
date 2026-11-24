ALTER TABLE "User" ADD COLUMN "activityCity" TEXT, ADD COLUMN "activityDistrict" TEXT;
ALTER TABLE "CustomerOtpChallenge" DROP CONSTRAINT "CustomerOtpChallenge_purpose_check";
ALTER TABLE "CustomerOtpChallenge" ADD CONSTRAINT "CustomerOtpChallenge_purpose_check"
CHECK (purpose IN ('REGISTER','LOGIN','RESET_PASSWORD','DELETE_ACCOUNT','DRIVER_REGISTER','DRIVER_LOGIN','DRIVER_RESET_PASSWORD','HALL_CONTACT','PROFILE_PHONE'));
