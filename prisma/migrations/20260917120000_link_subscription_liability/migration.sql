-- Existing subscription rows remain valid and unlinked. Only future atomic
-- generation assigns this nullable one-to-one relationship.
ALTER TABLE "CommissionEntry"
ADD COLUMN "subscriptionChargeId" TEXT;

CREATE UNIQUE INDEX "CommissionEntry_subscriptionChargeId_key"
ON "CommissionEntry"("subscriptionChargeId");

ALTER TABLE "CommissionEntry"
ADD CONSTRAINT "CommissionEntry_subscriptionChargeId_fkey"
FOREIGN KEY ("subscriptionChargeId")
REFERENCES "DriverSubscriptionCharge"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "CommissionEntry"
ADD CONSTRAINT "CommissionEntry_single_source_check"
CHECK (NOT ("reservationId" IS NOT NULL AND "subscriptionChargeId" IS NOT NULL));
