export const runtime = "nodejs";

import { prisma } from "@/lib/prisma";
import { resetManagedUserPassword } from "@/lib/security/adminUsers";
import { SecurityError } from "@/lib/security/policy";
import { readSecurityJson, requireTrustedSecurityRequest, requireSecuritySession, securityFailure, securityJson } from "@/lib/security/http";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireTrustedSecurityRequest(request);
    const { identity } = await requireSecuritySession({ admin: true, settingsUnlocked: true });
    const body = await readSecurityJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new SecurityError(400, "INVALID_REQUEST", "Invalid password details.");
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some(key => !["password", "confirmPassword"].includes(key)) || input.password !== input.confirmPassword) {
      throw new SecurityError(400, "INVALID_REQUEST", "Password confirmation must match.");
    }
    return securityJson(await resetManagedUserPassword(prisma, identity, (await params).id, input.password));
  } catch (error) {
    return securityFailure(error);
  }
}
