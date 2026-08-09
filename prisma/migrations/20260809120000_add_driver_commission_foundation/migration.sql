-- Add the driver and commission-account foundation without changing existing reservation behavior.
CREATE TYPE "DriverStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "DriverPaymentMethod" AS ENUM ('CASH', 'BANK', 'OTHER');

CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "status" "DriverStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Reservation" ADD COLUMN "driverId" TEXT;

CREATE TABLE "CommissionEntry" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "reservationId" TEXT,
    "commissionAmount" DECIMAL(10,2) NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommissionEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriverPayment" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" "DriverPaymentMethod" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DriverPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Driver_licenseNumber_key" ON "Driver"("licenseNumber");
CREATE INDEX "Reservation_driverId_idx" ON "Reservation"("driverId");
CREATE INDEX "CommissionEntry_driverId_entryDate_idx" ON "CommissionEntry"("driverId", "entryDate");
CREATE INDEX "CommissionEntry_reservationId_idx" ON "CommissionEntry"("reservationId");
CREATE INDEX "DriverPayment_driverId_paymentDate_idx" ON "DriverPayment"("driverId", "paymentDate");

ALTER TABLE "Reservation"
ADD CONSTRAINT "Reservation_driverId_fkey"
FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CommissionEntry"
ADD CONSTRAINT "CommissionEntry_driverId_fkey"
FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommissionEntry"
ADD CONSTRAINT "CommissionEntry_reservationId_fkey"
FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DriverPayment"
ADD CONSTRAINT "DriverPayment_driverId_fkey"
FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
