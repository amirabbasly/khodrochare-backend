-- CreateTable
CREATE TABLE "HallListing" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "draft" JSONB NOT NULL DEFAULT '{}',
    "make" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "trim" TEXT NOT NULL DEFAULT '',
    "makeKey" TEXT NOT NULL DEFAULT '',
    "modelKey" TEXT NOT NULL DEFAULT '',
    "trimKey" TEXT NOT NULL DEFAULT '',
    "searchText" TEXT NOT NULL DEFAULT '',
    "year" INTEGER,
    "mileage" INTEGER,
    "city" TEXT NOT NULL DEFAULT '',
    "bodyCondition" TEXT NOT NULL DEFAULT '',
    "technicalCondition" TEXT NOT NULL DEFAULT '',
    "priceToman" BIGINT,
    "inspectionStatus" TEXT NOT NULL DEFAULT 'NOT_INSPECTED',
    "inspectionNote" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "bumpedAt" TIMESTAMP(3),
    "featuredUntil" TIMESTAMP(3),
    "urgentUntil" TIMESTAMP(3),
    "ladderUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HallListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HallPhoto" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "readToken" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HallPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HallPlan" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PLAN',
    "description" TEXT NOT NULL,
    "priceToman" INTEGER NOT NULL,
    "services" TEXT[],
    "terms" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "durationHours" INTEGER NOT NULL DEFAULT 168,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HallPlan_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "HallOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "listingVersion" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "amountToman" INTEGER NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'sandbox',
    "status" TEXT NOT NULL DEFAULT 'CREATING',
    "idempotencyKey" TEXT NOT NULL,
    "authority" TEXT,
    "refId" TEXT,
    "errorCode" TEXT,
    "supportNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),

    CONSTRAINT "HallOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HallInquiry" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HallInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HallBanner" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT NOT NULL,
    "linkUrl" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HallBanner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HallListing_status_publishedAt_idx" ON "HallListing"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "HallListing_ownerId_updatedAt_idx" ON "HallListing"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "HallListing_makeKey_modelKey_trimKey_year_idx" ON "HallListing"("makeKey", "modelKey", "trimKey", "year");

-- CreateIndex
CREATE UNIQUE INDEX "HallPhoto_storageKey_key" ON "HallPhoto"("storageKey");

-- CreateIndex
CREATE INDEX "HallPhoto_listingId_position_idx" ON "HallPhoto"("listingId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "HallOrder_authority_key" ON "HallOrder"("authority");

-- CreateIndex
CREATE INDEX "HallOrder_listingId_status_idx" ON "HallOrder"("listingId", "status");

-- CreateIndex
CREATE INDEX "HallOrder_createdAt_idx" ON "HallOrder"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HallOrder_userId_idempotencyKey_key" ON "HallOrder"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "HallInquiry_listingId_userId_key" ON "HallInquiry"("listingId", "userId");

-- AddForeignKey
ALTER TABLE "HallListing" ADD CONSTRAINT "HallListing_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HallPhoto" ADD CONSTRAINT "HallPhoto_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "HallListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HallOrder" ADD CONSTRAINT "HallOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HallOrder" ADD CONSTRAINT "HallOrder_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "HallListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HallInquiry" ADD CONSTRAINT "HallInquiry_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "HallListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HallInquiry" ADD CONSTRAINT "HallInquiry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce financial and lifecycle bounds without changing existing tables or records.
ALTER TABLE "HallListing" ADD CONSTRAINT "HallListing_status_check" CHECK (status IN ('DRAFT','PUBLISHED','BLOCKED','SOLD'));
ALTER TABLE "HallListing" ADD CONSTRAINT "HallListing_price_check" CHECK ("priceToman" IS NULL OR ("priceToman">=1000000 AND "priceToman"<=1000000000000));
ALTER TABLE "HallOrder" ADD CONSTRAINT "HallOrder_status_check" CHECK (status IN ('CREATING','PENDING','VERIFIED','CANCELLED','FAILED','REVIEW_REQUIRED'));
ALTER TABLE "HallOrder" ADD CONSTRAINT "HallOrder_amount_check" CHECK ("amountToman">0 AND "amountToman"<=100000000);
ALTER TABLE "HallOrder" ADD CONSTRAINT "HallOrder_action_check" CHECK (action IN ('PUBLISH','UPGRADE'));
ALTER TABLE "HallOrder" ADD CONSTRAINT "HallOrder_mode_check" CHECK (mode='sandbox');
ALTER TABLE "HallPlan" ADD CONSTRAINT "HallPlan_amount_check" CHECK ("priceToman">=0 AND "priceToman"<=100000000);
