-- Store only bounded, structured, short-lived assistant workflow state.
-- This is not conversation or message history.
CREATE TABLE "AiWorkflowDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiWorkflowDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiWorkflowDraft_userId_kind_key"
ON "AiWorkflowDraft"("userId", "kind");

CREATE INDEX "AiWorkflowDraft_expiresAt_idx"
ON "AiWorkflowDraft"("expiresAt");

ALTER TABLE "AiWorkflowDraft"
ADD CONSTRAINT "AiWorkflowDraft_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
