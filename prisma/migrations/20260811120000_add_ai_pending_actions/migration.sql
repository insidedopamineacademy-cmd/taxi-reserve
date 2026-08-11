-- Persist the exact server-owned action a user reviewed so confirmation is
-- replay-safe, user-bound, short-lived, and independent of the model provider.
CREATE TYPE "AiActionType" AS ENUM (
    'UPDATE_RESERVATION',
    'ASSIGN_DRIVER',
    'CLEAR_DRIVER',
    'UPDATE_RESERVATION_COMMISSION',
    'ADD_MANUAL_COMMISSION',
    'RECORD_DRIVER_PAYMENT',
    'CREATE_RESERVATION',
    'IMPORT_DRIVERS'
);

CREATE TYPE "AiActionRisk" AS ENUM (
    'READ',
    'WRITE',
    'FINANCIAL_WRITE',
    'DESTRUCTIVE'
);

CREATE TYPE "AiActionStatus" AS ENUM (
    'PENDING',
    'EXECUTING',
    'EXECUTED',
    'CANCELLED',
    'EXPIRED',
    'FAILED',
    'CONFLICTED'
);

CREATE TABLE "AiPendingAction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionType" "AiActionType" NOT NULL,
    "riskLevel" "AiActionRisk" NOT NULL,
    "status" "AiActionStatus" NOT NULL DEFAULT 'PENDING',
    "payloadJson" JSONB NOT NULL,
    "previewJson" JSONB NOT NULL,
    "preconditionJson" JSONB NOT NULL,
    "confirmationLabel" VARCHAR(120) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "resultJson" JSONB,
    "failureCode" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiPendingAction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiPendingAction_idempotencyKey_key"
ON "AiPendingAction"("idempotencyKey");

CREATE INDEX "AiPendingAction_userId_status_expiresAt_idx"
ON "AiPendingAction"("userId", "status", "expiresAt");

CREATE INDEX "AiPendingAction_status_expiresAt_idx"
ON "AiPendingAction"("status", "expiresAt");

ALTER TABLE "AiPendingAction"
ADD CONSTRAINT "AiPendingAction_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
