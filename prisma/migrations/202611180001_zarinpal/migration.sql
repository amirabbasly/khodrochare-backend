ALTER TABLE "Payment" ALTER COLUMN "cardNumber" DROP NOT NULL;
ALTER TABLE "Payment" ALTER COLUMN "accountName" DROP NOT NULL;
ALTER TABLE "Payment" ALTER COLUMN status SET DEFAULT 'AWAITING_PAYMENT';
ALTER TABLE "Payment" DROP CONSTRAINT "payment_status_valid";
ALTER TABLE "Payment" ADD CONSTRAINT "payment_status_valid" CHECK(status IN ('AWAITING_TRANSFER','SUBMITTED','VERIFIED','REJECTED','AWAITING_PAYMENT','GATEWAY_PENDING','SANDBOX_VERIFIED','REFUND_REQUIRED'));
CREATE TABLE "GatewayCheckout" (
 id TEXT PRIMARY KEY,"userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "paymentId" TEXT REFERENCES "Payment"(id) ON DELETE SET NULL ON UPDATE CASCADE,
 purpose TEXT NOT NULL,mode TEXT NOT NULL,"amountToman" INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'CREATING',
 "idempotencyKey" TEXT NOT NULL,authority TEXT UNIQUE,"refId" TEXT,"merchantHash" TEXT NOT NULL,"errorCode" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"verifiedAt" TIMESTAMP(3),
 CONSTRAINT "GatewayCheckout_userId_idempotencyKey_key" UNIQUE("userId","idempotencyKey"),
 CONSTRAINT "gateway_mode" CHECK(mode IN ('sandbox','live')),
 CONSTRAINT "gateway_purpose" CHECK(purpose IN ('REQUEST','WALLET')),
 CONSTRAINT "gateway_positive" CHECK("amountToman">0),
 CONSTRAINT "gateway_target" CHECK((purpose='REQUEST' AND "paymentId" IS NOT NULL) OR (purpose='WALLET' AND "paymentId" IS NULL))
);
CREATE INDEX "GatewayCheckout_paymentId_status_idx" ON "GatewayCheckout"("paymentId",status);
CREATE INDEX "GatewayCheckout_userId_createdAt_idx" ON "GatewayCheckout"("userId","createdAt");
CREATE UNIQUE INDEX "gateway_one_pending_request" ON "GatewayCheckout"("paymentId") WHERE status IN ('CREATING','PENDING');
CREATE TABLE "WalletEntry" (
 id TEXT PRIMARY KEY,"userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "checkoutId" TEXT NOT NULL UNIQUE REFERENCES "GatewayCheckout"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "amountToman" INTEGER NOT NULL,mode TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "wallet_credit_positive" CHECK("amountToman">0),CONSTRAINT "wallet_mode" CHECK(mode IN ('sandbox','live'))
);
CREATE INDEX "WalletEntry_userId_mode_createdAt_idx" ON "WalletEntry"("userId",mode,"createdAt");
