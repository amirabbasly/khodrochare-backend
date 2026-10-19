-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CUSTOMER', 'DRIVER');

-- CreateEnum
CREATE TYPE "Service" AS ENUM ('REPAIR', 'MOBILE_CARWASH', 'PERIODIC_SERVICE', 'TOWING', 'INSPECTION');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'ARRIVED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "nationalId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "vehiclePlate" TEXT,
    "vehicleType" TEXT,
    "services" "Service"[],
    "identityDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "ownerId" TEXT,
    "vehicleId" TEXT,
    "uploadTokenHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plate" TEXT NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistanceRequest" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "driverId" TEXT,
    "service" "Service" NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "vehicleName" TEXT NOT NULL,
    "vehiclePlate" TEXT NOT NULL,
    "problem" TEXT,
    "originLat" DOUBLE PRECISION NOT NULL,
    "originLng" DOUBLE PRECISION NOT NULL,
    "destinationLat" DOUBLE PRECISION,
    "destinationLng" DOUBLE PRECISION,
    "origin" geography(Point,4326),
    "destination" geography(Point,4326),
    "distanceMeters" INTEGER,
    "distanceMethod" TEXT,
    "priceToman" INTEGER,
    "pricingVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "AssistanceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverLocation" (
    "driverId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "point" geography(Point,4326),
    "recordedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverLocation_pkey" PRIMARY KEY ("driverId")
);

-- CreateTable
CREATE TABLE "Outbox" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_identityDocumentId_key" ON "User"("identityDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "User_role_phone_key" ON "User"("role", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_role_nationalId_key" ON "User"("role", "nationalId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");

-- CreateIndex
CREATE INDEX "AssistanceRequest_customerId_createdAt_idx" ON "AssistanceRequest"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistanceRequest_driverId_status_idx" ON "AssistanceRequest"("driverId", "status");

-- CreateIndex
CREATE INDEX "AssistanceRequest_status_service_idx" ON "AssistanceRequest"("status", "service");

-- CreateIndex
CREATE INDEX "Outbox_publishedAt_idx" ON "Outbox"("publishedAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_identityDocumentId_fkey" FOREIGN KEY ("identityDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistanceRequest" ADD CONSTRAINT "AssistanceRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistanceRequest" ADD CONSTRAINT "AssistanceRequest_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverLocation" ADD CONSTRAINT "DriverLocation_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "AssistanceRequest_origin_gist" ON "AssistanceRequest" USING GIST (origin);
CREATE INDEX "DriverLocation_point_gist" ON "DriverLocation" USING GIST (point);
CREATE UNIQUE INDEX "AssistanceRequest_one_active_driver" ON "AssistanceRequest" ("driverId") WHERE status IN ('ACCEPTED', 'ARRIVED');
ALTER TABLE "AssistanceRequest" ADD CONSTRAINT "request_coordinates_valid" CHECK (
  "originLat" BETWEEN -90 AND 90 AND "originLng" BETWEEN -180 AND 180
  AND ("destinationLat" IS NULL OR "destinationLat" BETWEEN -90 AND 90)
  AND ("destinationLng" IS NULL OR "destinationLng" BETWEEN -180 AND 180)
);
ALTER TABLE "AssistanceRequest" ADD CONSTRAINT "request_payload_valid" CHECK (
  (service = 'TOWING' AND "destinationLat" IS NOT NULL AND "destinationLng" IS NOT NULL AND "distanceMeters" > 0 AND "priceToman" >= 0 AND "pricingVersion" IS NOT NULL)
  OR (service = 'REPAIR' AND problem IS NOT NULL)
);
ALTER TABLE "DriverLocation" ADD CONSTRAINT "driver_coordinates_valid" CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180);
