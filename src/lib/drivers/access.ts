import "server-only";

import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

export async function getDriverAdminAccess() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim().toLowerCase() ?? null;

  return {
    session,
    email,
    authenticated: Boolean(email),
    authorized: Boolean(email && session?.user?.role === "ADMIN"),
  };
}

export async function requireDriverAdminPage() {
  const access = await getDriverAdminAccess();

  if (!access.authenticated) redirect("/login");
  if (!access.authorized) redirect("/");

  return {
    session: access.session,
    email: access.email as string,
  };
}
