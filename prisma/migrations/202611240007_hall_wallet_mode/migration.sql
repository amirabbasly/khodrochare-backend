BEGIN;
-- Gateway Hall orders remain sandbox-only. Real funds are supported only by
-- wallet orders, identified at creation before the debit and activation.
ALTER TABLE "HallOrder" DROP CONSTRAINT "HallOrder_mode_check";
ALTER TABLE "HallOrder" ADD CONSTRAINT "HallOrder_mode_check" CHECK (
  mode = 'sandbox' OR (
    mode = 'live'
    AND "refId" IS NOT NULL
    AND "refId" LIKE 'WALLET-%'
    AND authority IS NULL
  )
);
COMMIT;
