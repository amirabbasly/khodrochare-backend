BEGIN;
CREATE TABLE "WalletDebit" (
 id TEXT PRIMARY KEY,
 "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "paymentId" TEXT UNIQUE REFERENCES "Payment"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "hallOrderId" TEXT UNIQUE REFERENCES "HallOrder"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "amountToman" INTEGER NOT NULL CHECK ("amountToman" > 0),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "wallet_debit_one_target" CHECK (num_nonnulls("paymentId","hallOrderId")=1)
);
CREATE INDEX "WalletDebit_userId_createdAt_idx" ON "WalletDebit"("userId","createdAt");
COMMIT;
