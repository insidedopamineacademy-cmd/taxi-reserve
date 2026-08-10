-- Add vehicle-based driver subscriptions without reinterpreting existing
-- commission or payment history. Existing drivers intentionally keep a NULL
-- vehicle type until an administrator configures them.
CREATE TYPE "DriverVehicleType" AS ENUM ('VAN', 'SEDAN');

ALTER TABLE "Driver"
ADD COLUMN "vehicleType" "DriverVehicleType",
ADD COLUMN "subscriptionExempt" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "DriverSubscriptionCharge" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "chargeMonth" DATE NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DriverSubscriptionCharge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DriverSubscriptionCharge_driverId_chargeMonth_key"
ON "DriverSubscriptionCharge"("driverId", "chargeMonth");

CREATE INDEX "DriverSubscriptionCharge_chargeMonth_idx"
ON "DriverSubscriptionCharge"("chargeMonth");

ALTER TABLE "DriverSubscriptionCharge"
ADD CONSTRAINT "DriverSubscriptionCharge_driverId_fkey"
FOREIGN KEY ("driverId") REFERENCES "Driver"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
