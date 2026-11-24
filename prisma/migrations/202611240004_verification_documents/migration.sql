BEGIN;
ALTER TABLE "Document" ADD COLUMN "verificationKind" TEXT, ADD COLUMN "vehicleEvidenceType" TEXT;
-- The old picker accepted either ID or birth certificate. Do not guess which
-- document an existing file contains or delete it during this upgrade.
UPDATE "Document" d SET "verificationKind"='LEGACY_IDENTITY'
FROM "User" u WHERE u.role='DRIVER' AND u."identityDocumentId"=d.id AND d."ownerId"=u.id;
CREATE UNIQUE INDEX "Document_ownerId_verificationKind_key" ON "Document" ("ownerId","verificationKind");
ALTER TABLE "Document" ADD CONSTRAINT "document_verification_kind" CHECK (
 "verificationKind" IS NULL OR "verificationKind" IN ('NATIONAL_ID','BIRTH_CERTIFICATE','DRIVING_LICENSE','VEHICLE_OWNERSHIP','LEGACY_IDENTITY')
);
ALTER TABLE "Document" ADD CONSTRAINT "document_vehicle_evidence" CHECK (
 ("verificationKind"='VEHICLE_OWNERSHIP' AND "vehicleEvidenceType" IS NOT NULL AND "vehicleEvidenceType" IN ('VEHICLE_CARD','INSURANCE','TECHNICAL_INSPECTION'))
 OR ("verificationKind" IS DISTINCT FROM 'VEHICLE_OWNERSHIP' AND "vehicleEvidenceType" IS NULL)
);
COMMIT;
