import { createHash } from "crypto";
import { EmailDirection, Prisma } from "@prisma/client";
import {
  ImapFlow,
  type FetchMessageObject,
  type ListResponse,
  type MailboxObject,
} from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { prisma } from "@/lib/prisma";
import {
  getEmailConfigIssue,
  getEmailConfigStatus,
  getEmailInitialSyncLimit,
  getImapConfig,
} from "@/lib/emails/config";
import { sanitizeEmailHtml } from "@/lib/emails/content";
import {
  classifyMailbox,
  emailFolderLabel,
  EMAIL_FOLDERS,
  type EmailFolder,
} from "@/lib/emails/folders";
import {
  classifyMailFailure,
  EmailOperationTimeoutError,
  logMailFailure,
  safeMailFailureDetail,
  withTimeout,
} from "@/lib/emails/errors";
import {
  addressList,
  firstAddress,
  normalizeMessageId,
  normalizeReferenceIds,
  safeAttachmentName,
} from "@/lib/emails/headers";
import {
  EmailSyncProgressCollector,
  type EmailSyncResult,
} from "@/lib/emails/progress";

const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;
const SYNC_TIMEOUT_MS = 110_000;

type MailboxTarget = { path: string; folder: EmailFolder };
type StoreResult = "imported" | "updated" | "skipped";

class MailboxOpenError extends Error {
  constructor(
    readonly folder: EmailFolder,
    readonly originalError: unknown,
  ) {
    super(`Unable to open ${folder}`);
    this.name = "MailboxOpenError";
  }
}

