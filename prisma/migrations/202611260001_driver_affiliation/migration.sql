CREATE TABLE "DriverAffiliation" (
 "userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
 "branding" BOOLEAN NOT NULL,
 "activity" TEXT,
 "companyName" TEXT,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "DriverAffiliation_valid" CHECK (("branding" AND "activity" IS NULL AND "companyName" IS NULL) OR (NOT "branding" AND "activity" IS NOT NULL AND (("activity"='OTHER_COMPANY' AND "companyName" IS NOT NULL AND length(trim("companyName")) BETWEEN 2 AND 150) OR ("activity" IN ('FREELANCE','ROADSIDE_COMPANY') AND "companyName" IS NULL))))
);
