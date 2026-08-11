import "server-only";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { ReservationAccessContext } from "@/lib/reservations/assistant-read-core";

export async function getAssistantAuthContext(): Promise<ReservationAccessContext | null> {
  const session = await getServerSession(authOptions);
  const sessionEmail = session?.user?.email?.trim().toLowerCase();
  if (!sessionEmail) return null;

  // Resolve identity and role from the database. Request payloads and stale client state
  // never supply authorization context to assistant services.
  const user = await prisma.user.findUnique({
    where: { email: sessionEmail },
    select: { id: true, email: true, role: true },
  });

  return user
    ? { userId: user.id, email: user.email, role: user.role }
    : null;
}
