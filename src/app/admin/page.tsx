"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatLocalInstantDateDisplay } from "@/lib/dateDisplay";

type User = {
  id: string;
  email: string;
  name?: string | null;
  createdAt: string;
};

type AdminData = {
  count: number;
  users: User[];
};

function formatCreatedAt(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Invalid date";
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${formatLocalInstantDateDisplay(date)} · ${time}`;
}

export default function AdminPage() {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAdmin() {
      setError(null);
      setLoading(true);

      const res = await fetch("/api/admin");
      setLoading(false);

      if (res.ok) {
        const json: AdminData = await res.json();
        setData(json);
      } else {
        setError("Unauthorized");
      }
    }

    void loadAdmin();
  }, []);

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-semibold text-white">Administration</h1>
        <p role="status" className="mt-3 text-sm text-muted">Loading…</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-semibold text-white">Administration</h1>
        {error && <p role="alert" className="mt-3 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">Admin</p>
        <h1 className="mt-1 text-2xl font-semibold text-white">Administration</h1>
        <p className="mt-2 text-sm text-muted">Manage users, devices and account security.</p>
      </header>

      <nav aria-label="Administration actions" className="mt-6 grid gap-3 sm:grid-cols-2">
        <a href="#users" className="group rounded-xl border border-app-border bg-surface p-4 hover:border-brand/40 hover:bg-brand/[0.04]">
          <span className="font-semibold text-white group-hover:text-brand">Users</span>
          <span className="mt-1 block text-sm text-muted">View existing user accounts</span>
        </a>
        <Link href="/admin/sessions" className="group rounded-xl border border-app-border bg-surface p-4 hover:border-brand/40 hover:bg-brand/[0.04]">
          <span className="font-semibold text-white group-hover:text-brand">Devices &amp; Sessions</span>
          <span className="mt-1 block text-sm text-muted">View active logins and log out devices</span>
        </Link>
      </nav>

      {error && <p role="alert" className="mt-5 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</p>}

      <section id="users" aria-labelledby="users-heading" className="mt-8 scroll-mt-20">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="users-heading" className="text-lg font-semibold text-white">Users</h2>
          <p className="text-sm text-muted">{data.count} total</p>
        </div>
        <ul className="grid gap-3 md:hidden">
          {data.users.map((user) => (
            <li key={user.id} className="min-w-0 rounded-xl border border-app-border bg-surface p-4">
              <p className="break-words font-medium text-white">{user.name || "Unnamed user"}</p>
              <p className="mt-1 break-all text-sm text-muted">{user.email}</p>
              <p className="mt-3 text-xs text-subtle">Created {formatCreatedAt(user.createdAt)}</p>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto rounded-xl border border-app-border bg-surface md:block">
          <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-app-border bg-surface-2 text-xs uppercase text-muted">
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id} className="border-b border-app-border last:border-0">
                <td className="break-all px-4 py-3 text-white">{u.email}</td>
                <td className="break-words px-4 py-3 text-muted">{u.name || "-"}</td>
                <td className="whitespace-nowrap px-4 py-3 text-muted">
                  {formatCreatedAt(u.createdAt)}
                </td>
              </tr>
            ))}
            {data.users.length === 0 && (
              <tr>
                <td colSpan={3} className="p-6 text-center text-muted">
                  No users found
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
        {data.users.length === 0 ? <p className="rounded-xl border border-app-border bg-surface p-6 text-center text-sm text-muted md:hidden">No users found</p> : null}
      </section>
    </main>
  );
}
