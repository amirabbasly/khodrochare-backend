ALTER TABLE "CustomerOtpChallenge" DROP CONSTRAINT "CustomerOtpChallenge_purpose_check";
ALTER TABLE "CustomerOtpChallenge" ADD CONSTRAINT "CustomerOtpChallenge_purpose_check"
  CHECK (purpose IN ('REGISTER', 'LOGIN', 'RESET_PASSWORD', 'DELETE_ACCOUNT', 'DRIVER_REGISTER', 'DRIVER_LOGIN', 'DRIVER_RESET_PASSWORD'));
