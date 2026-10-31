-- Global switch for the automatic monthly driver-subscription generator.
CREATE TABLE "SubscriptionAutomationSetting" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SubscriptionAutomationSetting_pkey" PRIMARY KEY ("id")
);

-- Seed the single global row. This preserves current behaviour (automation ON)
-- and guarantees a row always exists as the lock target that serialises a pause
-- request against a concurrent generator run (SELECT ... FOR UPDATE).
INSERT INTO "SubscriptionAutomationSetting" ("id", "enabled", "updatedAt")
VALUES ('global', true, now());
