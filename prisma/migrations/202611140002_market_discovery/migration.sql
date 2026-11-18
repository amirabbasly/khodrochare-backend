CREATE TABLE "MarketDiscoveryQuery" (
  id TEXT PRIMARY KEY,"key" TEXT NOT NULL UNIQUE,query TEXT NOT NULL,category TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'QUEUED',"nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fetchedAt" TIMESTAMP(3),"lastError" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "market_discovery_status" CHECK(status IN ('QUEUED','RUNNING','READY','BLOCKED','FAILED'))
);
CREATE TABLE "MarketReferencePrice" (
  id TEXT PRIMARY KEY,source TEXT NOT NULL DEFAULT 'TOROB',"externalId" TEXT NOT NULL,title TEXT NOT NULL,"searchText" TEXT NOT NULL,url TEXT NOT NULL,
  "priceToman" INTEGER NOT NULL,suspicious BOOLEAN NOT NULL DEFAULT false,"checkedAt" TIMESTAMP(3) NOT NULL,"expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketReferencePrice_source_externalId_key" UNIQUE(source,"externalId"),
  CONSTRAINT "market_reference_positive" CHECK("priceToman">0)
);
CREATE TABLE "MarketDiscoveryResult" (
  "queryId" TEXT NOT NULL REFERENCES "MarketDiscoveryQuery"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "referenceId" TEXT NOT NULL REFERENCES "MarketReferencePrice"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  rank INTEGER NOT NULL,"seenAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY("queryId","referenceId")
);
CREATE TABLE "MarketReferenceSnapshot" (
  id TEXT PRIMARY KEY,"referenceId" TEXT NOT NULL REFERENCES "MarketReferencePrice"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "runKey" TEXT NOT NULL,"priceToman" INTEGER NOT NULL,"checkedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketReferenceSnapshot_referenceId_runKey_key" UNIQUE("referenceId","runKey")
);
CREATE INDEX "MarketDiscoveryQuery_status_nextRunAt_idx" ON "MarketDiscoveryQuery"(status,"nextRunAt");
CREATE INDEX "MarketReferencePrice_expiresAt_suspicious_priceToman_idx" ON "MarketReferencePrice"("expiresAt",suspicious,"priceToman");
CREATE INDEX "MarketDiscoveryResult_referenceId_idx" ON "MarketDiscoveryResult"("referenceId");
CREATE INDEX "MarketReferenceSnapshot_referenceId_checkedAt_idx" ON "MarketReferenceSnapshot"("referenceId","checkedAt");
CREATE INDEX "MarketReferenceSnapshot_checkedAt_idx" ON "MarketReferenceSnapshot"("checkedAt");
CREATE INDEX "market_reference_search_trgm" ON "MarketReferencePrice" USING gin("searchText" gin_trgm_ops);
