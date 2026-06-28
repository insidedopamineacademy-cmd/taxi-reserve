import { randomUUID } from "crypto";
import { EmailDirection } from "@prisma/client";
import nodemailer from "smtp-nodemailer";
import { prisma } from "@/lib/prisma";
import { getSmtpConfig } from "@/lib/emails/config";

export class EmailSendInputError extends Error {}

function replySubject(subject?: string | null) {
  const value = subject?.trim() || "Your Taxi Reserve enquiry";
  return /^re:/i.test(value) ? value : `Re: ${value}`;
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function sendThreadReply(threadId: string, body: string) {
  const cleanThreadId = threadId.trim();
  const cleanBody = body.trim();
  if (!cleanThreadId || cleanThreadId.length > 128 || !cleanBody || cleanBody.length > 20_000) {
    throw new EmailSendInputError("Enter a reply of up to 20,000 characters.");
  }

  const thread = await prisma.emailThread.findUnique({
    where: { id: cleanThreadId },
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { messageId: true, referenceIds: true },
      },
    },
  });

  if (!thread) throw new EmailSendInputError("Email thread not found.");
  const recipient = thread.customerEmail?.trim() ?? "";
  if (!isEmail(recipient)) {
    throw new EmailSendInputError("This thread does not have a valid reply address.");
  }

  const config = getSmtpConfig();
  const latest = thread.messages[0];
  const references = latest
    ? [...new Set([...latest.referenceIds, latest.messageId])].slice(-50)
    : [];
  const domain = config.user.split("@")[1] || "taxi-reserve.local";
  const messageId = `<${randomUUID()}@${domain}>`;
  const sentAt = new Date();
  const subject = replySubject(thread.subject);

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });

  await transporter.sendMail({
    from: { name: "Taxi Reserve", address: config.user },
    to: recipient,
    subject,
    text: cleanBody,
    messageId,
    inReplyTo: latest?.messageId,
    references,
  });

  await prisma.$transaction([
    prisma.emailMessage.create({
      data: {
        threadId: thread.id,
        messageId,
        inReplyTo: latest?.messageId ?? null,
        referenceIds: references,
        fromEmail: config.user,
        fromName: "Taxi Reserve",
        toEmails: recipient,
        subject,
        bodyText: cleanBody,
        direction: EmailDirection.OUTGOING,
        folder: "SENT",
        folders: ["SENT"],
        sentAt,
      },
    }),
    prisma.emailThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: sentAt, unread: false },
    }),
  ]);

  return { messageId };
}
