BEGIN;

-- Cash collections debit the company commission, rather than crediting the
-- driver's wallet. Retain the one-source, uniqueness and wallet-mode guards.
ALTER TABLE "WalletEntry" DROP CONSTRAINT "wallet_credit_positive";
ALTER TABLE "WalletEntry" ADD CONSTRAINT "wallet_amount_source_valid" CHECK (
  ("paymentId" IS NOT NULL AND "amountToman" <= 0 AND mode = 'live')
  OR ("paymentId" IS NULL AND "amountToman" > 0)
);

-- A free periodic service has a verified zero invoice and no wallet debit.
-- Keep every existing money invariant; only explicitly FREE invoices can be 0.
ALTER TABLE "Payment" DROP CONSTRAINT "payment_money_valid";
ALTER TABLE "Payment" ADD CONSTRAINT "payment_money_valid" CHECK (
  "serviceToman" >= 0 AND "partsToman" >= 0 AND "amountToman" >= 0
  AND "amountToman" = "serviceToman" + "partsToman"
  AND "commissionToman" >= 0 AND "driverShareToman" >= 0
  AND "commissionToman" + "driverShareToman" = "amountToman"
  AND "commissionPercent" IN (20,30)
  AND (
    ("amountToman" > 0 AND method <> 'FREE')
    OR ("amountToman" = 0 AND method = 'FREE' AND status = 'VERIFIED')
  )
);

COMMIT;
