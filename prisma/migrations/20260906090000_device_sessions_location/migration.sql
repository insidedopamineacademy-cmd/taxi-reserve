-- Additive registry. Existing users and financial records are untouched.
CREATE TABLE "DeviceSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "revokedByUserId" TEXT,
  "revokeReason" VARCHAR(40),
  "userAgent" VARCHAR(512),
  "device" VARCHAR(40) NOT NULL,
  "browser" VARCHAR(40) NOT NULL,
  "os" VARCHAR(40) NOT NULL,
  "ipAddress" VARCHAR(45),
  "networkCity" VARCHAR(80),
  "networkRegion" VARCHAR(80),
  "networkCountry" VARCHAR(80),
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "accuracy" DOUBLE PRECISION,
  "locationCapturedAt" TIMESTAMP(3),
  "locationVerifiedAt" TIMESTAMP(3),
  CONSTRAINT "DeviceSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeviceSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DeviceSession_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "DeviceSession_expiry_check" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "DeviceSession_location_check" CHECK (
    ("latitude" IS NULL AND "longitude" IS NULL AND "accuracy" IS NULL AND "locationCapturedAt" IS NULL AND "locationVerifiedAt" IS NULL)
    OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180
      AND "accuracy" BETWEEN 0 AND 100000 AND "latitude" IS NOT NULL AND "longitude" IS NOT NULL
      AND "accuracy" IS NOT NULL AND "locationCapturedAt" IS NOT NULL AND "locationVerifiedAt" IS NOT NULL)
  )
);
CREATE INDEX "DeviceSession_userId_revokedAt_expiresAt_idx" ON "DeviceSession"("userId", "revokedAt", "expiresAt");
CREATE INDEX "DeviceSession_expiresAt_idx" ON "DeviceSession"("expiresAt");
CREATE INDEX "DeviceSession_revokedAt_idx" ON "DeviceSession"("revokedAt");
