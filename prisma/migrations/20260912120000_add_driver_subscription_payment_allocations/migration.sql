-- Payment allocations classify an existing DriverPayment; they never add a
-- second balance movement. Deleting a payment reverses its allocations.
CREATE TABLE "DriverSubscriptionPaymentAllocation" (
    "id" TEXT NOT NULL,
    "driverPaymentId" TEXT NOT NULL,
    "subscriptionChargeId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DriverSubscriptionPaymentAllocation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DriverSubscriptionPaymentAllocation_positive_amount_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "DriverSubscriptionAllocation_payment_charge_key"
ON "DriverSubscriptionPaymentAllocation"("driverPaymentId", "subscriptionChargeId");

CREATE INDEX "DriverSubscriptionPaymentAllocation_subscriptionChargeId_idx"
ON "DriverSubscriptionPaymentAllocation"("subscriptionChargeId");

ALTER TABLE "DriverSubscriptionPaymentAllocation"
ADD CONSTRAINT "DriverSubscriptionPaymentAllocation_driverPaymentId_fkey"
FOREIGN KEY ("driverPaymentId") REFERENCES "DriverPayment"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DriverSubscriptionPaymentAllocation"
ADD CONSTRAINT "DriverSubscriptionPaymentAllocation_subscriptionChargeId_fkey"
FOREIGN KEY ("subscriptionChargeId") REFERENCES "DriverSubscriptionCharge"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
