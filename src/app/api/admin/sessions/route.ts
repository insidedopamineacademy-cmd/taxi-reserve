export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { prisma } from "@/lib/prisma";
import { requireSecuritySession, securityFailure, securityJson } from "@/lib/security/http";
import { ENDED_SESSION_RETENTION_MS } from "@/lib/security/policy";

export async function GET(request: Request) {
  try {
    const { session } = await requireSecuritySession({ admin: true });
    const search = new URL(request.url).searchParams;
    const query = (search.get("query") ?? "").trim().slice(0, 100);
    const now = new Date();
    const users = await prisma.user.findMany({
      where: query ? { OR: [{ email: { contains: query, mode: "insensitive" } }, { name: { contains: query, mode: "insensitive" } }] } : {},
      orderBy: [{ email: "asc" }, { id: "asc" }], take: 50,
      select: { id: true, email: true, name: true, _count: { select: { deviceSessions: { where: { revokedAt: null, expiresAt: { gt: now } } } } } },
    });
    const userId = search.get("userId") || users.find(user => user.id === session.user?.id)?.id || users[0]?.id;
    const user = userId ? await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true } }) : null;
    const select = {
      id: true, userId: true, createdAt: true, lastSeenAt: true, expiresAt: true, revokedAt: true,
      device: true, browser: true, os: true, ipAddress: true, networkCity: true, networkRegion: true, networkCountry: true,
      revokeReason: true, revokedBy: { select: { email: true } },
    } as const;
    const cutoff = new Date(now.getTime() - ENDED_SESSION_RETENTION_MS);
    const [active, ended] = user ? await Promise.all([
      prisma.deviceSession.findMany({ where: { userId: user.id, revokedAt: null, expiresAt: { gt: now } }, orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }], select }),
      prisma.deviceSession.findMany({ where: { userId: user.id, OR: [{ revokedAt: { gte: cutoff } }, { revokedAt: null, expiresAt: { lte: now, gte: cutoff } }] }, orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }], take: 50, select }),
    ]) : [[], []];
    // Never expose expired network data while waiting for daily cleanup.
    const history = ended.map(row => ({ ...row, ipAddress: null, networkCity: null, networkRegion: null, networkCountry: null }));
    return securityJson({ users: users.map(user => ({ id: user.id, name: user.name, email: user.email, activeCount: user._count.deviceSessions })), user, sessions: [...active, ...history], currentSessionId: session.id, now: now.toISOString() });
  } catch (error) { return securityFailure(error); }
}
