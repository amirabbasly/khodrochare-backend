ALTER TABLE "AssistanceRequest" ADD COLUMN "pricingBreakdown" JSONB;
ALTER TABLE "AssistanceRequest" DROP CONSTRAINT "request_payload_valid";
ALTER TABLE "AssistanceRequest" ADD CONSTRAINT "request_payload_valid" CHECK (
  (service = 'TOWING' AND "destinationLat" IS NOT NULL AND "destinationLng" IS NOT NULL
    AND "distanceMeters" IS NOT NULL AND "distanceMeters" > 0 AND "pricingVersion" IS NOT NULL
    AND (("priceToman" IS NOT NULL AND "priceToman" >= 0) OR COALESCE("pricingBreakdown"->>'requiresAgreement' = 'true', FALSE)))
  OR (service = 'REPAIR' AND problem IS NOT NULL)
);
