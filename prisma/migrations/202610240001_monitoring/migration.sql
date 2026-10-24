CREATE TABLE "UserLocation" (
 "userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
 longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
 province TEXT NOT NULL,
 "recordedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "UserLocation_province_idx" ON "UserLocation"(province);

ALTER TABLE "AssistanceRequest" ADD COLUMN "operationsStartedAt" TIMESTAMP(3);

ALTER TABLE "AssistanceRequest" ADD COLUMN "originProvince" TEXT;
