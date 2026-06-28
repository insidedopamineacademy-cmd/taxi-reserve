export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import EmailMessageCard from "@/components/emails/EmailMessageCard";
import InboxAccessDenied from "@/components/emails/InboxAccessDenied";
import InboxSetupState from "@/components/emails/InboxSetupState";
import MarkThreadRead from "@/components/emails/MarkThreadRead";
import ReplyComposer from "@/components/emails/ReplyComposer";
import { isEmailInboxSchemaError, isEmailInboxSchemaReady } from "@/lib/emails/database";
import { emailFolderKey, emailFolderLabel, parseEmailFolder } from "@/lib/emails/folders";
import { getEmailInboxAccess } from "@/lib/emails/permissions";
import { prisma } from "@/lib/prisma";

const MESSAGE_LIMIT = 100;

export default async function EmailThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ threadId: string }>;
  searchParams?: Promise<{ folder?: string }>;
}) {
  const access = await getEmailInboxAccess();
  if (!access.authenticated) redirect("/login");
  if (!access.allowed) return <InboxAccessDenied />;
  if (!(await isEmailInboxSchemaReady())) return <InboxSetupState />;

  const folder = parseEmailFolder((await searchParams)?.folder);
  const folderKey = emailFolderKey(folder);
  const folderLabel = emailFolderLabel(folder);
  const { threadId } = await params;
  let thread;
  try {
    thread = await prisma.emailThread.findUnique({
      where: { id: threadId },
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: MESSAGE_LIMIT,
          include: { attachments: { orderBy: { createdAt: "asc" } } },
        },
        _count: { select: { messages: true } },
      },
    });
  } catch (error) {
    if (isEmailInboxSchemaError(error)) return <InboxSetupState />;
    throw error;
  }
  if (!thread) notFound();

  const messages = [...thread.messages].reverse();
  const recipient = thread.customerEmail || "Unknown recipient";

  return (
    <div className="mx-auto min-h-[calc(100vh-3rem)] max-w-2xl px-3 pt-3 sm:px-5 sm:py-5">
      <MarkThreadRead threadId={thread.id} unread={thread.unread} />

      <Link href={`/emails?folder=${folderKey}`} className="inline-flex min-h-11 items-center text-sm font-medium text-neutral-300 hover:text-white">
        ← Back to {folderLabel}
      </Link>

      <header className="mt-1 rounded-2xl border border-white/10 bg-[#0e1426] p-4">
        <h1 className="break-words text-xl font-semibold text-white">{thread.subject || "(No subject)"}</h1>
        <p className="mt-2 inline-flex rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-neutral-300">
          {folderLabel}
        </p>
        <p className="mt-2 break-all text-sm text-neutral-400">{thread.customerName ? `${thread.customerName} · ` : ""}{recipient}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link
            href="/reservations/new"
            className="flex min-h-12 items-center justify-center rounded-xl bg-yellow-400 px-3 text-center text-sm font-semibold text-black hover:bg-yellow-300"
          >
            Create Reservation
          </Link>
          <Link
            href="/reservations"
            className="flex min-h-12 items-center justify-center rounded-xl border border-white/15 bg-white/5 px-3 text-center text-sm font-semibold text-white hover:bg-white/10"
          >
            Open Reservations
          </Link>
        </div>
      </header>

      {thread._count.messages > MESSAGE_LIMIT ? (
        <p className="mt-3 rounded-xl bg-white/5 px-3 py-2 text-center text-xs text-neutral-400">
          Showing the latest {MESSAGE_LIMIT} messages.
        </p>
      ) : null}

      <section aria-label="Conversation" className="mt-4 grid gap-3">
        {messages.map((message) => <EmailMessageCard key={message.id} message={message} />)}
      </section>

      {/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) ? (
        <ReplyComposer threadId={thread.id} recipient={recipient} />
      ) : null}
    </div>
  );
}
