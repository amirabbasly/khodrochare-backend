-- Soft deletion must be an allowed database lifecycle state as well as an API state.
-- Keep the migration atomic: never leave the table without its status constraint.
BEGIN;
ALTER TABLE "HallListing" DROP CONSTRAINT "HallListing_status_check";
ALTER TABLE "HallListing" ADD CONSTRAINT "HallListing_status_check"
  CHECK (status IN ('DRAFT', 'PUBLISHED', 'BLOCKED', 'SOLD', 'DELETED'));
COMMIT;
