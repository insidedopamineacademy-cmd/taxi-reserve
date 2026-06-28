-- Additive, idempotent repair for databases where the original email migration
-- was marked applied without executing its SQL.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type type
    JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
    WHERE namespace.nspname = 'public' AND type.typname = 'EmailDirection'
  ) THEN
    CREATE TYPE "EmailDirection" AS ENUM ('INCOMING', 'OUTGOING');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "EmailThread" (
  "id" TEXT NOT NULL,
  "subject" TEXT,
  "customerEmail" TEXT,
  "customerName" TEXT,
  "lastMessageAt" TIMESTAMP(3),
  "unread" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailThread_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EmailMessage" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "inReplyTo" TEXT,
  "referenceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "fromEmail" TEXT,
  "fromName" TEXT,
  "toEmails" TEXT,
  "ccEmails" TEXT,
  "subject" TEXT,
  "bodyHtml" TEXT,
  "bodyText" TEXT,
  "direction" "EmailDirection" NOT NULL,
  "folder" TEXT,
  "folders" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "mailbox" TEXT,
  "mailboxes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "imapUid" INTEGER,
  "receivedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EmailAttachment" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT,
  "size" INTEGER,
  "storagePath" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EmailSyncState" (
  "id" TEXT NOT NULL,
  "mailbox" TEXT NOT NULL,
  "uidValidity" BIGINT NOT NULL,
  "lastUid" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailSyncState_pkey" PRIMARY KEY ("id")
);

-- Add folder columns when the original email tables already exist.
ALTER TABLE "EmailMessage" ADD COLUMN IF NOT EXISTS "folder" TEXT;
ALTER TABLE "EmailMessage" ADD COLUMN IF NOT EXISTS "folders" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "EmailMessage" ADD COLUMN IF NOT EXISTS "mailbox" TEXT;
ALTER TABLE "EmailMessage" ADD COLUMN IF NOT EXISTS "mailboxes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "EmailMessage" ADD COLUMN IF NOT EXISTS "imapUid" INTEGER;

-- Preserve pre-folder email rows in their expected canonical folder.
UPDATE "EmailMessage"
SET "folder" = CASE WHEN "direction" = 'OUTGOING' THEN 'SENT' ELSE 'INBOX' END
WHERE "folder" IS NULL;

UPDATE "EmailMessage"
SET "folders" = ARRAY["folder"]
WHERE cardinality("folders") = 0 AND "folder" IS NOT NULL;

UPDATE "EmailMessage"
SET "mailbox" = 'INBOX'
WHERE "mailbox" IS NULL AND "direction" = 'INCOMING';

UPDATE "EmailMessage"
SET "mailboxes" = ARRAY["mailbox"]
WHERE cardinality("mailboxes") = 0 AND "mailbox" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "EmailMessage_messageId_key" ON "EmailMessage"("messageId");
CREATE UNIQUE INDEX IF NOT EXISTS "EmailSyncState_mailbox_key" ON "EmailSyncState"("mailbox");
CREATE INDEX IF NOT EXISTS "EmailThread_lastMessageAt_idx" ON "EmailThread"("lastMessageAt");
CREATE INDEX IF NOT EXISTS "EmailThread_unread_lastMessageAt_idx" ON "EmailThread"("unread", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "EmailMessage_threadId_receivedAt_idx" ON "EmailMessage"("threadId", "receivedAt");
CREATE INDEX IF NOT EXISTS "EmailMessage_threadId_sentAt_idx" ON "EmailMessage"("threadId", "sentAt");
CREATE INDEX IF NOT EXISTS "EmailMessage_inReplyTo_idx" ON "EmailMessage"("inReplyTo");
CREATE INDEX IF NOT EXISTS "EmailMessage_folder_createdAt_idx" ON "EmailMessage"("folder", "createdAt");
CREATE INDEX IF NOT EXISTS "EmailMessage_folders_idx" ON "EmailMessage" USING GIN ("folders");
CREATE INDEX IF NOT EXISTS "EmailMessage_mailbox_imapUid_idx" ON "EmailMessage"("mailbox", "imapUid");
CREATE INDEX IF NOT EXISTS "EmailMessage_mailboxes_idx" ON "EmailMessage" USING GIN ("mailboxes");
CREATE INDEX IF NOT EXISTS "EmailAttachment_messageId_idx" ON "EmailAttachment"("messageId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'EmailMessage_threadId_fkey'
      AND conrelid = '"EmailMessage"'::regclass
  ) THEN
    ALTER TABLE "EmailMessage"
      ADD CONSTRAINT "EmailMessage_threadId_fkey"
      FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'EmailAttachment_messageId_fkey'
      AND conrelid = '"EmailAttachment"'::regclass
  ) THEN
    ALTER TABLE "EmailAttachment"
      ADD CONSTRAINT "EmailAttachment_messageId_fkey"
      FOREIGN KEY ("messageId") REFERENCES "EmailMessage"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
