ALTER TABLE "Payment" ADD COLUMN method TEXT NOT NULL DEFAULT 'GATEWAY', ADD COLUMN "cashReportedAt" TIMESTAMP(3);
CREATE TABLE "WalletReceipt" (
 version INTEGER NOT NULL DEFAULT 0, id TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"(id), "amountToman" INTEGER NOT NULL CHECK("amountToman" BETWEEN 10000 AND 100000000),
 "bankReference" TEXT NOT NULL UNIQUE, "storageKey" TEXT NOT NULL UNIQUE, "mimeType" TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK(status IN ('SUBMITTED','APPROVED','REJECTED')), "reviewNote" TEXT, "reviewedBy" TEXT, "reviewedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "WalletReceipt_status_createdAt_idx" ON "WalletReceipt"(status,"createdAt");
CREATE INDEX "WalletReceipt_userId_createdAt_idx" ON "WalletReceipt"("userId","createdAt");
ALTER TABLE "WalletEntry" ALTER COLUMN "checkoutId" DROP NOT NULL;
ALTER TABLE "WalletEntry" ADD COLUMN "receiptId" TEXT UNIQUE REFERENCES "WalletReceipt"(id), ADD COLUMN "paymentId" TEXT UNIQUE REFERENCES "Payment"(id);
ALTER TABLE "WalletEntry" ADD CONSTRAINT "WalletEntry_one_source" CHECK(num_nonnulls("checkoutId","receiptId","paymentId")=1);
