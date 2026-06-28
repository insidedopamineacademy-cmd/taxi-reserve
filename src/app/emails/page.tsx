export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import InboxAccessDenied from "@/components/emails/InboxAccessDenied";
import InboxSetupState from "@/components/emails/InboxSetupState";
import SyncButton from "@/components/emails/SyncButton";
import { emailPreview } from "@/lib/emails/content";
import { isEmailInboxSchemaError, isEmailInboxSchemaReady } from "@/lib/emails/database";
import {
  emailFolderKey,
  emailFolderLabel,
  EMAIL_FOLDER_OPTIONS,
  parseEmailFolder,
  type EmailFolder,
} from "@/lib/emails/folders";
import { getEmailInboxAccess } from "@/lib/emails/permissions";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 20;

type Search = { q?: string; filter?: string; folder?: string; page?: string };

function pageHref(q: string, filter: string, folder: EmailFolder, page: number) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (filter === "unread") params.set("filter", "unread");
  if (folder !== "INBOX") params.set("folder", emailFolderKey(folder));
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/emails?${query}` : "/emails";
}

function formatInboxDate(date: Date | null) {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default async function EmailsPage({ searchParams }: { searchParams?: Promise<Search> }) {
  const access = await getEmailInboxAccess();
  if (!access.authenticated) redirect("/login");
  if (!access.allowed) return <InboxAccessDenied />;
  if (!(await isEmailInboxSchemaReady())) return <InboxSetupState />;

  const params = (await searchParams) ?? {};
  const q = params.q?.trim().slice(0, 100) ?? "";
  const folder = parseEmailFolder(params.folder);
  const filter = params.filter === "unread" && folder === "INBOX" ? "unread" : "all";
  const folderKey = emailFolderKey(folder);
  const folderLabel = emailFolderLabel(folder);
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const conditions: Prisma.EmailThreadWhereInput[] = [
    { messages: { some: { folders: { has: folder } } } },
  ];
  if (q) {
    conditions.push({
      OR: [
        { subject: { contains: q, mode: "insensitive" } },
        { customerName: { contains: q, mode: "insensitive" } },
        { customerEmail: { contains: q, mode: "insensitive" } },
        {
          messages: {
            some: {
              folders: { has: folder },
              bodyText: { contains: q, mode: "insensitive" },
            },
          },
        },
      ],
    });
  }
  if (filter === "unread") conditions.push({ unread: true });
  const where: Prisma.EmailThreadWhereInput = { AND: conditions };

  let threads;
  let total;
  try {
    [threads, total] = await Promise.all([
      prisma.emailThread.findMany({
        where,
        orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          messages: {
            where: { folders: { has: folder } },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { bodyText: true, bodyHtml: true, fromName: true, fromEmail: true },
          },
        },
      }),
      prisma.emailThread.count({ where }),
    ]);
  } catch (error) {
    if (isEmailInboxSchemaError(error)) return <InboxSetupState />;
    throw error;
  }
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto min-h-[calc(100vh-3rem)] max-w-2xl px-3 py-4 sm:px-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Inbox</h1>
          <p className="mt-1 text-sm text-neutral-400">{folderLabel} · Shared MXRoute email</p>
        </div>
        <SyncButton />
      </header>

      <nav
        aria-label="Email folders"
        className="-mx-3 mt-4 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {EMAIL_FOLDER_OPTIONS.map((option) => (
          <Link
            key={option.folder}
            href={pageHref("", "all", option.folder, 1)}
            aria-current={folder === option.folder ? "page" : undefined}
            className={`min-h-11 shrink-0 rounded-full px-5 py-2.5 text-sm font-medium ${
              folder === option.folder
                ? "bg-yellow-400 text-black"
                : "border border-white/10 bg-white/5 text-neutral-200"
            }`}
          >
            {option.label}
          </Link>
        ))}
      </nav>

      <form action="/emails" className="mt-3">
        <input type="hidden" name="folder" value={folderKey} />
        {filter === "unread" ? <input type="hidden" name="filter" value="unread" /> : null}
        <label htmlFor="email-search" className="sr-only">Search {folderLabel}</label>
        <div className="flex gap-2">
          <input
            id="email-search"
            name="q"
            type="search"
            defaultValue={q}
            maxLength={100}
            placeholder={`Search ${folderLabel.toLowerCase()}`}
            className="min-h-12 min-w-0 flex-1 rounded-xl border border-white/15 bg-[#111827] px-4 text-base text-white outline-none placeholder:text-neutral-500 focus:border-yellow-400"
          />
          <button className="min-h-12 rounded-xl border border-white/15 bg-white/5 px-4 font-medium text-white hover:bg-white/10">
            Search
          </button>
        </div>
      </form>

      {folder === "INBOX" ? (
        <nav aria-label="Email filters" className="mt-3 flex gap-2">
          <Link
            href={pageHref(q, "all", folder, 1)}
            className={`min-h-11 rounded-full px-5 py-2.5 text-sm font-medium ${
              filter === "all" ? "bg-white text-black" : "bg-white/5 text-neutral-200"
            }`}
          >
            All
          </Link>
          <Link
            href={pageHref(q, "unread", folder, 1)}
            className={`min-h-11 rounded-full px-5 py-2.5 text-sm font-medium ${
              filter === "unread" ? "bg-white text-black" : "bg-white/5 text-neutral-200"
            }`}
          >
            Unread
          </Link>
        </nav>
      ) : null}

      <section aria-label={`${folderLabel} email threads`} className="mt-4 grid gap-2.5">
        {threads.map((thread) => {
          const latest = thread.messages[0];
          const sender =
            thread.customerName ||
            thread.customerEmail ||
            latest?.fromName ||
            latest?.fromEmail ||
            "Unknown sender";
          const preview = emailPreview(latest?.bodyText, latest?.bodyHtml) || "No message preview";
          return (
            <Link
              key={thread.id}
              href={`/emails/${thread.id}?folder=${folderKey}`}
              className={`block min-w-0 rounded-2xl border p-4 transition active:scale-[0.99] ${
                thread.unread
                  ? "border-yellow-400/35 bg-yellow-400/[0.07]"
                  : "border-white/10 bg-[#111827] hover:border-white/20"
              }`}
            >
              <div className="flex min-w-0 items-start gap-3">
                <span
                  aria-label={thread.unread ? "Unread" : "Read"}
                  className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${thread.unread ? "bg-yellow-400" : "bg-neutral-700"}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <p className={`min-w-0 break-words ${thread.unread ? "font-semibold text-white" : "text-neutral-200"}`}>
                      {sender}
                    </p>
                    <time className="shrink-0 text-xs text-neutral-400">
                      {formatInboxDate(thread.lastMessageAt)}
                    </time>
                  </div>
                  <h2 className={`mt-1 break-words text-sm ${thread.unread ? "font-semibold text-white" : "text-neutral-300"}`}>
                    {thread.subject || "(No subject)"}
                  </h2>
                  <p className="mt-1 line-clamp-2 break-words text-sm leading-5 text-neutral-400">{preview}</p>
                </div>
              </div>
            </Link>
          );
        })}

        {!threads.length ? (
          <div className="rounded-2xl border border-dashed border-white/15 px-5 py-12 text-center">
            <p className="font-medium text-white">No emails in {folderLabel}</p>
            <p className="mt-1 text-sm text-neutral-400">
              {q || filter === "unread" ? "Try another search or filter." : "Use Sync inbox to refresh mailbox folders."}
            </p>
          </div>
        ) : null}
      </section>

      {totalPages > 1 ? (
        <nav aria-label="Email pages" className="mt-5 flex items-center justify-between gap-3">
          {page > 1 ? (
            <Link href={pageHref(q, filter, folder, page - 1)} className="min-h-11 rounded-xl bg-white/5 px-4 py-2.5 text-sm text-white">
              Previous
            </Link>
          ) : <span />}
          <p className="text-sm text-neutral-400">Page {page} of {totalPages}</p>
          {page < totalPages ? (
            <Link href={pageHref(q, filter, folder, page + 1)} className="min-h-11 rounded-xl bg-white/5 px-4 py-2.5 text-sm text-white">
              Next
            </Link>
          ) : <span />}
        </nav>
      ) : null}
    </div>
  );
}
