import "server-only";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

export async function requireAdminSettingsPage(destination: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/reservations");
  const unlockedUntil = session.settingsUnlockedUntil ? new Date(session.settingsUnlockedUntil) : null;
  if (!unlockedUntil || !Number.isFinite(unlockedUntil.getTime()) || unlockedUntil <= new Date()) {
    redirect(`/settings?next=${encodeURIComponent(destination)}`);
  }
  return session;
}
