-- AlterEnum
ALTER TYPE "MarketCondition" ADD VALUE 'UNKNOWN';

-- AlterTable
ALTER TABLE "MarketCategory" ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "torobId" TEXT;

-- AlterTable
ALTER TABLE "MarketCar" ADD COLUMN     "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "catalogCheckedAt" TIMESTAMP(3),
ADD COLUMN     "engineCode" TEXT,
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "transmission" TEXT;

-- AlterTable
ALTER TABLE "MarketDiscoveryQuery" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "generation" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "idleRounds" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "intervalMinutes" INTEGER NOT NULL DEFAULT 360,
ADD COLUMN     "limitReached" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxProducts" INTEGER NOT NULL DEFAULT 10000,
ADD COLUMN     "maxScrolls" INTEGER NOT NULL DEFAULT 1000,
ADD COLUMN     "scrollWaitMs" INTEGER NOT NULL DEFAULT 2000,
ADD COLUMN     "seedUrl" TEXT;

-- AlterTable
ALTER TABLE "MarketReferencePrice" ADD COLUMN     "metadata" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "productId" TEXT;

-- CreateTable
CREATE TABLE "TorobCrawlLink" (
    "id" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TorobCrawlLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TorobOffer" (
    "id" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "sellerKey" TEXT NOT NULL,
    "sellerName" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "priceToman" INTEGER NOT NULL,
    "available" BOOLEAN,
    "condition" TEXT,
    "priceValidUntil" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TorobOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketProductCompatibility" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "carId" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "evidenceUrl" TEXT NOT NULL,
    "evidenceText" TEXT NOT NULL,
    "yearFrom" INTEGER,
    "yearTo" INTEGER,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketProductCompatibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketCompatibilityRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "carKeys" TEXT[],
    "requirements" JSONB NOT NULL,
    "evidenceUrl" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketCompatibilityRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TorobCrawlLink_queryId_generation_status_idx" ON "TorobCrawlLink"("queryId", "generation", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TorobCrawlLink_queryId_externalId_key" ON "TorobCrawlLink"("queryId", "externalId");

-- CreateIndex
CREATE INDEX "TorobOffer_referenceId_available_expiresAt_priceToman_idx" ON "TorobOffer"("referenceId", "available", "expiresAt", "priceToman");

-- CreateIndex
CREATE UNIQUE INDEX "TorobOffer_referenceId_externalId_key" ON "TorobOffer"("referenceId", "externalId");

-- CreateIndex
CREATE INDEX "MarketProductCompatibility_carId_expiresAt_idx" ON "MarketProductCompatibility"("carId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketProductCompatibility_productId_carId_key" ON "MarketProductCompatibility"("productId", "carId");

-- CreateIndex
CREATE INDEX "MarketCompatibilityRule_category_verified_expiresAt_idx" ON "MarketCompatibilityRule"("category", "verified", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketCategory_torobId_key" ON "MarketCategory"("torobId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketDiscoveryQuery_seedUrl_key" ON "MarketDiscoveryQuery"("seedUrl");

-- CreateIndex
CREATE UNIQUE INDEX "MarketReferencePrice_productId_key" ON "MarketReferencePrice"("productId");

-- AddForeignKey
ALTER TABLE "MarketReferencePrice" ADD CONSTRAINT "MarketReferencePrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "MarketProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TorobCrawlLink" ADD CONSTRAINT "TorobCrawlLink_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "MarketDiscoveryQuery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TorobOffer" ADD CONSTRAINT "TorobOffer_referenceId_fkey" FOREIGN KEY ("referenceId") REFERENCES "MarketReferencePrice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketProductCompatibility" ADD CONSTRAINT "MarketProductCompatibility_productId_fkey" FOREIGN KEY ("productId") REFERENCES "MarketProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketProductCompatibility" ADD CONSTRAINT "MarketProductCompatibility_carId_fkey" FOREIGN KEY ("carId") REFERENCES "MarketCar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Retire all former connectors without deleting historical prices or financial records.
UPDATE "MarketSource" SET active=false;
UPDATE "MarketCrawlRun" SET status='CANCELLED',"finishedAt"=CURRENT_TIMESTAMP WHERE status IN ('QUEUED','RUNNING');
ALTER TABLE "MarketDiscoveryQuery" DROP CONSTRAINT "market_discovery_status";
ALTER TABLE "MarketDiscoveryQuery" ADD CONSTRAINT "market_discovery_status" CHECK(status IN ('QUEUED','RUNNING','READY','BLOCKED','FAILED','FETCHING','PARTIAL','CANCELLED'));
ALTER TABLE "MarketReferencePrice" ALTER COLUMN "priceToman" DROP NOT NULL;
ALTER TABLE "MarketDiscoveryQuery" ADD CONSTRAINT "torob_seed_limits" CHECK("maxScrolls">0 AND "maxProducts">0 AND "scrollWaitMs">=1500 AND "idleRounds">=3);
ALTER TABLE "TorobOffer" ADD CONSTRAINT "torob_offer_positive" CHECK("priceToman">0);
ALTER TABLE "TorobCrawlLink" ADD CONSTRAINT "torob_link_state" CHECK(status IN ('PENDING','FETCHING','FETCHED','FAILED','CANCELLED'));
