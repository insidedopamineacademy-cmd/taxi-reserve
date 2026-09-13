export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import {
  getAdminSecurityStatus,
  lockAdminSettings,
  setupAdminSecurityPin,
  unlockAdminSettings,
} from "@/lib/security/adminSecurity";
import { SecurityError } from "@/lib/security/policy";
import {
  readSecurityJson,
  requireTrustedSecurityRequest,
  requireSecuritySession,
  securityFailure,
  securityJson,
} from "@/lib/security/http";

export async function GET() {
  try {
    const { identity } = await requireSecuritySession({ admin: true });
    return securityJson(await getAdminSecurityStatus(prisma, identity));
  } catch (error) {
    return securityFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    requireTrustedSecurityRequest(request, "admin-security-gate");
    const { identity } = await requireSecuritySession({ admin: true });
    console.info("Security gate request stage.", { event: "SECURITY_GATE_STAGE", stage: "jwt-admin-accepted" });
    const body = await readSecurityJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new SecurityError(400, "INVALID_REQUEST", "Invalid security request.");
    }
    const input = body as Record<string, unknown>;
    if (input.action === "setup") {
      if (Object.keys(input).some(key => !["action", "currentPassword", "pin", "confirmPin"].includes(key)) ||
          typeof input.currentPassword !== "string" || input.pin !== input.confirmPin) {
        throw new SecurityError(400, "INVALID_REQUEST", "PIN confirmation must match.");
      }
      console.info("Security gate request stage.", { event: "SECURITY_GATE_STAGE", stage: "setup-input-accepted" });
      const result = await setupAdminSecurityPin(prisma, identity, input.currentPassword, input.pin);
      return securityJson({ unlocked: true, unlockedUntil: result.unlockedUntil.toISOString() });
    }
    if (input.action === "unlock") {
      if (Object.keys(input).some(key => !["action", "pin"].includes(key))) {
        throw new SecurityError(400, "INVALID_REQUEST", "Invalid security request.");
      }
      console.info("Security gate request stage.", { event: "SECURITY_GATE_STAGE", stage: "unlock-input-accepted" });
      const result = await unlockAdminSettings(prisma, identity, input.pin);
      return securityJson({ unlocked: true, unlockedUntil: result.unlockedUntil.toISOString() });
    }
    if (input.action === "lock" && Object.keys(input).every(key => key === "action")) {
      return securityJson(await lockAdminSettings(prisma, identity));
    }
    throw new SecurityError(400, "INVALID_REQUEST", "Invalid security request.");
  } catch (error) {
    return securityFailure(error);
  }
}
