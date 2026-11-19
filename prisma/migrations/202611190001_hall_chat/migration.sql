CREATE TABLE "HallConversation" (
 "id" TEXT PRIMARY KEY, "listingId" TEXT NOT NULL REFERENCES "HallListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "buyerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE, "sellerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "buyerReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "sellerReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "HallConversation_listingId_buyerId_key" ON "HallConversation"("listingId", "buyerId");
CREATE INDEX "HallConversation_buyerId_updatedAt_idx" ON "HallConversation"("buyerId", "updatedAt");
CREATE INDEX "HallConversation_sellerId_updatedAt_idx" ON "HallConversation"("sellerId", "updatedAt");
CREATE TABLE "HallMessage" (
 "id" TEXT PRIMARY KEY, "conversationId" TEXT NOT NULL REFERENCES "HallConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "senderId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE, "clientId" TEXT NOT NULL,
 "body" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "HallMessage_conversationId_senderId_clientId_key" ON "HallMessage"("conversationId", "senderId", "clientId");
CREATE INDEX "HallMessage_conversationId_createdAt_id_idx" ON "HallMessage"("conversationId", "createdAt", "id");
