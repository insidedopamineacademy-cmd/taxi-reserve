-- Additive-only schema for the shared MXRoute inbox.
CREATE TYPE "EmailDirection" AS ENUM ('INCOMING', 'OUTGOING');

CREATE TABLE "EmailThread" (
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

CREATE TABLE "EmailMessage" (
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
    "receivedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER,
    "storagePath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailSyncState" (
    "id" TEXT NOT NULL,
    "mailbox" TEXT NOT NULL,
    "uidValidity" BIGINT NOT NULL,
    "lastUid" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmailSyncState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailMessage_messageId_key" ON "EmailMessage"("messageId");
CREATE UNIQUE INDEX "EmailSyncState_mailbox_key" ON "EmailSyncState"("mailbox");
CREATE INDEX "EmailThread_lastMessageAt_idx" ON "EmailThread"("lastMessageAt");
CREATE INDEX "EmailThread_unread_lastMessageAt_idx" ON "EmailThread"("unread", "lastMessageAt");
CREATE INDEX "EmailMessage_threadId_receivedAt_idx" ON "EmailMessage"("threadId", "receivedAt");
CREATE INDEX "EmailMessage_threadId_sentAt_idx" ON "EmailMessage"("threadId", "sentAt");
CREATE INDEX "EmailMessage_inReplyTo_idx" ON "EmailMessage"("inReplyTo");
CREATE INDEX "EmailAttachment_messageId_idx" ON "EmailAttachment"("messageId");

ALTER TABLE "EmailMessage"
ADD CONSTRAINT "EmailMessage_threadId_fkey"
FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmailAttachment"
ADD CONSTRAINT "EmailAttachment_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
