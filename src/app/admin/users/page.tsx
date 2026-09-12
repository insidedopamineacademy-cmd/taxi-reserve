export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import Link from "next/link";
import UserManager from "@/components/security/UserManager";
import { requireAdminSettingsPage } from "@/lib/security/adminPageAccess";

export default async function AdminUsersPage() {
  await requireAdminSettingsPage("/admin/users");
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <Link href="/admin" className="inline-flex min-h-11 items-center text-sm text-muted hover:text-white">‹ Admin</Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Users</h1>
          <p className="mt-2 text-sm text-muted">Create and manage worker access without deleting historical records.</p>
        </div>
      </div>
      <UserManager />
    </main>
  );
}
