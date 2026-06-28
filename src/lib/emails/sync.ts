import { createHash } from "crypto";
import { EmailDirection, Prisma } from "@prisma/client";
import { ImapFlow, type FetchMessageObject, type ListResponse } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { prisma } from "@/lib/prisma";
import { getEmailInitialSyncLimit, getImapConfig } from "@/lib/emails/config";
import { sanitizeEmailHtml } from "@/lib/emails/content";
import { classifyMailbox, EMAIL_FOLDERS, type EmailFolder } from "@/lib/emails/folders";
import {
  addressList,
  firstAddress,
  normalizeMessageId,
  normalizeReferenceIds,
  safeAttachmentName,
} from "@/lib/emails/headers";

const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;

type MailboxTarget = { path: string; folder: EmailFolder };
type StoreResult = "imported" | "updated" | "skipped";
type SyncResult = {
  imported: number;
  updated: number;
  skipped: number;
  folders: EmailFolder[];
};

function mailboxTargets(mailboxes: ListResponse[]): MailboxTarget[] {
  const targets = mailboxes
    .filter((mailbox) => !mailbox.flags.has("\\Noselect"))
    .map((mailbox) => ({ path: mailbox.path, folder: classifyMailbox(mailbox) }))
    .filter((target): target is MailboxTarget => target.folder !== null);

  if (!targets.some((target) => target.folder === "INBOX")) {
    targets.unshift({ path: "INBOX", folder: "INBOX" });
  }

  const unique = new Map<string, MailboxTarget>();
  for (const target of targets) unique.set(target.path, target);

  return [...unique.values()].sort(
    (left, right) => EMAIL_FOLDERS.indexOf(left.folder) - EMAIL_FOLDERS.indexOf(right.folder),
  );
}

async function parseFetchedMessage(
  client: ImapFlow,
  message: FetchMessageObject,
  uidValidity: bigint,
  mailboxPath: string,
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

  const mailboxKey = createHash("sha256").update(mailboxPath).digest("hex").slice(0, 12);
  const messageId =
    normalizeMessageId(parsed.messageId ?? message.envelope?.messageId) ??
    `<imap-${mailboxKey}-${uidValidity.toString()}-${message.uid}@taxi-reserve.local>`;

  return { parsed, messageId };
}

async function storeMailboxMessage(
  parsed: ParsedMail,
  message: FetchMessageObject,
  messageId: string,
  target: MailboxTarget,
  accountEmail: string,
): Promise<StoreResult> {
  const inReplyTo = normalizeMessageId(parsed.inReplyTo ?? message.envelope?.inReplyTo);
  const referenceIds = normalizeReferenceIds(parsed.references);
  const relationshipIds = [...new Set([...referenceIds, inReplyTo].filter(Boolean))] as string[];
  const from = firstAddress(parsed.from);
  const outgoing =
    target.folder === "SENT" || from?.address?.trim().toLowerCase() === accountEmail.toLowerCase();
  const direction = outgoing ? EmailDirection.OUTGOING : EmailDirection.INCOMING;
  const customer = outgoing ? firstAddress(parsed.to) : (firstAddress(parsed.replyTo) ?? from);
  const messageAt = parsed.date ?? (message.internalDate ? new Date(message.internalDate) : new Date());
  const unread = target.folder === "INBOX" && !outgoing && !message.flags?.has("\\Seen");

  return prisma.$transaction(async (tx) => {
    const duplicate = await tx.emailMessage.findUnique({
      where: { messageId },
      select: {
        id: true,
        folder: true,
        folders: true,
        mailbox: true,
        mailboxes: true,
        imapUid: true,
      },
    });

    if (duplicate) {
      const folders = [...new Set([...duplicate.folders, target.folder])];
      const mailboxes = [...new Set([...duplicate.mailboxes, target.path])];
      const changed =
        folders.length !== duplicate.folders.length ||
        mailboxes.length !== duplicate.mailboxes.length ||
        (duplicate.mailbox === target.path && duplicate.imapUid !== message.uid) ||
        duplicate.mailbox === null;

      if (!changed) return "skipped";

      await tx.emailMessage.update({
        where: { id: duplicate.id },
        data: {
          folder: duplicate.folder ?? target.folder,
          folders,
          mailbox: duplicate.mailbox ?? target.path,
          mailboxes,
          imapUid:
            duplicate.mailbox === null || duplicate.mailbox === target.path
              ? message.uid
              : duplicate.imapUid,
        },
      });
      return "updated";
    }

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
          lastMessageAt: messageAt,
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
        direction,
        folder: target.folder,
        folders: [target.folder],
        mailbox: target.path,
        mailboxes: [target.path],
        imapUid: message.uid,
        receivedAt: outgoing ? null : messageAt,
        sentAt: outgoing ? messageAt : null,
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

    const currentThread = await tx.emailThread.findUnique({
      where: { id: threadId },
      select: { lastMessageAt: true },
    });
    const isLatest = !currentThread?.lastMessageAt || messageAt >= currentThread.lastMessageAt;
    await tx.emailThread.update({
      where: { id: threadId },
      data: {
        subject: isLatest
          ? (parsed.subject ?? message.envelope?.subject ?? undefined)
          : undefined,
        customerEmail: isLatest ? (customer?.address ?? undefined) : undefined,
        customerName: isLatest ? (customer?.name ?? undefined) : undefined,
        lastMessageAt: isLatest ? messageAt : undefined,
        unread: unread ? true : undefined,
      },
    });

    return "imported";
  });
}

