export const runtime = "nodejs";

import { prisma } from "@/lib/prisma";
import { setManagedUserActive } from "@/lib/security/adminUsers";
import { SecurityError } from "@/lib/security/policy";
import { readSecurityJson, requireSameOrigin, requireSecuritySession, securityFailure, securityJson } from "@/lib/security/http";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    const { identity } = await requireSecuritySession({ admin: true, settingsUnlocked: true });
    const body = await readSecurityJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new SecurityError(400, "INVALID_REQUEST", "Invalid account status.");
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some(key => key !== "active") || typeof input.active !== "boolean") {
      throw new SecurityError(400, "INVALID_REQUEST", "Invalid account status.");
    }
    return securityJson(await setManagedUserActive(prisma, identity, (await params).id, input.active));
  } catch (error) {
    return securityFailure(error);
  }
}
