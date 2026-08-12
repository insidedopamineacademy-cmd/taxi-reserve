DROP INDEX "Driver_licenseNumber_key";

CREATE INDEX "Driver_licenseNumber_idx" ON "Driver"("licenseNumber");
