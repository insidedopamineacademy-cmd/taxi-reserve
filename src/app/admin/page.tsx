export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import Link from "next/link";
import { requireAdminSettingsPage } from "@/lib/security/adminPageAccess";

export default async function AdminPage() {
  await requireAdminSettingsPage("/admin");
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">Admin</p>
          <h1 className="mt-1 text-2xl font-semibold text-white">Administration</h1>
          <p className="mt-2 text-sm text-muted">Manage worker accounts, devices and account security.</p>
        </div>
        <Link href="/settings" className="inline-flex min-h-11 items-center rounded-lg border border-app-border px-4 text-sm text-white hover:bg-surface-2">Security settings</Link>
      </header>

      <nav aria-label="Administration actions" className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link href="/admin/users" className="group rounded-xl border border-app-border bg-surface p-5 hover:border-brand/40 hover:bg-brand/[0.04]">
          <span className="font-semibold text-white group-hover:text-brand">Users</span>
          <span className="mt-1 block text-sm text-muted">Create workers, reset passwords and manage access</span>
        </Link>
        <Link href="/admin/sessions" className="group rounded-xl border border-app-border bg-surface p-5 hover:border-brand/40 hover:bg-brand/[0.04]">
          <span className="font-semibold text-white group-hover:text-brand">Devices &amp; Sessions</span>
          <span className="mt-1 block text-sm text-muted">View active logins and log out devices</span>
        </Link>
      </nav>
    </main>
  );
}
