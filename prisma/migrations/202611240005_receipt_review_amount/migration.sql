BEGIN;
ALTER TABLE "WalletReceipt" ALTER COLUMN "amountToman" DROP NOT NULL, ALTER COLUMN "bankReference" DROP NOT NULL;
ALTER TABLE "WalletReceipt" ADD COLUMN "fileHash" TEXT UNIQUE;
ALTER TABLE "WalletReceipt" DROP CONSTRAINT "WalletReceipt_amountToman_check";
ALTER TABLE "WalletReceipt" ADD CONSTRAINT "wallet_receipt_amount_valid" CHECK ("amountToman" IS NULL OR "amountToman" BETWEEN 1 AND 100000000);
ALTER TABLE "WalletReceipt" ADD CONSTRAINT "wallet_receipt_approved_amount" CHECK (status <> 'APPROVED' OR ("amountToman" IS NOT NULL AND "amountToman" > 0));
COMMIT;
