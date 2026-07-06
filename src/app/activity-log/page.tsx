export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import Link from "next/link";
import { getServerSession } from "next-auth";
import type { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type ActivitySearchParams = {
  q?: string | string[];
  entityType?: string | string[];
  sort?: string | string[];
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function metadataSummary(metadata: Prisma.JsonValue | null) {
  if (metadata === null) return null;
  const value = typeof metadata === "string" ? metadata : JSON.stringify(metadata);
  return value.length > 300 ? `${value.slice(0, 300)}…` : value;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Madrid",
  }).format(date);
}

export default async function ActivityLogPage({
  searchParams,
}: {
  searchParams?: Promise<ActivitySearchParams>;
}) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) redirect("/login");

  const isAdmin = session?.user?.role === "ADMIN";
  const params = (await searchParams) ?? {};
  const query = firstParam(params.q).trim().slice(0, 100);
  const entityType = firstParam(params.entityType).trim().slice(0, 100);
  const sort = firstParam(params.sort) === "oldest" ? "oldest" : "newest";
  const scope: Prisma.ActivityLogWhereInput = isAdmin ? {} : { userEmail: email };
  const filters: Prisma.ActivityLogWhereInput[] = [];

  if (query) {
    filters.push({
      OR: [
        { action: { contains: query, mode: "insensitive" } },
        { entityType: { contains: query, mode: "insensitive" } },
        { entityId: { contains: query, mode: "insensitive" } },
        { userEmail: { contains: query, mode: "insensitive" } },
      ],
    });
  }

  if (entityType) filters.push({ entityType });

  const where: Prisma.ActivityLogWhereInput = filters.length
    ? { AND: [scope, ...filters] }
    : scope;

  const [logs, entityTypes] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: sort === "oldest" ? "asc" : "desc" },
      take: 200,
    }),
    prisma.activityLog.findMany({
      where: scope,
      select: { entityType: true },
      distinct: ["entityType"],
      orderBy: { entityType: "asc" },
    }),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-white">Activity Log</h1>
        <p className="mt-1 text-sm text-neutral-400">
          {isAdmin
            ? "Showing activity across all users."
            : "Showing activity associated with your account."}
        </p>
      </div>

      <form
        method="get"
        className="mb-6 grid gap-3 rounded-xl border border-white/10 bg-[#0e1426] p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_13rem_11rem_auto]"
      >
        <label className="min-w-0">
          <span className="mb-1 block text-xs font-medium text-neutral-400">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Action, entity, ID or email"
            className="h-11 w-full min-w-0 rounded-md border border-white/10 bg-black/30 px-3 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-white/30 focus:ring-2 focus:ring-white/10"
          />
        </label>

        <label className="min-w-0">
          <span className="mb-1 block text-xs font-medium text-neutral-400">Entity type</span>
          <select
            name="entityType"
            defaultValue={entityType}
            className="h-11 w-full min-w-0 rounded-md border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-white/30 focus:ring-2 focus:ring-white/10"
          >
            <option value="">All entities</option>
            {entityTypes.map(({ entityType: type }) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>

        <label className="min-w-0">
          <span className="mb-1 block text-xs font-medium text-neutral-400">Sort</span>
          <select
            name="sort"
            defaultValue={sort}
            className="h-11 w-full min-w-0 rounded-md border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-white/30 focus:ring-2 focus:ring-white/10"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>

        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="h-11 rounded-md bg-yellow-500 px-4 text-sm font-semibold text-black hover:bg-yellow-400"
          >
            Apply
          </button>
          {(query || entityType || sort === "oldest") && (
            <Link
              href="/activity-log"
              className="inline-flex h-11 items-center rounded-md border border-white/10 px-3 text-sm text-neutral-300 hover:bg-white/5"
            >
              Reset
            </Link>
          )}
        </div>
      </form>

      <p className="mb-3 text-xs text-neutral-500">
        {logs.length === 200 ? "Showing the first 200 matching entries." : `${logs.length} entries.`}
      </p>

      {logs.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-[#0e1426] p-8 text-center text-sm text-neutral-400">
          No activity matches these filters.
        </div>
      ) : (
        <ol className="grid gap-3">
          {logs.map((log) => {
            const metadata = metadataSummary(log.metadata);
            return (
              <li
                key={log.id}
                className="min-w-0 rounded-xl border border-white/10 bg-[#0e1426] p-4"
              >
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="break-words font-medium text-white">{log.action}</p>
                    <p className="mt-1 break-words text-sm text-neutral-300">
                      {log.entityType}
                      {log.entityId ? (
                        <span className="text-neutral-500"> · {log.entityId}</span>
                      ) : null}
                    </p>
                  </div>
                  <time
                    dateTime={log.createdAt.toISOString()}
                    className="shrink-0 text-xs text-neutral-400"
                  >
                    {formatDate(log.createdAt)}
                  </time>
                </div>

                <dl className="mt-3 grid min-w-0 gap-2 border-t border-white/10 pt-3 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
                  <dt className="text-neutral-500">User</dt>
                  <dd className="min-w-0 break-all text-neutral-300">{log.userEmail ?? "System"}</dd>
                  {metadata ? (
                    <>
                      <dt className="text-neutral-500">Metadata</dt>
                      <dd className="min-w-0 break-all font-mono text-xs leading-5 text-neutral-300">
                        {metadata}
                      </dd>
                    </>
                  ) : null}
                </dl>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
