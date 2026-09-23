-- Soft-delete support for drivers. A non-null "deletedAt" hides the driver from
-- every operational surface while all historical financial, reservation and
-- audit records (which keep RESTRICT foreign keys) remain intact. The column is
-- nullable with no default, so every existing driver stays active on deploy.
ALTER TABLE "Driver"
ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Supports the "deletedAt IS NULL" predicate that now guards driver reads.
CREATE INDEX "Driver_deletedAt_idx"
ON "Driver"("deletedAt");
