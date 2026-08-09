-- Manual commissions keep their own optional route context. Reservation-linked
-- commissions continue to use Reservation pickup/drop-off as the source of truth.
ALTER TABLE "CommissionEntry"
ADD COLUMN "manualPickupText" TEXT,
ADD COLUMN "manualDropoffText" TEXT;