async function syncMailbox(
  client: ImapFlow,
  target: MailboxTarget,
  accountEmail: string,
  initialLimit: number,
) {
  const mailbox = await client.mailboxOpen(target.path, { readOnly: true });
  const state = await prisma.emailSyncState.findUnique({ where: { mailbox: target.path } });
  const sameMailbox = state?.uidValidity === mailbox.uidValidity;

  if (mailbox.exists === 0) {
    await prisma.emailSyncState.upsert({
      where: { mailbox: target.path },
      create: { mailbox: target.path, uidValidity: mailbox.uidValidity, lastUid: 0 },
      update: { uidValidity: mailbox.uidValidity, lastUid: 0 },
    });
    return { imported: 0, updated: 0, skipped: 0 };
  }

  let messages: FetchMessageObject[];
  if (sameMailbox) {
    const startUid = (state?.lastUid ?? 0) + 1;
    messages =
      startUid < mailbox.uidNext
        ? await client.fetchAll(
            `${startUid}:*`,
            { uid: true, flags: true, internalDate: true, size: true, envelope: true },
            { uid: true },
          )
        : [];
  } else {
    const firstSequence = Math.max(1, mailbox.exists - initialLimit + 1);
    messages = await client.fetchAll(
      `${firstSequence}:*`,
      { uid: true, flags: true, internalDate: true, size: true, envelope: true },
    );
  }
  messages.sort((left, right) => left.uid - right.uid);

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  for (const message of messages) {
    const { parsed, messageId } = await parseFetchedMessage(
      client,
      message,
      mailbox.uidValidity,
      target.path,
    );
    try {
      const result = await storeMailboxMessage(parsed, message, messageId, target, accountEmail);
      if (result === "imported") imported++;
      else if (result === "updated") updated++;
      else skipped++;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        skipped++;
        continue;
      }
      throw error;
    }
  }

  const lastUid = messages.at(-1)?.uid ?? state?.lastUid ?? mailbox.uidNext - 1;
  await prisma.emailSyncState.upsert({
    where: { mailbox: target.path },
    create: { mailbox: target.path, uidValidity: mailbox.uidValidity, lastUid },
    update: { uidValidity: mailbox.uidValidity, lastUid },
  });

  return { imported, updated, skipped };
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
    const targets = mailboxTargets(await client.list());
    const initialLimit = getEmailInitialSyncLimit();
    let imported = 0;
    let updated = 0;
    let skipped = 0;

    for (const target of targets) {
      const result = await syncMailbox(client, target, config.user, initialLimit);
      imported += result.imported;
      updated += result.updated;
      skipped += result.skipped;
    }

    return {
      imported,
      updated,
      skipped,
      folders: [...new Set(targets.map((target) => target.folder))],
    };
  } finally {
    if (client.usable) {
      await client.logout().catch(() => client.close());
    } else {
      client.close();
    }
  }
}
