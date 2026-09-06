export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import Link from "next/link";
import { requireDriverAdminPage } from "@/lib/drivers/access";
import SessionManager from "@/components/security/SessionManager";

export default async function AdminSessionsPage() {
  await requireDriverAdminPage();
  return <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
    <Link href="/admin" className="inline-flex min-h-11 items-center text-sm text-muted hover:text-white">‹ Admin</Link>
    <h1 className="mt-2 text-2xl font-semibold text-white">Devices &amp; sessions</h1>
    <p className="mt-2 text-sm text-muted">Review account access and log out individual devices. Only administrators can view these details.</p>
    <SessionManager />
  </main>;
}
