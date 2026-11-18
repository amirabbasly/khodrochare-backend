-- CreateEnum
CREATE TYPE "MarketCondition" AS ENUM ('NEW', 'REFURBISHED', 'USED');

-- CreateEnum
CREATE TYPE "MarketAuthenticity" AS ENUM ('GENUINE', 'OEM', 'AFTERMARKET', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MarketReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MarketRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "MarketCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MarketCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketBrand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MarketBrand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketCar" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "maker" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "trim" TEXT NOT NULL,

    CONSTRAINT "MarketCar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketProduct" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "englishName" TEXT,
    "searchText" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "partNumber" TEXT,
    "oemNumber" TEXT,
    "condition" "MarketCondition" NOT NULL,
    "authenticity" "MarketAuthenticity" NOT NULL,
    "country" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "images" TEXT[],
    "specifications" JSONB NOT NULL,
    "fitmentSignature" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "minPriceToman" INTEGER,
    "maxPriceToman" INTEGER,
    "avgPriceToman" INTEGER,
    "offerCount" INTEGER NOT NULL DEFAULT 0,
    "dealScore" INTEGER NOT NULL DEFAULT 0,
    "dropPercent" INTEGER NOT NULL DEFAULT 0,
    "summaryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketFitment" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "carId" TEXT NOT NULL,
    "yearFrom" INTEGER NOT NULL,
    "yearTo" INTEGER NOT NULL,

    CONSTRAINT "MarketFitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSource" (
    "configVersion" INTEGER NOT NULL DEFAULT 1,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "allowedHosts" TEXT[],
    "config" JSONB NOT NULL,
    "secretEnv" TEXT,
    "licenseUrl" TEXT,
    "permissionExpiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT false,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 360,
    "minDelayMs" INTEGER NOT NULL DEFAULT 3000,
    "maxPages" INTEGER NOT NULL DEFAULT 25,
    "offerTtlHours" INTEGER NOT NULL DEFAULT 24,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSeller" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "logo" TEXT,
    "contact" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "reputation" INTEGER NOT NULL DEFAULT 0,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckedAt" TIMESTAMP(3),

    CONSTRAINT "MarketSeller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketListing" (
    "sourceFingerprint" TEXT NOT NULL,
    "metadataOverrides" JSONB,
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "productId" TEXT,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "normalized" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "matchScore" INTEGER NOT NULL DEFAULT 0,
    "matchStatus" "MarketReviewStatus" NOT NULL DEFAULT 'PENDING',
    "checkedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketMatchReview" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "candidateId" TEXT,
    "score" INTEGER NOT NULL,
    "reasons" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" "MarketReviewStatus" NOT NULL DEFAULT 'PENDING',
    "operator" TEXT,
    "note" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketMatchReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketOffer" (
    "productId" TEXT,
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "priceToman" INTEGER NOT NULL,
    "shippingToman" INTEGER,
    "inStock" BOOLEAN NOT NULL,
    "quantity" INTEGER,
    "suspicious" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketPriceSnapshot" (
    "fingerprint" TEXT NOT NULL,
    "productId" TEXT,
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "priceToman" INTEGER NOT NULL,
    "shippingToman" INTEGER,
    "inStock" BOOLEAN NOT NULL,
    "suspicious" BOOLEAN NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketPriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketCrawlRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "MarketRunStatus" NOT NULL DEFAULT 'QUEUED',
    "requestedBy" TEXT NOT NULL,
    "cursor" TEXT,
    "pages" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketCrawlRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketCrawlLog" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketCrawlLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "targetToman" INTEGER NOT NULL,
    "notifyStock" BOOLEAN NOT NULL DEFAULT false,
    "sms" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastEligible" BOOLEAN NOT NULL DEFAULT false,
    "lastInStock" BOOLEAN NOT NULL DEFAULT false,
    "cycle" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketNotification" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "smsState" TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
    "smsAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketDailyPrice" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "minToman" INTEGER NOT NULL,
    "maxToman" INTEGER NOT NULL,
    "avgToman" INTEGER NOT NULL,
    "samples" INTEGER NOT NULL,

    CONSTRAINT "MarketDailyPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketAuditLog" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketCategory_slug_key" ON "MarketCategory"("slug");

-- CreateIndex
CREATE INDEX "MarketCategory_parentId_idx" ON "MarketCategory"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketBrand_key_key" ON "MarketBrand"("key");

-- CreateIndex
CREATE UNIQUE INDEX "MarketCar_key_key" ON "MarketCar"("key");

-- CreateIndex
CREATE UNIQUE INDEX "MarketProduct_identityKey_key" ON "MarketProduct"("identityKey");

-- CreateIndex
CREATE INDEX "MarketProduct_categoryId_active_minPriceToman_id_idx" ON "MarketProduct"("categoryId", "active", "minPriceToman", "id");

-- CreateIndex
CREATE INDEX "MarketProduct_brandId_active_idx" ON "MarketProduct"("brandId", "active");

-- CreateIndex
CREATE INDEX "MarketProduct_active_dealScore_id_idx" ON "MarketProduct"("active", "dealScore", "id");

-- CreateIndex
CREATE INDEX "MarketProduct_active_minPriceToman_id_idx" ON "MarketProduct"("active", "minPriceToman", "id");

-- CreateIndex
CREATE INDEX "MarketProduct_active_createdAt_id_idx" ON "MarketProduct"("active", "createdAt", "id");

-- CreateIndex
CREATE INDEX "MarketProduct_partNumber_brandId_idx" ON "MarketProduct"("partNumber", "brandId");

-- CreateIndex
CREATE INDEX "MarketProduct_oemNumber_brandId_idx" ON "MarketProduct"("oemNumber", "brandId");

-- CreateIndex
CREATE INDEX "MarketFitment_carId_yearFrom_yearTo_idx" ON "MarketFitment"("carId", "yearFrom", "yearTo");

-- CreateIndex
CREATE UNIQUE INDEX "MarketFitment_productId_carId_yearFrom_yearTo_key" ON "MarketFitment"("productId", "carId", "yearFrom", "yearTo");

-- CreateIndex
CREATE INDEX "MarketSource_active_nextRunAt_idx" ON "MarketSource"("active", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketSource_kind_baseUrl_key" ON "MarketSource"("kind", "baseUrl");

-- CreateIndex
CREATE UNIQUE INDEX "MarketSeller_domain_key" ON "MarketSeller"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "MarketSeller_sourceId_externalId_key" ON "MarketSeller"("sourceId", "externalId");

-- CreateIndex
CREATE INDEX "MarketListing_productId_matchStatus_idx" ON "MarketListing"("productId", "matchStatus");

-- CreateIndex
CREATE INDEX "MarketListing_matchStatus_checkedAt_idx" ON "MarketListing"("matchStatus", "checkedAt");

-- CreateIndex
CREATE INDEX "MarketListing_sellerId_idx" ON "MarketListing"("sellerId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketListing_sourceId_externalId_key" ON "MarketListing"("sourceId", "externalId");

-- CreateIndex
CREATE INDEX "MarketMatchReview_status_createdAt_idx" ON "MarketMatchReview"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketMatchReview_listingId_fingerprint_key" ON "MarketMatchReview"("listingId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "MarketOffer_listingId_key" ON "MarketOffer"("listingId");

-- CreateIndex
CREATE INDEX "MarketOffer_productId_inStock_expiresAt_priceToman_idx" ON "MarketOffer"("productId", "inStock", "expiresAt", "priceToman");

-- CreateIndex
CREATE INDEX "MarketOffer_expiresAt_inStock_suspicious_idx" ON "MarketOffer"("expiresAt", "inStock", "suspicious");

-- CreateIndex
CREATE INDEX "MarketPriceSnapshot_productId_checkedAt_idx" ON "MarketPriceSnapshot"("productId", "checkedAt");

-- CreateIndex
CREATE INDEX "MarketPriceSnapshot_listingId_checkedAt_idx" ON "MarketPriceSnapshot"("listingId", "checkedAt");

-- CreateIndex
CREATE INDEX "MarketPriceSnapshot_checkedAt_idx" ON "MarketPriceSnapshot"("checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketPriceSnapshot_listingId_runId_key" ON "MarketPriceSnapshot"("listingId", "runId");

-- CreateIndex
CREATE INDEX "MarketCrawlRun_sourceId_status_idx" ON "MarketCrawlRun"("sourceId", "status");

-- CreateIndex
CREATE INDEX "MarketCrawlRun_status_createdAt_idx" ON "MarketCrawlRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketCrawlRun_createdAt_idx" ON "MarketCrawlRun"("createdAt");

-- CreateIndex
CREATE INDEX "MarketCrawlLog_runId_createdAt_idx" ON "MarketCrawlLog"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketAlert_active_productId_idx" ON "MarketAlert"("active", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketAlert_userId_productId_key" ON "MarketAlert"("userId", "productId");

-- CreateIndex
CREATE INDEX "MarketNotification_smsState_createdAt_idx" ON "MarketNotification"("smsState", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketNotification_alertId_cycle_key" ON "MarketNotification"("alertId", "cycle");

-- CreateIndex
CREATE INDEX "MarketDailyPrice_productId_day_idx" ON "MarketDailyPrice"("productId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "MarketDailyPrice_productId_listingId_day_key" ON "MarketDailyPrice"("productId", "listingId", "day");

-- CreateIndex
CREATE INDEX "MarketAuditLog_entityId_createdAt_idx" ON "MarketAuditLog"("entityId", "createdAt");

-- AddForeignKey
ALTER TABLE "MarketCategory" ADD CONSTRAINT "MarketCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "MarketCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketProduct" ADD CONSTRAINT "MarketProduct_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MarketCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketProduct" ADD CONSTRAINT "MarketProduct_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "MarketBrand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketFitment" ADD CONSTRAINT "MarketFitment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "MarketProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketFitment" ADD CONSTRAINT "MarketFitment_carId_fkey" FOREIGN KEY ("carId") REFERENCES "MarketCar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSeller" ADD CONSTRAINT "MarketSeller_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "MarketSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketListing" ADD CONSTRAINT "MarketListing_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "MarketSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketListing" ADD CONSTRAINT "MarketListing_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "MarketSeller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketListing" ADD CONSTRAINT "MarketListing_productId_fkey" FOREIGN KEY ("productId") REFERENCES "MarketProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketMatchReview" ADD CONSTRAINT "MarketMatchReview_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "MarketListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketMatchReview" ADD CONSTRAINT "MarketMatchReview_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "MarketProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketOffer" ADD CONSTRAINT "MarketOffer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "MarketProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketOffer" ADD CONSTRAINT "MarketOffer_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "MarketListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketPriceSnapshot" ADD CONSTRAINT "MarketPriceSnapshot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "MarketProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketPriceSnapshot" ADD CONSTRAINT "MarketPriceSnapshot_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "MarketListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketPriceSnapshot" ADD CONSTRAINT "MarketPriceSnapshot_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MarketCrawlRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketCrawlRun" ADD CONSTRAINT "MarketCrawlRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "MarketSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketCrawlLog" ADD CONSTRAINT "MarketCrawlLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MarketCrawlRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketAlert" ADD CONSTRAINT "MarketAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketAlert" ADD CONSTRAINT "MarketAlert_productId_fkey" FOREIGN KEY ("productId") REFERENCES "MarketProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketNotification" ADD CONSTRAINT "MarketNotification_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "MarketAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketDailyPrice" ADD CONSTRAINT "MarketDailyPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "MarketProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Independent catalog. No source, seller or commercial product is seeded as authorized.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "market_product_search_trgm" ON "MarketProduct" USING GIN ("searchText" gin_trgm_ops);
CREATE UNIQUE INDEX "market_one_active_run" ON "MarketCrawlRun"("sourceId") WHERE status IN ('QUEUED','RUNNING');
ALTER TABLE "MarketOffer" ADD CONSTRAINT "market_offer_money" CHECK ("priceToman">0 AND ("shippingToman" IS NULL OR "shippingToman">=0) AND (quantity IS NULL OR quantity>=0));
ALTER TABLE "MarketPriceSnapshot" ADD CONSTRAINT "market_snapshot_money" CHECK ("priceToman">0 AND ("shippingToman" IS NULL OR "shippingToman">=0));
ALTER TABLE "MarketSeller" ADD CONSTRAINT "market_seller_reputation" CHECK (reputation BETWEEN 0 AND 100);
ALTER TABLE "MarketFitment" ADD CONSTRAINT "market_fitment_years" CHECK ("yearFrom"<="yearTo");
ALTER TABLE "MarketSource" ADD CONSTRAINT "market_source_limits" CHECK ("intervalMinutes">=15 AND "minDelayMs">=1000 AND "maxPages">0 AND "offerTtlHours">0 AND (NOT active OR ("licenseUrl" IS NOT NULL AND "permissionExpiresAt" IS NOT NULL)));
INSERT INTO "MarketCategory" (id,slug,name,active) VALUES ('9812a243-0119-5169-b8d3-353e35447457','engine','قطعات موتور',true) ON CONFLICT (slug) DO NOTHING;
INSERT INTO "MarketCategory" (id,slug,name,active) VALUES ('76ef07af-c465-5e6f-9009-6c71352da704','brakes','سیستم ترمز',true) ON CONFLICT (slug) DO NOTHING;
INSERT INTO "MarketCategory" (id,slug,name,active) VALUES ('c6441e8e-e337-5ed1-a9db-6c7f3a4a742f','suspension','جلوبندی',true) ON CONFLICT (slug) DO NOTHING;
INSERT INTO "MarketCategory" (id,slug,name,active) VALUES ('a8b28fb3-ab07-5389-90fe-37f206838f15','electrical','قطعات برقی',true) ON CONFLICT (slug) DO NOTHING;
INSERT INTO "MarketCategory" (id,slug,name,active) VALUES ('a4d95ecb-a3d1-5900-9e2c-e58ef0ed0c43','body','قطعات بدنه',true) ON CONFLICT (slug) DO NOTHING;
INSERT INTO "MarketCategory" (id,slug,name,active) VALUES ('81fcf19a-9937-5c3a-ad77-a2cc206c9de2','consumables','قطعات مصرفی',true) ON CONFLICT (slug) DO NOTHING;
INSERT INTO "MarketCategory" (id,slug,name,active) VALUES ('6eb015db-86ad-520e-8e48-cd79588d00bc','filters','فیلترها',true) ON CONFLICT (slug) DO NOTHING;
INSERT INTO "MarketCategory" (id,slug,name,active) VALUES ('b458da71-1471-5c7e-b8fe-6c63c3f7513d','transmission','انتقال قدرت',true) ON CONFLICT (slug) DO NOTHING;
INSERT INTO "MarketCategory" (id,slug,name,active) VALUES ('47e5b9ac-9e50-526b-a572-e7871360b8fc','cooling','سیستم خنک‌کننده',true) ON CONFLICT (slug) DO NOTHING;
INSERT INTO "MarketCategory" (id,slug,name,active) VALUES ('9083a43d-8c3d-520a-9609-7756cf1d57fe','accessories','لوازم جانبی',true) ON CONFLICT (slug) DO NOTHING;

ALTER TABLE "MarketSource" ADD COLUMN "nextCursor" TEXT;