function mailboxTargets(mailboxes: ListResponse[]): MailboxTarget[] {
  const candidates = mailboxes
    .filter((mailbox) => !mailbox.flags.has("\\Noselect"))
    .map((mailbox) => ({
      path: mailbox.path,
      folder: classifyMailbox(mailbox),
      specialUse: Boolean(mailbox.specialUse),
    }))
    .filter(
      (target): target is MailboxTarget & { specialUse: boolean } => target.folder !== null,
    );

  const unique = new Map<EmailFolder, MailboxTarget & { specialUse: boolean }>();
  for (const target of candidates) {
    const current = unique.get(target.folder);
    if (!current || (!current.specialUse && target.specialUse)) {
      unique.set(target.folder, target);
    }
  }

  if (!unique.has("INBOX")) {
    unique.set("INBOX", { path: "INBOX", folder: "INBOX", specialUse: true });
  }

  return [...unique.values()]
    .map(({ path, folder }) => ({ path, folder }))
    .sort(
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
  let mailbox: MailboxObject;
  try {
    mailbox = await client.mailboxOpen(target.path, { readOnly: true });
  } catch (error) {
    throw new MailboxOpenError(target.folder, error);
  }
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

export async function syncInbox(): Promise<EmailSyncResult> {
  const progress = new EmailSyncProgressCollector();
  const configStatus = getEmailConfigStatus();
  if (!configStatus.imapConfigured) {
    progress.add({
      status: "error",
      label: "IMAP configuration is incomplete",
      detail: getEmailConfigIssue("imap") ?? "Required IMAP settings are missing.",
    });
    return progress.result(false);
  }

  progress.add({ status: "success", label: "Email configuration checked" });
  if (!configStatus.smtpConfigured) {
    progress.add({
      status: "warning",
      label: "SMTP settings incomplete — replies disabled",
      detail: getEmailConfigIssue("smtp") ?? undefined,
    });
  }
  const config = getImapConfig();
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 12_000,
    socketTimeout: 45_000,
  });
  const syncState: { stage: "connect" | "mailboxes" | "sync" } = { stage: "connect" };
  let timedOut = false;

  try {
    await withTimeout(
      (async () => {
        await client.connect();
        progress.add({ status: "success", label: "Connected to IMAP server" });
        progress.add({ status: "success", label: "IMAP login successful" });

        syncState.stage = "mailboxes";
        const targets = mailboxTargets(await client.list());
        const foundFolders = new Set(targets.map((target) => target.folder));
        progress.summary.foldersChecked = EMAIL_FOLDERS.filter(
          (folder) => folder !== "ARCHIVE" || foundFolders.has(folder),
        ).length;
        progress.add({
          status: "success",
          label: `Mailbox folders found: ${targets
            .map((target) => emailFolderLabel(target.folder))
            .join(", ")}`,
        });

        for (const folder of EMAIL_FOLDERS) {
          if (folder !== "ARCHIVE" && !foundFolders.has(folder)) {
            progress.add({
              status: "warning",
              label: `${emailFolderLabel(folder)} folder not found`,
              folder,
            });
          }
        }

        syncState.stage = "sync";
        const initialLimit = getEmailInitialSyncLimit();
        for (const target of targets) {
          if (timedOut) throw new EmailOperationTimeoutError();

          try {
            const result = await syncMailbox(client, target, config.user, initialLimit);
            if (timedOut) throw new EmailOperationTimeoutError();

            progress.summary.foldersSynced++;
            progress.summary.messagesImported += result.imported;
            progress.summary.duplicatesSkipped += result.skipped;
            const detailParts = [
              result.updated ? `${result.updated} updated` : "",
              result.skipped ? `${result.skipped} duplicates skipped` : "",
            ].filter(Boolean);
            progress.add({
              status: "success",
              label: `Synced ${emailFolderLabel(target.folder)}`,
              detail: detailParts.join("; ") || undefined,
              folder: target.folder,
              count: result.imported,
            });
          } catch (error) {
            if (error instanceof MailboxOpenError) {
              const kind = classifyMailFailure(error.originalError);
              if (kind === "unknown") {
                logMailFailure(
                  `Email sync could not open ${emailFolderLabel(error.folder)}`,
                  error.originalError,
                );
                progress.add({
                  status: "warning",
                  label: `${emailFolderLabel(error.folder)} folder could not be opened`,
                  detail: "The remaining mailbox folders were still checked.",
                  folder: error.folder,
                });
                continue;
              }
              throw error.originalError;
            }
            throw error;
          }
        }
      })(),
      SYNC_TIMEOUT_MS,
      () => {
        timedOut = true;
        client.close();
      },
    );

    progress.add({
      status: "success",
      label: progress.summary.messagesImported
        ? `Imported ${progress.summary.messagesImported} messages`
        : "No new messages to import",
      count: progress.summary.messagesImported,
    });
    if (progress.summary.duplicatesSkipped) {
      progress.add({
        status: "success",
        label: `Skipped ${progress.summary.duplicatesSkipped} duplicate messages`,
        count: progress.summary.duplicatesSkipped,
      });
    }
    progress.add({
      status: "success",
      label: "Sync completed",
      count: progress.summary.messagesImported,
    });
    return progress.result(true);
  } catch (error) {
    logMailFailure("Email inbox sync failed", error);
    const failureKind = classifyMailFailure(error);
    const timedOutFailure = failureKind === "timeout";
    const authenticationFailure = failureKind === "authentication";
    const databaseFailure = failureKind === "database";
    progress.add({
      status: "error",
      label: timedOutFailure
        ? "Email sync timed out"
        : authenticationFailure
          ? "IMAP login failed"
          : databaseFailure
            ? "Inbox database update failed"
            : syncState.stage === "mailboxes"
              ? "Finding mailbox folders failed"
              : syncState.stage === "sync"
                ? "Email sync failed"
                : "IMAP connection failed",
      detail: timedOutFailure
        ? "The server stopped waiting after 110 seconds. Try syncing again."
        : safeMailFailureDetail("IMAP", error),
    });
    return progress.result(false);
  } finally {
    if (client.usable) {
      await withTimeout(client.logout(), 5_000, () => client.close()).catch(() => client.close());
    } else {
      client.close();
    }
  }
}
