import "server-only";

import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { isDriverAdminRole } from "@/lib/drivers/access-core";

export async function getDriverAdminAccess() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim().toLowerCase() ?? null;

  return {
    session,
    email,
    authenticated: Boolean(email),
    authorized: Boolean(email && isDriverAdminRole(session?.user?.role)),
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
