export const runtime = "nodejs";
import { prisma } from "@/lib/prisma";
import { revokeOtherSessions } from "@/lib/security/sessionCore";
import { SecurityError } from "@/lib/security/policy";
import { readSecurityJson, requireTrustedSecurityRequest, requireSecuritySession, securityFailure, securityJson } from "@/lib/security/http";

export async function POST(request: Request) {
  try {
    requireTrustedSecurityRequest(request);
    const { identity } = await requireSecuritySession({ admin: true, settingsUnlocked: true });
    const body = await readSecurityJson(request, 65536);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new SecurityError(400, "INVALID_REQUEST", "Invalid confirmation.");
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some(key => !["userId", "expectedIds"].includes(key)) || typeof input.userId !== "string" || !Array.isArray(input.expectedIds) || input.expectedIds.length > 1000 || input.expectedIds.some(id => typeof id !== "string" || id.length !== 36)) {
      throw new SecurityError(400, "INVALID_REQUEST", "Refresh the session list before confirming.");
    }
    return securityJson(await revokeOtherSessions(prisma, identity, input.userId, input.expectedIds as string[]));
  } catch (error) { return securityFailure(error); }
}
