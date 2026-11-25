ALTER TABLE "HallListing" ADD COLUMN "requestedBoosts" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "HallListing" ADD CONSTRAINT "hall_requested_boosts_valid" CHECK (
 "requestedBoosts" <@ ARRAY['LADDER','FEATURED']::TEXT[] AND cardinality("requestedBoosts") <= 2
);
