-- Additive user lifecycle and per-session Settings/Admin unlock state.
-- Existing users remain ACTIVE and retain their IDs and every relationship.
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE');

ALTER TABLE "User"
ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "settingsPinHash" TEXT,
ADD COLUMN "settingsPinFailedAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "settingsPinLockedUntil" TIMESTAMP(3);

ALTER TABLE "DeviceSession"
ADD COLUMN "settingsUnlockedUntil" TIMESTAMP(3);

ALTER TABLE "User"
ADD CONSTRAINT "User_settingsPinFailedAttempts_check"
CHECK ("settingsPinFailedAttempts" >= 0 AND "settingsPinFailedAttempts" < 5);
