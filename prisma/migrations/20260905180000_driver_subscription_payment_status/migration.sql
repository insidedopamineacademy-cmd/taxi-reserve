-- Existing generated charges are not proof of payment or nonpayment.
-- Preserve every row and amount; legacy statuses require explicit review.
CREATE TYPE "DriverSubscriptionPaymentStatus" AS ENUM ('UNVERIFIED', 'UNPAID', 'PAID');

ALTER TABLE "DriverSubscriptionCharge"
ADD COLUMN "paymentStatus" "DriverSubscriptionPaymentStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN "paidAt" DATE,
ADD COLUMN "paidByUserId" TEXT,
ADD COLUMN "paymentNote" VARCHAR(500),
ADD COLUMN "paymentRevision" INTEGER NOT NULL DEFAULT 0;

-- Future monthly generation records an unpaid obligation, without touching
-- the legacy statuses just assigned above.
ALTER TABLE "DriverSubscriptionCharge"
ALTER COLUMN "paymentStatus" SET DEFAULT 'UNPAID';

ALTER TABLE "DriverSubscriptionCharge"
ADD CONSTRAINT "DriverSubscriptionCharge_paidByUserId_fkey"
FOREIGN KEY ("paidByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "DriverSubscriptionCharge_payment_state_check" CHECK (
  ("paymentStatus" = 'PAID' AND "paidAt" IS NOT NULL AND "paidByUserId" IS NOT NULL)
  OR ("paymentStatus" <> 'PAID' AND "paidAt" IS NULL AND "paidByUserId" IS NULL)
),
ADD CONSTRAINT "DriverSubscriptionCharge_payment_revision_check" CHECK ("paymentRevision" >= 0);
