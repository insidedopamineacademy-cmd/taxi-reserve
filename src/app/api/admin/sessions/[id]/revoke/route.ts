export const runtime = "nodejs";
import { prisma } from "@/lib/prisma";
import { revokeDeviceSession } from "@/lib/security/sessionCore";
import { requireSameOrigin, requireSecuritySession, securityFailure, securityJson } from "@/lib/security/http";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    const { identity } = await requireSecuritySession({ admin: true, settingsUnlocked: true });
    return securityJson(await revokeDeviceSession(prisma, identity, (await params).id));
  } catch (error) { return securityFailure(error); }
}
