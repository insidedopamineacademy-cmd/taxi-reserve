-- Enforce at most one reservation-linked commission while allowing any number
-- of manual commissions with a NULL reservationId.
DROP INDEX "CommissionEntry_reservationId_idx";

CREATE UNIQUE INDEX "CommissionEntry_reservationId_key"
ON "CommissionEntry"("reservationId");
