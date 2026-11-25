BEGIN;
CREATE TABLE "ShowroomAccount" (
 "userId" TEXT PRIMARY KEY REFERENCES "User"(id) ON DELETE RESTRICT,
 name TEXT NOT NULL,"ownerName" TEXT NOT NULL,"activityType" TEXT NOT NULL,
 province TEXT NOT NULL,city TEXT NOT NULL,district TEXT NOT NULL,landline TEXT NOT NULL,address TEXT NOT NULL,
 "isActive" BOOLEAN NOT NULL DEFAULT true,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "Showroom" (
 id TEXT PRIMARY KEY,"ownerId" TEXT NOT NULL REFERENCES "ShowroomAccount"("userId") ON DELETE RESTRICT,
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PENDING_REVIEW','PUBLISHED','REJECTED','DISABLED')),
 "isActive" BOOLEAN NOT NULL DEFAULT true,version INTEGER NOT NULL DEFAULT 0,draft JSONB NOT NULL DEFAULT '{}',"reviewNote" TEXT,
 "submittedAt" TIMESTAMP(3),"reviewedAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Showroom_ownerId_createdAt_idx" ON "Showroom"("ownerId","createdAt");
CREATE INDEX "Showroom_status_isActive_createdAt_idx" ON "Showroom"(status,"isActive","createdAt");
CREATE TABLE "ShowroomPhoto" (
 id TEXT PRIMARY KEY,"showroomId" TEXT NOT NULL REFERENCES "Showroom"(id) ON DELETE RESTRICT,
 "storageKey" TEXT NOT NULL UNIQUE,"mimeType" TEXT NOT NULL,"readToken" TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('SHOP','PERSON')),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ShowroomPhoto_showroomId_idx" ON "ShowroomPhoto"("showroomId");
ALTER TABLE "HallListing" ADD COLUMN "showroomId" TEXT REFERENCES "Showroom"(id) ON DELETE RESTRICT;
CREATE INDEX "HallListing_showroomId_idx" ON "HallListing"("showroomId");
CREATE TABLE "GoldCampaign" (
 id TEXT PRIMARY KEY,"showroomId" TEXT NOT NULL UNIQUE REFERENCES "Showroom"(id) ON DELETE RESTRICT,
 "bidToman" INTEGER NOT NULL DEFAULT 6000 CHECK("bidToman" BETWEEN 6000 AND 100000000),
 "balanceToman" INTEGER NOT NULL DEFAULT 0 CHECK("balanceToman" BETWEEN 0 AND 100000000),"isActive" BOOLEAN NOT NULL DEFAULT false,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "GoldFunding" (
 id TEXT PRIMARY KEY,"campaignId" TEXT NOT NULL REFERENCES "GoldCampaign"(id) ON DELETE RESTRICT,
 "idempotencyKey" TEXT NOT NULL UNIQUE,"amountToman" INTEGER NOT NULL CHECK("amountToman" BETWEEN 6000 AND 100000000),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "GoldClick" (
 id TEXT PRIMARY KEY,"campaignId" TEXT NOT NULL REFERENCES "GoldCampaign"(id) ON DELETE RESTRICT,
 "visitorHash" TEXT NOT NULL,day TEXT NOT NULL,"amountToman" INTEGER NOT NULL CHECK("amountToman">=6000),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("campaignId","visitorHash",day)
);
ALTER TABLE "WalletDebit" ADD COLUMN "goldFundingId" TEXT UNIQUE REFERENCES "GoldFunding"(id) ON DELETE RESTRICT;
ALTER TABLE "WalletDebit" DROP CONSTRAINT wallet_debit_one_target;
ALTER TABLE "WalletDebit" ADD CONSTRAINT wallet_debit_one_target CHECK(num_nonnulls("paymentId","hallOrderId","goldFundingId")=1);
CREATE TABLE "FeaturedSlot" (
 id INTEGER PRIMARY KEY CHECK(id BETWEEN 1 AND 6),"listingId" TEXT UNIQUE REFERENCES "HallListing"(id) ON DELETE RESTRICT,
 "orderId" TEXT UNIQUE REFERENCES "HallOrder"(id) ON DELETE RESTRICT,"reservedUntil" TIMESTAMP(3)
);
INSERT INTO "FeaturedSlot"(id) SELECT generate_series(1,6);
-- Existing purchases retain their entitlement. Only the newest six are displayed
-- while older paid services finish; new purchases obey the six-slot reservation.
INSERT INTO "FeaturedSlot"(id,"listingId","reservedUntil")
 SELECT row_number() OVER(ORDER BY "featuredUntil" DESC,id DESC)::INTEGER,id,"featuredUntil"
 FROM (SELECT id,"featuredUntil" FROM "HallListing" WHERE "featuredUntil">CURRENT_TIMESTAMP ORDER BY "featuredUntil" DESC,id DESC LIMIT 6) a
 ON CONFLICT(id) DO UPDATE SET "listingId"=EXCLUDED."listingId","reservedUntil"=EXCLUDED."reservedUntil";
COMMIT;
