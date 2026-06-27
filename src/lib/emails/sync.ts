import { EmailDirection, Prisma } from "@prisma/client";
import { ImapFlow, type FetchMessageObject } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { prisma } from "@/lib/prisma";
import { getImapConfig } from "@/lib/emails/config";
import { sanitizeEmailHtml } from "@/lib/emails/content";
import {
  addressList,
  firstAddress,
  normalizeMessageId,
  normalizeReferenceIds,
  safeAttachmentName,
} from "@/lib/emails/headers";

const MAILBOX = "INBOX";
const INITIAL_SYNC_LIMIT = 100;
const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;

type SyncResult = { imported: number; skipped: number };

async function parseFetchedMessage(
  client: ImapFlow,
  message: FetchMessageObject,
  uidValidity: bigint,
) {
  const oversized = (message.size ?? 0) > MAX_MESSAGE_BYTES;
  const full = await client.fetchOne(
    message.uid,
    oversized ? { headers: true } : { source: true },
    { uid: true },
  );

  if (!full) throw new Error(`Unable to fetch IMAP UID ${message.uid}`);

  const raw = oversized ? full.headers : full.source;
  if (!raw) throw new Error(`IMAP UID ${message.uid} did not include message content`);

  const parsed = await simpleParser(raw, {
    skipImageLinks: true,
    maxHtmlLengthToParse: MAX_MESSAGE_BYTES,
  });

  if (oversized) {
    parsed.text = "This email is larger than 25 MB. Open it in MXRoute to view its full contents.";
    parsed.html = false;
    parsed.attachments = [];
  }

  const messageId =
    normalizeMessageId(parsed.messageId ?? message.envelope?.messageId) ??
    `<imap-${uidValidity.toString()}-${message.uid}@taxi-reserve.local>`;

  return { parsed, messageId };
}

async function storeIncomingMessage(
  parsed: ParsedMail,
  message: FetchMessageObject,
  messageId: string,
) {
  const inReplyTo = normalizeMessageId(parsed.inReplyTo ?? message.envelope?.inReplyTo);
  const referenceIds = normalizeReferenceIds(parsed.references);
  const relationshipIds = [...new Set([...referenceIds, inReplyTo].filter(Boolean))] as string[];
  const from = firstAddress(parsed.from);
  const replyTo = firstAddress(parsed.replyTo);
  const customer = replyTo ?? from;
  const receivedAt = parsed.date ?? (message.internalDate ? new Date(message.internalDate) : new Date());
  const unread = !message.flags?.has("\\Seen");

  return prisma.$transaction(async (tx) => {
    const duplicate = await tx.emailMessage.findUnique({ where: { messageId }, select: { id: true } });
    if (duplicate) return false;

    const related = await tx.emailMessage.findMany({
      where: {
        OR: [
          ...(relationshipIds.length ? [{ messageId: { in: relationshipIds } }] : []),
          { inReplyTo: messageId },
          { referenceIds: { has: messageId } },
        ],
      },
      orderBy: { createdAt: "asc" },
      select: { threadId: true },
    });

    let threadId = related[0]?.threadId;
    if (!threadId) {
      const thread = await tx.emailThread.create({
        data: {
          subject: parsed.subject ?? message.envelope?.subject ?? null,
          customerEmail: customer?.address ?? null,
          customerName: customer?.name ?? null,
          lastMessageAt: receivedAt,
          unread,
        },
        select: { id: true },
      });
      threadId = thread.id;
    } else {
      const otherThreadIds = [...new Set(related.map((item) => item.threadId))].filter(
        (id) => id !== threadId,
      );
      if (otherThreadIds.length) {
        await tx.emailMessage.updateMany({
          where: { threadId: { in: otherThreadIds } },
          data: { threadId },
        });
        await tx.emailThread.deleteMany({ where: { id: { in: otherThreadIds } } });
      }
    }

    await tx.emailMessage.create({
      data: {
        threadId,
        messageId,
        inReplyTo,
        referenceIds,
        fromEmail: from?.address ?? null,
        fromName: from?.name ?? null,
        toEmails: addressList(parsed.to) || null,
        ccEmails: addressList(parsed.cc) || null,
        subject: parsed.subject ?? message.envelope?.subject ?? null,
        bodyHtml: parsed.html ? sanitizeEmailHtml(parsed.html) : null,
        bodyText: parsed.text?.trim() || null,
        direction: EmailDirection.INCOMING,
        receivedAt,
        attachments: {
          create: parsed.attachments
            .filter((attachment) => !attachment.related)
            .map((attachment) => ({
              filename: safeAttachmentName(attachment.filename),
              mimeType: attachment.contentType || null,
              size: Number.isSafeInteger(attachment.size) ? attachment.size : null,
            })),
        },
      },
    });

    await tx.emailThread.update({
      where: { id: threadId },
      data: {
        subject: parsed.subject ?? message.envelope?.subject ?? undefined,
        customerEmail: customer?.address ?? undefined,
        customerName: customer?.name ?? undefined,
        lastMessageAt: receivedAt,
        unread: unread ? true : undefined,
      },
    });

    return true;
  });
}

export async function syncInbox(): Promise<SyncResult> {
  const config = getImapConfig();
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });

  try {
    await client.connect();
    const mailbox = await client.mailboxOpen(MAILBOX, { readOnly: true });
    const state = await prisma.emailSyncState.findUnique({ where: { mailbox: MAILBOX } });
    const sameMailbox = state?.uidValidity === mailbox.uidValidity;

    if (mailbox.exists === 0) {
      await prisma.emailSyncState.upsert({
        where: { mailbox: MAILBOX },
        create: { mailbox: MAILBOX, uidValidity: mailbox.uidValidity, lastUid: 0 },
        update: { uidValidity: mailbox.uidValidity, lastUid: 0 },
      });
      return { imported: 0, skipped: 0 };
    }

    const startUid = sameMailbox
      ? (state?.lastUid ?? 0) + 1
      : Math.max(1, mailbox.uidNext - INITIAL_SYNC_LIMIT);

    if (startUid >= mailbox.uidNext) return { imported: 0, skipped: 0 };

    const messages = await client.fetchAll(
      `${startUid}:*`,
      { uid: true, flags: true, internalDate: true, size: true, envelope: true },
      { uid: true },
    );
    messages.sort((a, b) => a.uid - b.uid);

    let imported = 0;
    let skipped = 0;
    for (const message of messages) {
      const { parsed, messageId } = await parseFetchedMessage(client, message, mailbox.uidValidity);
      try {
        const stored = await storeIncomingMessage(parsed, message, messageId);
        if (stored) {
          imported++;
        } else {
          skipped++;
        }
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          skipped++;
          continue;
        }
        throw error;
      }
    }

    const lastUid = messages.at(-1)?.uid ?? mailbox.uidNext - 1;
    await prisma.emailSyncState.upsert({
      where: { mailbox: MAILBOX },
      create: { mailbox: MAILBOX, uidValidity: mailbox.uidValidity, lastUid },
      update: { uidValidity: mailbox.uidValidity, lastUid },
    });

    return { imported, skipped };
  } finally {
    if (client.usable) {
      await client.logout().catch(() => client.close());
    } else {
      client.close();
    }
  }
}
