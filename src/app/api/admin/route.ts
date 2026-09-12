import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activityLog";
import { requireSecuritySession, securityFailure, securityJson } from "@/lib/security/http";

export async function GET() {
  try {
    const { session } = await requireSecuritySession({ admin: true, settingsUnlocked: true });

    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    const count = await prisma.user.count();

    await logActivity({
      action: "admin_viewed_users",
      entityType: "user",
      userEmail: session.user?.email ?? null,
      metadata: { resultCount: count },
    });

    return securityJson({ count, users });
  } catch (error) {
    return securityFailure(error);
  }
}

export async function DELETE() {
  try {
    await requireSecuritySession({ admin: true, settingsUnlocked: true });
    return securityJson({ error: "User deletion is disabled" }, 405);
  } catch (error) {
    return securityFailure(error);
  }
}
